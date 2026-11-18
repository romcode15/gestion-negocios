from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.exceptions import NotAuthenticated, PermissionDenied, ValidationError
from rest_framework.test import APIClient

from accesos.models import Membresia, Permiso, Rol, RolPermiso
from accesos.services import asignar_superadministrador, preparar_catalogo
from api.common.access import (
    permisos_delegables, resolver_contexto_negocio, validar_asignacion_rol,
    validar_permisos_delegables,
)
from api.common.role_policy import validar_cambio_rol
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios


@override_settings(ROOT_URLCONF="tests.support.api_urls")
class SeguridadHttpTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.global_user = get_user_model().objects.create_user(username="plataforma")
        asignar_superadministrador(cls.global_user)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def assert_error(self, response, status, code):
        self.assertEqual(response.status_code, status)
        value = response.json()
        self.assertEqual(set(value), {"code", "detail", "errors"})
        self.assertEqual(value["code"], code)

    def test_rutas_protegidas_sin_sesion(self):
        for path in ("/api/v1/pruebas/global/", f"/api/v1/pruebas/negocios/{self.tienda.negocio.pk}/"):
            with self.subTest(path=path):
                self.assert_error(self.client.get(path), 403, "not_authenticated")

    def test_options_y_metodos_no_soportados_no_causan_error_interno(self):
        self.client.force_login(self.global_user)
        self.assertEqual(self.client.options("/api/v1/pruebas/global/").status_code, 200)
        self.client.get("/api/v1/auth/csrf/")
        self.assert_error(self.client.delete("/api/v1/pruebas/global/",
                          HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value), 405, "method_not_allowed")
        self.client.force_login(self.tienda.administrador)
        path = f"/api/v1/pruebas/negocios/{self.tienda.negocio.pk}/"
        self.assertEqual(self.client.options(path).status_code, 200)

    def test_permisos_globales_independientes_de_membresia_y_superuser(self):
        self.client.force_login(self.tienda.administrador)
        self.assert_error(self.client.get("/api/v1/pruebas/global/"), 403, "permission_denied")
        self.tienda.administrador.is_superuser = True
        self.tienda.administrador.save()
        self.assert_error(self.client.get("/api/v1/pruebas/global/"), 403, "permission_denied")
        self.client.force_login(self.global_user)
        self.assertEqual(self.client.get("/api/v1/pruebas/global/").status_code, 200)
        self.assert_error(self.client.get(f"/api/v1/pruebas/negocios/{self.tienda.negocio.pk}/"), 403, "permission_denied")

    def test_permisos_por_metodo_y_csrf_en_post_y_patch(self):
        self.client.force_login(self.tienda.administrador)
        path = f"/api/v1/pruebas/negocios/{self.tienda.negocio.pk}/"
        self.assertEqual(self.client.get(path).status_code, 200)
        for method in (self.client.post, self.client.patch):
            self.assert_error(method(path), 403, "csrf_failed")
        self.client.get("/api/v1/auth/csrf/")
        token = self.client.cookies["csrftoken"].value
        for method in (self.client.post, self.client.patch):
            self.assertEqual(method(path, {}, format="json", HTTP_X_CSRFTOKEN=token).status_code, 200)
        RolPermiso.objects.filter(rol=self.tienda.rol, permiso__codigo="crear_rol").delete()
        self.assert_error(self.client.post(path, {}, format="json", HTTP_X_CSRFTOKEN=token), 403, "permission_denied")
        self.assertEqual(self.client.get(path).status_code, 200)

    def test_negocio_inexistente_o_ajeno_no_revela_existencia(self):
        self.client.force_login(self.tienda.administrador)
        respuestas = [self.client.get(f"/api/v1/pruebas/negocios/{pk}/")
                      for pk in (self.ferreteria.negocio.pk, 999999)]
        for response in respuestas:
            self.assert_error(response, 403, "permission_denied")
        self.assertEqual(respuestas[0].json(), respuestas[1].json())

    def test_recurso_se_busca_dentro_del_contexto_autorizado(self):
        self.client.force_login(self.tienda.administrador)
        path = f"/api/v1/pruebas/negocios/{self.tienda.negocio.pk}/roles/"
        self.assertEqual(self.client.get(path + f"{self.tienda.rol.pk}/").status_code, 200)
        for pk in (self.ferreteria.rol.pk, 999999):
            self.assert_error(self.client.get(path + f"{pk}/"), 404, "not_found")

    def test_contexto_inactivo_denegado(self):
        self.client.force_login(self.tienda.administrador)
        path = f"/api/v1/pruebas/negocios/{self.tienda.negocio.pk}/"
        self.tienda.membresia.activo = False
        self.tienda.membresia.save()
        self.assert_error(self.client.get(path), 403, "permission_denied")
        self.tienda.membresia.activo = True
        self.tienda.membresia.save()
        self.tienda.negocio.activo = False
        self.tienda.negocio.save()
        self.assert_error(self.client.get(path), 403, "permission_denied")

    def test_paginacion_tamano_orden_enlaces_y_pagina_inexistente(self):
        self.client.force_login(self.global_user)
        first = self.client.get("/api/v1/pruebas/lista/")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(set(first.data), {"count", "next", "previous", "results"})
        self.assertEqual(len(first.data["results"]), 2)
        self.assertIsNone(first.data["previous"])
        expected = list(get_user_model().objects.order_by("id").values_list("id", flat=True))
        second = self.client.get(first.data["next"])
        result = first.data["results"] + second.data["results"]
        self.assertEqual([u["id"] for u in result], expected)
        self.assertIsNotNone(second.data["previous"])
        self.assert_error(self.client.get("/api/v1/pruebas/lista/?page=999"), 404, "not_found")
        empty = self.client.get("/api/v1/pruebas/lista/?empty=1").data
        self.assertEqual(empty, {"count": 0, "next": None, "previous": None, "results": []})

    def test_formato_validacion_de_drf_django_y_json_invalido(self):
        self.client.force_login(self.global_user)
        self.client.get("/api/v1/auth/csrf/")
        headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}
        path = "/api/v1/pruebas/errores/"
        response = self.client.post(path, {}, format="json", **headers)
        self.assert_error(response, 400, "validation_error")
        self.assertIsInstance(response.data["errors"]["nombre"], list)
        django_response = self.client.get(path)
        self.assert_error(django_response, 400, "validation_error")
        self.assertEqual(django_response.data["errors"], {"rol_id": ["Rol inválido."]})
        malformed = self.client.post(path, data="{", content_type="application/json", **headers)
        self.assert_error(malformed, 400, "validation_error")

    def test_no_oculta_excepciones_inesperadas(self):
        self.client.force_login(self.global_user)
        self.client.get("/api/v1/auth/csrf/")
        with self.assertRaises(ValueError):
            self.client.patch("/api/v1/pruebas/errores/", {}, format="json",
                              HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)

    def test_csrf_middleware_y_url_inexistente_tienen_contrato(self):
        self.assert_error(self.client.post("/api/v1/pruebas/django-csrf/"), 403, "csrf_failed")
        self.assert_error(self.client.get("/api/v1/ruta-inexistente/"), 404, "not_found")


class PoliticaRolesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        preparar_catalogo()
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.basico = crear_rol(cls.tienda.negocio, "Consulta", ["listar_roles"])

    def contexto(self):
        return resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk, "asignar_rol")

    def test_delegables_solo_del_actor_y_ambito_negocio(self):
        self.tienda.membresia.rol = self.basico
        self.tienda.membresia.save()
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)
        permitidos = list(permisos_delegables(contexto).values_list("codigo", flat=True))
        self.assertEqual(permitidos, ["listar_roles"])
        id_permitido = Permiso.objects.get(codigo="listar_roles").pk
        self.assertEqual(validar_permisos_delegables(contexto, [id_permitido]), [id_permitido])
        self.assertEqual(validar_permisos_delegables(contexto, []), [])
        for ids in ([id_permitido, id_permitido], [999999], [Permiso.objects.get(codigo="crear_usuario").pk], [Permiso.objects.get(codigo="crear_rol").pk]):
            with self.subTest(ids=ids), self.assertRaises(ValidationError):
                validar_permisos_delegables(contexto, ids)

    def test_asignacion_rechaza_privilegios_superiores_rol_global_y_ajeno(self):
        contexto = self.contexto()
        self.assertEqual(validar_asignacion_rol(contexto, self.basico), self.basico)
        global_role = Rol.objects.get(nombre="Superadministrador")
        for rol in (global_role, self.ferreteria.rol, Rol(nombre="Sin guardar", negocio=self.tienda.negocio)):
            with self.subTest(rol=rol), self.assertRaises(ValidationError):
                validar_asignacion_rol(contexto, rol)
        self.tienda.membresia.rol = self.basico
        self.tienda.membresia.save()
        contexto_limitado = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)
        with self.assertRaises(ValidationError):
            validar_asignacion_rol(contexto_limitado, self.tienda.rol)

    def test_ultimo_admin_no_se_puede_degradar_pero_puede_conservar_rol(self):
        contexto = self.contexto()
        with self.assertRaises(ValidationError):
            validar_cambio_rol(contexto, self.tienda.membresia, self.basico)
        actual = validar_cambio_rol(contexto, self.tienda.membresia, self.tienda.rol)
        self.assertEqual(actual.pk, self.tienda.membresia.pk)

    def test_segundo_administrador_activo_permite_cambio(self):
        usuario = get_user_model().objects.create_user(username="segundo")
        otro = Membresia.objects.create(usuario=usuario, negocio=self.tienda.negocio, rol=self.tienda.rol)
        actual = validar_cambio_rol(self.contexto(), self.tienda.membresia, self.basico)
        actual.rol = self.basico
        actual.save()
        self.assertEqual(otro.rol_id, self.tienda.rol.pk)

    def test_admin_inactivo_no_cuenta_como_reemplazo(self):
        for cuenta_activa, membresia_activa in ((False, True), (True, False)):
            with self.subTest(cuenta_activa=cuenta_activa):
                usuario = get_user_model().objects.create_user(username=f"otro-{cuenta_activa}", is_active=cuenta_activa)
                Membresia.objects.create(usuario=usuario, negocio=self.tienda.negocio, rol=self.tienda.rol, activo=membresia_activa)
                with self.assertRaises(ValidationError):
                    validar_cambio_rol(self.contexto(), self.tienda.membresia, self.basico)

    def test_cambio_revalida_permiso_actual_del_actor(self):
        contexto = self.contexto()
        RolPermiso.objects.filter(rol=self.tienda.rol, permiso__codigo="asignar_rol").delete()
        with self.assertRaises(PermissionDenied):
            validar_cambio_rol(contexto, self.tienda.membresia, self.basico)

    def test_anonimo_e_inactivo_no_resuelven_contexto(self):
        with self.assertRaises(NotAuthenticated):
            resolver_contexto_negocio(AnonymousUser(), self.tienda.negocio.pk)
        self.tienda.administrador.is_active = False
        with self.assertRaises(NotAuthenticated):
            resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)


class ConcurrenciaRolesTests(TransactionTestCase):
    def test_cambio_exige_transaccion_externa(self):
        tienda, _ = crear_dos_negocios()
        contexto = resolver_contexto_negocio(tienda.administrador, tienda.negocio.pk)
        with self.assertRaises(ImproperlyConfigured):
            validar_cambio_rol(contexto, tienda.membresia, tienda.rol)

    def test_dos_degradaciones_concurrentes_conservan_un_administrador(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections, connections

        tienda, _ = crear_dos_negocios()
        segundo = get_user_model().objects.create_user(username="segundo")
        miembro = Membresia.objects.create(usuario=segundo, negocio=tienda.negocio, rol=tienda.rol)
        basico = crear_rol(tienda.negocio, "Consulta", ["listar_roles"])
        barrier = Barrier(2, timeout=10)

        def degradar(usuario_id, membresia_id):
            close_old_connections()
            try:
                usuario = get_user_model().objects.get(pk=usuario_id)
                contexto = resolver_contexto_negocio(usuario, tienda.negocio.pk)
                target = Membresia.objects.get(pk=membresia_id)
                barrier.wait()
                with transaction.atomic():
                    actual = validar_cambio_rol(contexto, target, basico)
                    actual.rol = basico
                    actual.save()
                return "ok"
            except ValidationError:
                return "rechazado"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(degradar, usuario, membresia) for usuario, membresia in (
                (tienda.administrador.pk, tienda.membresia.pk), (segundo.pk, miembro.pk),
            )]
            resultados = [future.result(timeout=20) for future in futures]
        self.assertCountEqual(resultados, ["ok", "rechazado"])
        self.assertEqual(Membresia.objects.filter(negocio=tienda.negocio, rol=tienda.rol).count(), 1)

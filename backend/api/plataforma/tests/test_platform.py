from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from accesos.catalogo import PERMISOS_NEGOCIO
from accesos.models import Membresia, Permiso, Rol, RolPermiso, UsuarioRolGlobal
from accesos.services import asignar_superadministrador
from api.plataforma.services import crear_negocio, crear_usuario


PASSWORD = "Cuenta-Pruebas-839!"
USUARIOS = "/api/v1/plataforma/usuarios/"
NEGOCIOS = "/api/v1/plataforma/negocios/"


class PlataformaTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.plataforma = get_user_model().objects.create_user(username="plataforma")
        asignar_superadministrador(cls.plataforma)
        cls.admin = get_user_model().objects.create_user(username="administrador", password=PASSWORD)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.plataforma)
        self.client.get("/api/v1/auth/csrf/")
        self.headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def post(self, path, data):
        return self.client.post(path, data, format="json", **self.headers)

    def negocio(self, nombre="Tienda", tipo="tienda"):
        return self.post(NEGOCIOS, {"nombre": nombre, "tipo": tipo, "administrador_id": self.admin.pk})

    def assert_error(self, response, status, code, field=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(response.data["code"], code)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        if field:
            self.assertIsInstance(response.data["errors"][field], list)

    def test_crear_usuario_guarda_hash_y_responde_solo_campos_acordados(self):
        response = self.post(USUARIOS, {"username": "nueva", "password": PASSWORD})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(set(response.data), {"id", "username", "is_active"})
        self.assertIsInstance(response.data["id"], int)
        usuario = get_user_model().objects.get(pk=response.data["id"])
        self.assertTrue(usuario.check_password(PASSWORD))
        self.assertNotEqual(usuario.password, PASSWORD)
        self.assertTrue(usuario.is_active)
        self.assertFalse(usuario.is_staff)
        self.assertFalse(usuario.is_superuser)

    def test_usuario_duplicado_e_invalido_no_crean_registros(self):
        cantidad = get_user_model().objects.count()
        for username in (self.admin.username, "invalido con espacio", "x" * 151):
            with self.subTest(username=username):
                self.assert_error(self.post(USUARIOS, {"username": username, "password": PASSWORD}),
                                  400, "validation_error", "username")
        self.assertEqual(get_user_model().objects.count(), cantidad)

    def test_normalizacion_unicode_no_elude_username_unico(self):
        get_user_model().objects.create_user(username="usuario")
        response = self.post(USUARIOS, {"username": "ｕｓｕａｒｉｏ", "password": PASSWORD})
        self.assert_error(response, 400, "validation_error", "username")

    def test_validadores_reales_de_password(self):
        cantidad = get_user_model().objects.count()
        for username, password in (("corta", "a!"), ("comun", "password"),
                                   ("numerica", "928374650182"), ("parecida", "parecida")):
            with self.subTest(username=username):
                self.assert_error(self.post(USUARIOS, {"username": username, "password": password}),
                                  400, "validation_error", "password")
        self.assertEqual(get_user_model().objects.count(), cantidad)

    def test_campos_requeridos(self):
        for path, expected in ((USUARIOS, {"username", "password"}),
                               (NEGOCIOS, {"nombre", "tipo", "administrador_id"})):
            response = self.post(path, {})
            self.assert_error(response, 400, "validation_error")
            self.assertEqual(set(response.data["errors"]), expected)

    def test_campos_extra_no_otorgan_flags_ni_control_de_ids(self):
        response = self.post(USUARIOS, {"username": "otra", "password": PASSWORD,
                             "is_active": False, "is_staff": True, "is_superuser": True, "id": 99999})
        self.assertEqual(response.status_code, 201)
        usuario = get_user_model().objects.get(pk=response.data["id"])
        self.assertNotEqual(usuario.pk, 99999)
        self.assertTrue(usuario.is_active)
        self.assertFalse(usuario.is_staff or usuario.is_superuser)
        response = self.post(NEGOCIOS, {"nombre": "Tienda", "tipo": "tienda", "administrador_id": self.admin.pk,
                                        "activo": False, "id": 99999})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["activo"])
        self.assertNotEqual(response.data["id"], 99999)

    def test_negocio_crea_rol_permisos_y_membresia_inicial(self):
        response = self.negocio()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(set(response.data), {"id", "nombre", "tipo", "activo"})
        miembro = Membresia.objects.select_related("rol").get(negocio_id=response.data["id"])
        self.assertEqual(miembro.usuario_id, self.admin.pk)
        self.assertEqual(miembro.rol.negocio_id, miembro.negocio_id)
        self.assertTrue(miembro.activo and miembro.rol.predefinido)
        self.assertEqual(set(miembro.rol.permisos_asignados.values_list("permiso__codigo", flat=True)), set(PERMISOS_NEGOCIO))
        self.assertFalse(UsuarioRolGlobal.objects.filter(usuario=self.admin).exists())

    def test_administrador_inexistente_inactivo_o_id_invalido(self):
        inactivo = get_user_model().objects.create_user(username="inactivo", is_active=False)
        for value in (999999, inactivo.pk, 0, -1, "texto", None):
            with self.subTest(value=value):
                response = self.post(NEGOCIOS, {"nombre": "Tienda", "tipo": "tienda", "administrador_id": value})
                self.assert_error(response, 400, "validation_error", "administrador_id")
        self.assertFalse(Membresia.objects.exists())

    def test_nombre_tipo_requeridos_y_limites(self):
        for campo, valor in (("nombre", ""), ("nombre", " " * 3), ("nombre", "x" * 151),
                              ("tipo", ""), ("tipo", " " * 3), ("tipo", "x" * 101)):
            with self.subTest(campo=campo, valor=valor):
                datos = {"nombre": "Tienda", "tipo": "tienda", "administrador_id": self.admin.pk, campo: valor}
                self.assert_error(self.post(NEGOCIOS, datos), 400, "validation_error", campo)
        self.assertFalse(Membresia.objects.exists())

    def test_listas_paginadas_ordenadas_y_sin_hashes(self):
        for i in range(3):
            self.assertEqual(self.negocio(nombre=f"Tienda {i}").status_code, 201)
        for path, campos in ((USUARIOS, {"id", "username", "is_active"}),
                             (NEGOCIOS, {"id", "nombre", "tipo", "activo"})):
            primero = self.client.get(path)
            self.assertEqual(primero.status_code, 200)
            self.assertEqual(set(primero.data), {"count", "next", "previous", "results"})
            self.assertEqual(len(primero.data["results"]), 2)
            self.assertIsNone(primero.data["previous"])
            resultado = primero.data["results"]
            if primero.data["next"]:
                resultado += self.client.get(primero.data["next"]).data["results"]
            self.assertEqual([x["id"] for x in resultado], sorted(x["id"] for x in resultado))
            self.assertTrue(all(set(x) == campos for x in resultado))
            self.assert_error(self.client.get(path + "?page=999"), 404, "not_found")

    def test_lista_vacia_de_negocios(self):
        response = self.client.get(NEGOCIOS)
        self.assertEqual(response.data, {"count": 0, "next": None, "previous": None, "results": []})

    def test_permisos_independientes_por_operacion(self):
        for path, listar, crear, payload in (
            (USUARIOS, "listar_usuarios", "crear_usuario", {"username": "permitida", "password": PASSWORD}),
            (NEGOCIOS, "listar_negocios", "crear_negocio", {"nombre": "Tienda", "tipo": "tienda", "administrador_id": self.admin.pk}),
        ):
            rol = Rol.objects.create(nombre=f"Solo {crear}")
            RolPermiso.objects.create(rol=rol, permiso=Permiso.objects.get(codigo=crear))
            usuario = get_user_model().objects.create_user(username=crear)
            UsuarioRolGlobal.objects.create(usuario=usuario, rol=rol)
            self.client.force_login(usuario)
            self.assert_error(self.client.get(path), 403, "permission_denied")
            self.assertEqual(self.post(path, payload).status_code, 201)
            RolPermiso.objects.filter(rol=rol).delete()
            RolPermiso.objects.create(rol=rol, permiso=Permiso.objects.get(codigo=listar))
            self.assertEqual(self.client.get(path).status_code, 200)
            self.assert_error(self.post(path, payload), 403, "permission_denied")

    def test_sesion_ausente_permiso_ausente_y_csrf_invalido(self):
        anonimo = APIClient(enforce_csrf_checks=True)
        for path in (USUARIOS, NEGOCIOS):
            self.assert_error(anonimo.get(path), 403, "not_authenticated")
            self.assert_error(anonimo.post(path, {}, format="json"), 403, "not_authenticated")
            self.assert_error(self.client.post(path, {}, format="json"), 403, "csrf_failed")
        self.client.force_login(self.admin)
        for path in (USUARIOS, NEGOCIOS):
            self.assert_error(self.client.get(path), 403, "permission_denied")
            self.assert_error(self.post(path, {}), 403, "permission_denied")

    def test_solo_listado_y_creacion_sin_crud_extra(self):
        for path in (USUARIOS, NEGOCIOS):
            self.assert_error(self.client.patch(path, {}, format="json", **self.headers), 405, "method_not_allowed")
            self.assertEqual(self.client.get(path + "999/").status_code, 404)

    def test_fallo_en_membresia_revierte_todo_el_negocio(self):
        from negocios.models import Negocio

        antes = (Negocio.objects.count(), Rol.objects.count(), RolPermiso.objects.count(), Membresia.objects.count())
        with patch.object(Membresia, "save", side_effect=RuntimeError("Fallo simulado")):
            with self.assertRaises(RuntimeError):
                self.negocio()
        despues = (Negocio.objects.count(), Rol.objects.count(), RolPermiso.objects.count(), Membresia.objects.count())
        self.assertEqual(antes, despues)

    def test_flujo_real_dos_negocios_y_sesion_de_su_administrador(self):
        respuestas = [self.negocio(), self.negocio("Ferretería", "ferreteria")]
        self.assertTrue(all(r.status_code == 201 for r in respuestas))
        ids = [r.data["id"] for r in respuestas]
        miembros = list(Membresia.objects.filter(negocio_id__in=ids).order_by("negocio_id"))
        self.assertEqual(len(miembros), 2)
        self.assertNotEqual(miembros[0].rol_id, miembros[1].rol_id)
        login = APIClient(enforce_csrf_checks=True)
        login.get("/api/v1/auth/csrf/")
        response = login.post("/api/v1/auth/login/", {"username": self.admin.username, "password": PASSWORD}, format="json",
                              HTTP_X_CSRFTOKEN=login.cookies["csrftoken"].value)
        self.assertEqual(response.status_code, 200)
        me = login.get("/api/v1/auth/me/").data
        self.assertEqual([n["id"] for n in me["negocios"]], ids)
        for negocio in me["negocios"]:
            self.assertEqual(set(negocio["permisos"]), set(PERMISOS_NEGOCIO))
        self.assertEqual(me["permisos_globales"], [])
        self.assert_error(login.get(NEGOCIOS), 403, "permission_denied")


class ServiciosPlataformaTests(TestCase):
    def test_servicio_revalida_administrador_despues_del_serializer(self):
        from api.plataforma.serializers import CrearNegocioSerializer
        from negocios.models import Negocio

        usuario = get_user_model().objects.create_user(username="inicial")
        serializer = CrearNegocioSerializer(data={"nombre": "Tienda", "tipo": "tienda", "administrador_id": usuario.pk})
        self.assertTrue(serializer.is_valid())
        usuario.is_active = False
        usuario.save()
        with self.assertRaises(ValidationError):
            serializer.save()
        self.assertFalse(Negocio.objects.exists())

    def test_rollback_no_deja_permisos_nuevos_en_catalogo_incompleto(self):
        from negocios.models import Negocio

        usuario = get_user_model().objects.create_user(username="inicial")
        permisos_anteriores = set(Permiso.objects.values_list("id", "codigo", "ambito"))
        with patch.object(Membresia, "save", side_effect=RuntimeError("Fallo simulado")):
            with self.assertRaises(RuntimeError):
                crear_negocio("Tienda", "tienda", usuario.pk)
        for modelo in (Negocio, Rol, RolPermiso, Membresia):
            self.assertFalse(modelo.objects.exists(), modelo.__name__)
        self.assertEqual(set(Permiso.objects.values_list("id", "codigo", "ambito")), permisos_anteriores)

    def test_integridad_inesperada_no_se_oculta_como_username_duplicado(self):
        with patch.object(get_user_model().objects, "create_user", side_effect=IntegrityError("Fallo simulado")):
            with self.assertRaises(IntegrityError):
                crear_usuario("usuario", PASSWORD)


class ConcurrenciaUsuariosTests(TransactionTestCase):
    def test_altas_concurrentes_de_username_producen_una_cuenta_y_error_de_campo(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections, connections

        manager = get_user_model().objects
        original = manager.create_user
        barrier = Barrier(2, timeout=15)

        def crear_al_mismo_tiempo(**kwargs):
            barrier.wait()
            return original(**kwargs)

        def alta():
            close_old_connections()
            try:
                return crear_usuario("concurrente", PASSWORD).pk
            except ValidationError as error:
                self.assertIn("username", error.message_dict)
                return "duplicado"
            finally:
                connections.close_all()

        with patch.object(manager, "create_user", side_effect=crear_al_mismo_tiempo):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(alta) for _ in range(2)]
                resultados = [f.result(timeout=30) for f in futures]
        self.assertEqual(get_user_model().objects.filter(username="concurrente").count(), 1)
        self.assertEqual(resultados.count("duplicado"), 1)

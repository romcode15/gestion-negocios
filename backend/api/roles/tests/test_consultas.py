from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accesos.catalogo import PERMISOS_NEGOCIO, PERMISOS_PLATAFORMA
from accesos.models import Membresia, Permiso, Rol, RolPermiso
from accesos.services import asignar_superadministrador, preparar_catalogo
from api.common.access import permisos_delegables, resolver_contexto_negocio
from api.roles.selectors import roles_del_negocio
from api.roles.serializers import RolSerializer
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios


CAMPOS_PERMISO = {"id", "codigo", "ambito"}
CAMPOS_ROL = {"id", "nombre", "negocio_id", "predefinido", "permiso_ids"}


def permisos_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/permisos/"


def roles_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/roles/"


def asignables_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/roles/asignables/"


class ConsultasRolesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # El catálogo completo incluye permisos de plataforma que nunca deben aparecer.
        cls.superadmin_rol = preparar_catalogo()
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.cajero = crear_rol(cls.tienda.negocio, "Cajero", ["listar_roles", "crear_rol"])
        cls.vacio = crear_rol(cls.tienda.negocio, "Sin permisos")
        cls.bodega = crear_rol(cls.ferreteria.negocio, "Bodega", ["listar_membresias"])

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def miembro(self, ctx, username, codigos):
        usuario = get_user_model().objects.create_user(username=username)
        rol = crear_rol(ctx.negocio, f"Rol {username}", codigos)
        membresia = Membresia.objects.create(usuario=usuario, negocio=ctx.negocio, rol=rol)
        return usuario, membresia

    def login(self, usuario):
        self.client.force_login(usuario)

    def assert_error(self, response, status, code):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)

    def todas_las_paginas(self, path):
        primera = self.client.get(path)
        self.assertEqual(primera.status_code, 200, primera.content)
        self.assertEqual(set(primera.data), {"count", "next", "previous", "results"})
        self.assertIsNone(primera.data["previous"])
        resultados, pagina = list(primera.data["results"]), primera.data
        while pagina["next"]:
            siguiente = self.client.get(pagina["next"])
            self.assertEqual(siguiente.status_code, 200)
            self.assertIsNotNone(siguiente.data["previous"])
            self.assertLessEqual(len(siguiente.data["results"]), 2)
            resultados += siguiente.data["results"]
            pagina = siguiente.data
        self.assertEqual(len(resultados), primera.data["count"])
        return primera.data, resultados

    # --- Permisos delegables -------------------------------------------------

    def test_admin_recibe_exactamente_los_permisos_de_negocio_paginados(self):
        self.login(self.tienda.administrador)
        primera, permisos = self.todas_las_paginas(permisos_url(self.tienda.negocio.pk))
        self.assertEqual(primera["count"], len(PERMISOS_NEGOCIO))
        self.assertEqual(len(primera["results"]), 2)
        self.assertTrue(all(set(p) == CAMPOS_PERMISO for p in permisos))
        self.assertEqual({p["codigo"] for p in permisos}, set(PERMISOS_NEGOCIO))
        self.assertTrue(all(p["ambito"] == Permiso.Ambito.NEGOCIO for p in permisos))
        self.assertFalse({p["codigo"] for p in permisos} & set(PERMISOS_PLATAFORMA))
        self.assertEqual([p["id"] for p in permisos], sorted(p["id"] for p in permisos))

    def test_permisos_devueltos_coinciden_con_los_delegables_del_actor(self):
        usuario, membresia = self.miembro(self.tienda, "supervisor", ["crear_rol", "listar_membresias"])
        self.login(usuario)
        _, permisos = self.todas_las_paginas(permisos_url(self.tienda.negocio.pk))
        contexto = resolver_contexto_negocio(usuario, self.tienda.negocio.pk, "crear_rol")
        esperados = list(permisos_delegables(contexto).values_list("id", flat=True))
        self.assertEqual([p["id"] for p in permisos], esperados)
        self.assertEqual({p["codigo"] for p in permisos}, {"crear_rol", "listar_membresias"})

    # --- Roles del negocio ---------------------------------------------------

    def test_roles_paginados_en_varias_paginas_y_ordenados(self):
        self.login(self.tienda.administrador)
        primera, roles = self.todas_las_paginas(roles_url(self.tienda.negocio.pk))
        esperados = list(Rol.objects.filter(negocio=self.tienda.negocio).order_by("id").values_list("id", flat=True))
        self.assertEqual(primera["count"], 3)
        self.assertIsNotNone(primera["next"])
        self.assertEqual([r["id"] for r in roles], esperados)
        self.assertTrue(all(set(r) == CAMPOS_ROL for r in roles))
        self.assert_error(self.client.get(roles_url(self.tienda.negocio.pk) + "?page=999"), 404, "not_found")

    def test_rol_incluye_admin_predefinido_y_permiso_ids_numericos(self):
        self.login(self.tienda.administrador)
        _, roles = self.todas_las_paginas(roles_url(self.tienda.negocio.pk))
        por_id = {r["id"]: r for r in roles}
        admin = por_id[self.tienda.rol.pk]
        self.assertTrue(admin["predefinido"])
        self.assertEqual(admin["negocio_id"], self.tienda.negocio.pk)
        self.assertEqual(
            admin["permiso_ids"],
            sorted(RolPermiso.objects.filter(rol=self.tienda.rol).values_list("permiso_id", flat=True)),
        )
        self.assertTrue(all(isinstance(i, int) for i in admin["permiso_ids"]))
        self.assertFalse(por_id[self.cajero.pk]["predefinido"])
        self.assertEqual(len(por_id[self.cajero.pk]["permiso_ids"]), 2)
        self.assertEqual(por_id[self.vacio.pk]["permiso_ids"], [])

    def test_ultima_pagina_y_pagina_fuera_de_rango(self):
        # El rol del actor siempre pertenece al negocio, así que results nunca queda vacío
        # por la API; la lista vacía se cubre con permiso_ids y con el selector.
        self.login(self.tienda.administrador)
        response = self.client.get(roles_url(self.tienda.negocio.pk) + "?page=2")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["next"])
        self.assert_error(self.client.get(permisos_url(self.tienda.negocio.pk) + "?page=4"), 404, "not_found")

    def test_lista_vacia_paginada(self):
        self.login(self.tienda.administrador)
        with patch("api.roles.views.roles_del_negocio", return_value=Rol.objects.none()):
            response = self.client.get(roles_url(self.tienda.negocio.pk))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"count": 0, "next": None, "previous": None, "results": []})

    def test_excluye_roles_globales_y_de_otro_negocio(self):
        for ctx, otro in ((self.tienda, self.ferreteria), (self.ferreteria, self.tienda)):
            with self.subTest(negocio=ctx.negocio.nombre):
                self.login(ctx.administrador)
                _, roles = self.todas_las_paginas(roles_url(ctx.negocio.pk))
                ids = {r["id"] for r in roles}
                self.assertTrue(all(r["negocio_id"] == ctx.negocio.pk for r in roles))
                self.assertNotIn(self.superadmin_rol.pk, ids)
                self.assertFalse(ids & set(Rol.objects.filter(negocio=otro.negocio).values_list("id", flat=True)))

    def test_consulta_de_roles_sin_n_mas_uno(self):
        for i in range(4):
            crear_rol(self.tienda.negocio, f"Extra {i}", PERMISOS_NEGOCIO[: i + 1])
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)
        # Una consulta para roles y otra para todos sus permisos, sin importar cuántos roles haya.
        with self.assertNumQueries(2):
            datos = RolSerializer(roles_del_negocio(contexto), many=True).data
        self.assertEqual(len(datos), 7)

    # --- Autorización --------------------------------------------------------

    def test_permisos_independientes_por_ruta(self):
        solo_listar, _ = self.miembro(self.tienda, "solo_listar", ["listar_roles"])
        self.login(solo_listar)
        self.assertEqual(self.client.get(roles_url(self.tienda.negocio.pk)).status_code, 200)
        self.assert_error(self.client.get(permisos_url(self.tienda.negocio.pk)), 403, "permission_denied")

        solo_crear, _ = self.miembro(self.tienda, "solo_crear", ["crear_rol"])
        self.login(solo_crear)
        self.assertEqual(self.client.get(permisos_url(self.tienda.negocio.pk)).status_code, 200)
        self.assert_error(self.client.get(roles_url(self.tienda.negocio.pk)), 403, "permission_denied")

    def test_sesion_ausente(self):
        for path in (permisos_url(self.tienda.negocio.pk), roles_url(self.tienda.negocio.pk)):
            with self.subTest(path=path):
                self.assert_error(self.client.get(path), 403, "not_authenticated")

    def test_permiso_ausente(self):
        usuario, _ = self.miembro(self.tienda, "sin_permisos", ["listar_membresias"])
        self.login(usuario)
        for path in (permisos_url(self.tienda.negocio.pk), roles_url(self.tienda.negocio.pk)):
            with self.subTest(path=path):
                self.assert_error(self.client.get(path), 403, "permission_denied")

    def test_negocio_inactivo(self):
        self.tienda.negocio.activo = False
        self.tienda.negocio.save()
        self.login(self.tienda.administrador)
        for path in (permisos_url(self.tienda.negocio.pk), roles_url(self.tienda.negocio.pk)):
            with self.subTest(path=path):
                self.assert_error(self.client.get(path), 403, "permission_denied")

    def test_membresia_inactiva(self):
        self.tienda.membresia.activo = False
        self.tienda.membresia.save()
        self.login(self.tienda.administrador)
        for path in (permisos_url(self.tienda.negocio.pk), roles_url(self.tienda.negocio.pk)):
            with self.subTest(path=path):
                self.assert_error(self.client.get(path), 403, "permission_denied")

    def test_negocio_no_autorizado_o_inexistente(self):
        self.login(self.tienda.administrador)
        for negocio_id in (self.ferreteria.negocio.pk, 999999):
            for path in (permisos_url(negocio_id), roles_url(negocio_id)):
                with self.subTest(path=path):
                    self.assert_error(self.client.get(path), 403, "permission_denied")

    def test_superadministrador_sin_membresia_no_accede(self):
        plataforma = get_user_model().objects.create_user(username="plataforma", is_superuser=True)
        asignar_superadministrador(plataforma)
        self.login(plataforma)
        for path in (permisos_url(self.tienda.negocio.pk), roles_url(self.tienda.negocio.pk)):
            with self.subTest(path=path):
                self.assert_error(self.client.get(path), 403, "permission_denied")

    def test_permisos_es_solo_lectura(self):
        self.login(self.tienda.administrador)
        self.client.get("/api/v1/auth/csrf/")
        token = self.client.cookies["csrftoken"].value
        response = self.client.post(permisos_url(self.tienda.negocio.pk), {}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assert_error(response, 405, "method_not_allowed")

    def test_asignables_con_cada_permiso_minimo_sin_listar_roles(self):
        for permiso in ("crear_membresia", "asignar_rol"):
            with self.subTest(permiso=permiso):
                usuario, membresia = self.miembro(self.tienda, permiso, [permiso])
                self.login(usuario)
                primera, roles = self.todas_las_paginas(asignables_url(self.tienda.negocio.pk))
                self.assertEqual(primera["count"], 2)
                self.assertEqual({r["id"] for r in roles}, {self.vacio.pk, membresia.rol_id})
                self.assertTrue(all(set(r) == CAMPOS_ROL for r in roles))
                self.assertTrue(all(r["negocio_id"] == self.tienda.negocio.pk for r in roles))
                self.assert_error(self.client.get(roles_url(self.tienda.negocio.pk)), 403, "permission_denied")
                self.assert_error(self.client.get(permisos_url(self.tienda.negocio.pk)), 403, "permission_denied")

    def test_asignables_admin_paginacion_y_aislamiento(self):
        self.login(self.tienda.administrador)
        primera, roles = self.todas_las_paginas(asignables_url(self.tienda.negocio.pk))
        self.assertEqual(primera["count"], 3)
        self.assertEqual({r["id"] for r in roles}, {self.tienda.rol.pk, self.cajero.pk, self.vacio.pk})
        self.assert_error(self.client.get(asignables_url(self.tienda.negocio.pk) + "?page=999"), 404, "not_found")
        for negocio_id in (self.ferreteria.negocio.pk, 999999):
            self.assert_error(self.client.get(asignables_url(negocio_id)), 403, "permission_denied")

    def test_asignables_rechaza_lectores_y_creadores_de_roles(self):
        for permiso in ("listar_roles", "crear_rol", "listar_membresias"):
            usuario, _ = self.miembro(self.tienda, permiso, [permiso])
            self.login(usuario)
            self.assert_error(self.client.get(asignables_url(self.tienda.negocio.pk)), 403, "permission_denied")

    def test_asignables_revalida_permisos_y_contexto_activo(self):
        self.assert_error(self.client.get(asignables_url(self.tienda.negocio.pk)), 403, "not_authenticated")
        self.login(self.tienda.administrador)
        RolPermiso.objects.filter(rol=self.tienda.rol, permiso__codigo="crear_rol").delete()
        _, roles = self.todas_las_paginas(asignables_url(self.tienda.negocio.pk))
        self.assertNotIn(self.cajero.pk, {r["id"] for r in roles})
        for objeto in (self.tienda.negocio, self.tienda.membresia, self.tienda.administrador):
            campo = "is_active" if objeto == self.tienda.administrador else "activo"
            setattr(objeto, campo, False)
            objeto.save()
            self.assertEqual(self.client.get(asignables_url(self.tienda.negocio.pk)).status_code, 403)
            setattr(objeto, campo, True)
            objeto.save()

    def test_asignables_no_acepta_escrituras(self):
        self.login(self.tienda.administrador)
        self.client.get("/api/v1/auth/csrf/")
        response = self.client.post(asignables_url(self.tienda.negocio.pk), {}, format="json",
                                    HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)
        self.assert_error(response, 405, "method_not_allowed")

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from accesos.catalogo import ADMINISTRADOR_NEGOCIO, PERMISOS_NEGOCIO, PERMISOS_PLATAFORMA
from accesos.models import Membresia, Permiso, Rol, RolPermiso
from accesos.services import preparar_catalogo
from api.common.access import resolver_contexto_negocio
from api.roles import services
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios


def roles_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/roles/"


class CrearRolTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.superadmin_rol = preparar_catalogo()
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.permisos = {p.codigo: p.pk for p in Permiso.objects.all()}

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.tienda.administrador)

    # --- Utilidades ----------------------------------------------------------

    def login(self, usuario):
        self.client.force_login(usuario)
        self.client.get("/api/v1/auth/csrf/")
        self.csrf = self.client.cookies["csrftoken"].value

    def post(self, datos, negocio_id=None, csrf=True):
        extra = {"HTTP_X_CSRFTOKEN": self.csrf} if csrf else {}
        return self.client.post(roles_url(negocio_id or self.tienda.negocio.pk), datos, format="json", **extra)

    def ids(self, *codigos):
        return [self.permisos[c] for c in codigos]

    def miembro(self, username, codigos, ctx=None):
        ctx = ctx or self.tienda
        usuario = get_user_model().objects.create_user(username=username)
        rol = crear_rol(ctx.negocio, f"Rol {username}", codigos)
        Membresia.objects.create(usuario=usuario, negocio=ctx.negocio, rol=rol)
        return usuario

    def assert_error(self, response, status, code, campo=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)
        if campo:
            self.assertEqual(list(response.data["errors"]), [campo], response.data)
            self.assertIsInstance(response.data["errors"][campo], list)

    def conteos(self):
        return Rol.objects.count(), RolPermiso.objects.count()

    # --- Creación válida -----------------------------------------------------

    def test_crea_rol_valido_visible_en_get_y_en_postgresql(self):
        ids = self.ids("listar_roles", "crear_rol")
        response = self.post({"nombre": "Cajero", "permiso_ids": ids})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(set(response.data), {"id", "nombre", "negocio_id", "predefinido", "permiso_ids"})
        self.assertEqual(response.data["nombre"], "Cajero")
        self.assertEqual(response.data["negocio_id"], self.tienda.negocio.pk)
        self.assertFalse(response.data["predefinido"])
        self.assertEqual(response.data["permiso_ids"], sorted(ids))

        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT r.negocio_id, r.predefinido, array_agg(rp.permiso_id ORDER BY rp.permiso_id) "
                f"FROM {Rol._meta.db_table} r JOIN {RolPermiso._meta.db_table} rp ON rp.rol_id = r.id "
                f"WHERE r.id = %s GROUP BY r.id",
                [response.data["id"]],
            )
            self.assertEqual(cursor.fetchone(), (self.tienda.negocio.pk, False, sorted(ids)))

        listado = self.client.get(roles_url(self.tienda.negocio.pk) + "?page=1")
        ids_listados = [r["id"] for r in listado.data["results"]]
        while listado.data["next"]:
            listado = self.client.get(listado.data["next"])
            ids_listados += [r["id"] for r in listado.data["results"]]
        self.assertIn(response.data["id"], ids_listados)

    def test_lista_vacia_crea_rol_sin_permisos(self):
        response = self.post({"nombre": "Invitado", "permiso_ids": []})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["permiso_ids"], [])
        self.assertFalse(RolPermiso.objects.filter(rol_id=response.data["id"]).exists())

    def test_actor_solo_delega_los_permisos_que_posee(self):
        self.login(self.miembro("supervisor", ["crear_rol", "listar_membresias"]))
        ok = self.post({"nombre": "Ayudante", "permiso_ids": self.ids("listar_membresias")})
        self.assertEqual(ok.status_code, 201, ok.content)
        antes = self.conteos()
        self.assert_error(self.post({"nombre": "Escalado", "permiso_ids": self.ids("asignar_rol")}),
                          400, "validation_error", "permiso_ids")
        self.assertEqual(self.conteos(), antes)

    # --- Nombre --------------------------------------------------------------

    def test_nombre_duplicado_en_el_negocio_incluido_predefinido(self):
        self.assertEqual(self.post({"nombre": "Cajero", "permiso_ids": []}).status_code, 201)
        antes = self.conteos()
        for nombre in ("Cajero", ADMINISTRADOR_NEGOCIO):
            with self.subTest(nombre=nombre):
                self.assert_error(self.post({"nombre": nombre, "permiso_ids": self.ids("listar_roles")}),
                                  400, "validation_error", "nombre")
        self.assertEqual(self.conteos(), antes)

    def test_mismo_nombre_permitido_en_otro_negocio(self):
        self.assertEqual(self.post({"nombre": "Cajero", "permiso_ids": []}).status_code, 201)
        self.login(self.ferreteria.administrador)
        response = self.post({"nombre": "Cajero", "permiso_ids": []}, self.ferreteria.negocio.pk)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["negocio_id"], self.ferreteria.negocio.pk)
        self.assertEqual(Rol.objects.filter(nombre="Cajero").count(), 2)

    def test_nombre_requerido_vacio_o_largo(self):
        antes = self.conteos()
        for datos in ({"permiso_ids": []}, {"nombre": "", "permiso_ids": []},
                      {"nombre": "   ", "permiso_ids": []}, {"nombre": "x" * 151, "permiso_ids": []},
                      {"nombre": None, "permiso_ids": []}):
            with self.subTest(datos=datos):
                self.assert_error(self.post(datos), 400, "validation_error", "nombre")
        self.assertEqual(self.conteos(), antes)

    def test_nombre_con_espacios_se_normaliza_y_sigue_siendo_unico(self):
        self.assertEqual(self.post({"nombre": "  Cajero  ", "permiso_ids": []}).data["nombre"], "Cajero")
        self.assert_error(self.post({"nombre": "Cajero ", "permiso_ids": []}), 400, "validation_error", "nombre")

    def test_choque_de_unicidad_concurrente_responde_400_y_no_500(self):
        # Simula que otra solicitud creó el nombre entre la validación previa y el INSERT.
        self.assertEqual(self.post({"nombre": "Cajero", "permiso_ids": []}).status_code, 201)
        antes = self.conteos()
        reales = iter([False, True])
        with patch.object(services, "nombre_en_uso", side_effect=lambda *a: next(reales)), \
             patch("api.roles.serializers.nombre_en_uso", return_value=False):
            response = self.post({"nombre": "Cajero", "permiso_ids": self.ids("listar_roles")})
        self.assert_error(response, 400, "validation_error", "nombre")
        self.assertEqual(self.conteos(), antes)

    # --- permiso_ids ---------------------------------------------------------

    def test_permisos_invalidos_no_guardan_nada(self):
        plataforma = self.permisos[PERMISOS_PLATAFORMA[0]]
        listar = self.permisos["listar_roles"]
        antes = self.conteos()
        for valor in ([999999], [plataforma], [listar, plataforma], [listar, listar],
                      [0], [-1], ["abc"], [1.5], "abc", None, {"id": listar}, [None]):
            with self.subTest(permiso_ids=valor):
                self.assert_error(self.post({"nombre": "Nuevo", "permiso_ids": valor}),
                                  400, "validation_error", "permiso_ids")
        self.assert_error(self.post({"nombre": "Nuevo"}), 400, "validation_error", "permiso_ids")
        self.assertEqual(self.conteos(), antes)
        self.assertFalse(Rol.objects.filter(nombre="Nuevo").exists())

    def test_permisos_no_delegables_rechazados_aun_siendo_de_negocio(self):
        self.login(self.miembro("limitado", ["crear_rol"]))
        antes = self.conteos()
        for codigo in PERMISOS_NEGOCIO:
            if codigo == "crear_rol":
                continue
            with self.subTest(codigo=codigo):
                self.assert_error(self.post({"nombre": f"Con {codigo}", "permiso_ids": self.ids(codigo)}),
                                  400, "validation_error", "permiso_ids")
        self.assertEqual(self.conteos(), antes)

    # --- Campos manipulados --------------------------------------------------

    def test_campos_manipulados_no_crean_roles_globales_ni_ajenos(self):
        response = self.post({
            "nombre": "Manipulado", "permiso_ids": [], "id": 99999,
            "negocio_id": self.ferreteria.negocio.pk, "negocio": None, "predefinido": True,
            "ambito": "plataforma",
        })
        self.assertEqual(response.status_code, 201, response.content)
        rol = Rol.objects.get(pk=response.data["id"])
        self.assertNotEqual(rol.pk, 99999)
        self.assertEqual(rol.negocio_id, self.tienda.negocio.pk)
        self.assertFalse(rol.predefinido)
        self.assertFalse(Rol.objects.filter(negocio__isnull=True, nombre="Manipulado").exists())
        self.assertFalse(Rol.objects.filter(negocio=self.ferreteria.negocio, nombre="Manipulado").exists())

    # --- Autorización, CSRF y contexto ---------------------------------------

    def test_sesion_ausente(self):
        anonimo = APIClient(enforce_csrf_checks=True)
        self.assert_error(anonimo.post(roles_url(self.tienda.negocio.pk), {"nombre": "X", "permiso_ids": []},
                                       format="json"), 403, "not_authenticated")
        self.assertFalse(Rol.objects.filter(nombre="X").exists())

    def test_csrf_ausente_o_invalido(self):
        self.assert_error(self.post({"nombre": "X", "permiso_ids": []}, csrf=False), 403, "csrf_failed")
        self.csrf = "token-invalido"
        self.assert_error(self.post({"nombre": "X", "permiso_ids": []}), 403, "csrf_failed")
        self.assertFalse(Rol.objects.filter(nombre="X").exists())

    def test_permiso_crear_rol_independiente_de_listar_roles(self):
        self.login(self.miembro("solo_listar", ["listar_roles"]))
        self.assert_error(self.post({"nombre": "X", "permiso_ids": []}), 403, "permission_denied")
        self.assertEqual(self.client.get(roles_url(self.tienda.negocio.pk)).status_code, 200)

        self.login(self.miembro("solo_crear", ["crear_rol"]))
        self.assertEqual(self.post({"nombre": "Y", "permiso_ids": []}).status_code, 201)
        self.assert_error(self.client.get(roles_url(self.tienda.negocio.pk)), 403, "permission_denied")

    def test_negocio_o_membresia_inactivos(self):
        for objeto in (self.tienda.negocio, self.tienda.membresia):
            with self.subTest(objeto=type(objeto).__name__):
                objeto.activo = False
                objeto.save()
                self.assert_error(self.post({"nombre": "X", "permiso_ids": []}), 403, "permission_denied")
                objeto.activo = True
                objeto.save()
        self.assertFalse(Rol.objects.filter(nombre="X").exists())

    def test_negocio_ajeno_o_inexistente(self):
        for negocio_id in (self.ferreteria.negocio.pk, 999999):
            with self.subTest(negocio_id=negocio_id):
                self.assert_error(self.post({"nombre": "X", "permiso_ids": []}, negocio_id), 403, "permission_denied")
        self.assertFalse(Rol.objects.filter(nombre="X").exists())

    # --- Atomicidad ----------------------------------------------------------

    def test_fallo_al_guardar_asociaciones_revierte_todo(self):
        antes = self.conteos()
        with patch.object(RolPermiso, "save", side_effect=RuntimeError("Fallo simulado")):
            with self.assertRaises(RuntimeError):
                self.post({"nombre": "Fallido", "permiso_ids": self.ids("listar_roles", "crear_rol")})
        self.assertEqual(self.conteos(), antes)
        self.assertFalse(Rol.objects.filter(nombre="Fallido").exists())

    def test_fallo_en_segunda_asociacion_no_deja_la_primera(self):
        original, llamadas = RolPermiso.save, []

        def falla_en_la_segunda(instancia, *args, **kwargs):
            llamadas.append(instancia.permiso_id)
            if len(llamadas) == 2:
                raise RuntimeError("Fallo simulado")
            return original(instancia, *args, **kwargs)

        antes = self.conteos()
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk, "crear_rol")
        with patch.object(RolPermiso, "save", falla_en_la_segunda):
            with self.assertRaises(RuntimeError):
                services.crear_rol(contexto, "Parcial", self.ids("listar_roles", "crear_rol"))
        self.assertEqual(len(llamadas), 2)
        self.assertEqual(self.conteos(), antes)

    def test_servicio_revalida_permisos_del_actor(self):
        usuario = self.miembro("revocado", ["crear_rol", "listar_roles"])
        contexto = resolver_contexto_negocio(usuario, self.tienda.negocio.pk, "crear_rol")
        RolPermiso.objects.filter(rol=contexto.membresia.rol, permiso__codigo="listar_roles").delete()
        with self.assertRaises(ValidationError) as error:
            services.crear_rol(contexto, "Tardío", self.ids("listar_roles"))
        self.assertIn("permiso_ids", error.exception.detail)
        self.assertFalse(Rol.objects.filter(nombre="Tardío").exists())

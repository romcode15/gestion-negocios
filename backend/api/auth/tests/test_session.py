from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accesos.models import Membresia, RolPermiso, UsuarioRolGlobal
from accesos.services import asignar_superadministrador
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios


class SesionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.usuario = get_user_model().objects.create_user(username="compartido", password="Prueba-sesion-123!")
        cls.rol_tienda = crear_rol(cls.tienda.negocio, "Consulta", ["listar_roles"])
        cls.rol_ferreteria = crear_rol(cls.ferreteria.negocio, "Otro", ["listar_membresias"])
        Membresia.objects.create(usuario=cls.usuario, negocio=cls.tienda.negocio, rol=cls.rol_tienda)
        Membresia.objects.create(usuario=cls.usuario, negocio=cls.ferreteria.negocio, rol=cls.rol_ferreteria)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self):
        response = self.client.get("/api/v1/auth/csrf/")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")
        return self.client.cookies["csrftoken"].value

    def login(self, password="Prueba-sesion-123!", username="compartido", token=None):
        return self.client.post("/api/v1/auth/login/", {"username": username, "password": password},
                                format="json", HTTP_X_CSRFTOKEN=token or self.csrf())

    def test_ciclo_login_recarga_logout_y_rotacion_csrf(self):
        anterior = self.csrf()
        response = self.login(token=anterior)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {"usuario", "permisos_globales", "negocios"})
        self.assertEqual(set(response.data["usuario"]), {"id", "username", "is_active"})
        self.assertEqual(response.data["usuario"]["id"], self.usuario.pk)
        self.assertEqual(response.data["permisos_globales"], [])
        self.assertNotEqual(anterior, self.client.cookies["csrftoken"].value)
        self.assertIn("no-store", response["Cache-Control"])
        recarga = APIClient(enforce_csrf_checks=True)
        recarga.cookies = self.client.cookies.copy()
        self.assertEqual(recarga.get("/api/v1/auth/me/").data, response.data)
        fallo = self.client.post("/api/v1/auth/logout/", HTTP_X_CSRFTOKEN=anterior)
        self.assertEqual(fallo.data["code"], "csrf_failed")
        actual = self.client.cookies["csrftoken"].value
        logout = self.client.post("/api/v1/auth/logout/", HTTP_X_CSRFTOKEN=actual)
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(logout.content, b"")
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["code"], "not_authenticated")
        self.assertEqual(recarga.get("/api/v1/auth/me/").data["code"], "not_authenticated")

    def test_login_requiere_csrf_sin_sesion(self):
        for token in (None, "invalido"):
            with self.subTest(token=token):
                headers = {"HTTP_X_CSRFTOKEN": token} if token else {}
                response = self.client.post("/api/v1/auth/login/", {"username": "compartido", "password": "x"}, format="json", **headers)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["code"], "csrf_failed")
                self.assertEqual(response.json()["errors"], {})

    def test_credenciales_invalidas_mismo_mensaje_y_estado(self):
        primero = self.login(password="incorrecta")
        segundo = self.login(username="no_existe")
        self.assertEqual(primero.status_code, 400)
        self.assertEqual(primero.data, segundo.data)
        self.assertEqual(primero.data["code"], "invalid_credentials")
        self.usuario.is_active = False
        self.usuario.save(update_fields=["is_active"])
        self.assertEqual(self.login().data, primero.data)

    def test_campos_requeridos_con_errores_por_campo(self):
        response = self.client.post("/api/v1/auth/login/", {}, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")
        self.assertEqual(set(response.data["errors"]), {"username", "password"})
        self.assertTrue(all(isinstance(v, list) for v in response.data["errors"].values()))

    def test_me_y_logout_sin_sesion(self):
        for response in (self.client.get("/api/v1/auth/me/"), self.client.post("/api/v1/auth/logout/")):
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.data["code"], "not_authenticated")

    def test_sesion_separa_permisos_de_cada_negocio(self):
        negocios = self.login().data["negocios"]
        self.assertEqual(negocios, [
            {"id": self.tienda.negocio.pk, "nombre": self.tienda.negocio.nombre,
             "rol_id": self.rol_tienda.pk, "permisos": ["listar_roles"]},
            {"id": self.ferreteria.negocio.pk, "nombre": self.ferreteria.negocio.nombre,
             "rol_id": self.rol_ferreteria.pk, "permisos": ["listar_membresias"]},
        ])

    def test_sesion_refresca_roles_permisos_y_estados_sin_nuevo_login(self):
        self.login()
        miembro = self.usuario.membresias.get(negocio=self.tienda.negocio)
        miembro.rol = self.tienda.rol
        miembro.save()
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["negocios"][0]["rol_id"], self.tienda.rol.pk)
        RolPermiso.objects.filter(rol=self.tienda.rol, permiso__codigo="crear_rol").delete()
        self.assertNotIn("crear_rol", self.client.get("/api/v1/auth/me/").data["negocios"][0]["permisos"])
        miembro.activo = False
        miembro.save()
        self.assertEqual(len(self.client.get("/api/v1/auth/me/").data["negocios"]), 1)
        self.ferreteria.negocio.activo = False
        self.ferreteria.negocio.save()
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["negocios"], [])

    def test_cuenta_desactivada_invalida_sesion(self):
        self.login()
        self.usuario.is_active = False
        self.usuario.save()
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["code"], "not_authenticated")

    def test_permisos_globales_actualizados_sin_otorgar_negocios(self):
        usuario = get_user_model().objects.create_user(username="plataforma", password="Prueba-sesion-123!")
        asignar_superadministrador(usuario)
        response = self.login(username="plataforma")
        self.assertEqual(len(response.data["permisos_globales"]), 4)
        self.assertEqual(response.data["negocios"], [])
        UsuarioRolGlobal.objects.filter(usuario=usuario).delete()
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["permisos_globales"], [])

    def test_origen_no_confiable_rechazado_aunque_token_sea_valido(self):
        response = self.client.post("/api/v1/auth/login/", {"username": "compartido", "password": "x"},
                                    format="json", HTTP_X_CSRFTOKEN=self.csrf(), HTTP_ORIGIN="https://ajeno.example")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "csrf_failed")

    @override_settings(ALLOWED_HOSTS=["testserver", "localhost"])
    def test_proxy_mismo_host_de_vite_no_necesita_excepcion_csrf(self):
        response = self.client.post("/api/v1/auth/login/", {"username": "compartido", "password": "Prueba-sesion-123!"},
                                    format="json", HTTP_X_CSRFTOKEN=self.csrf(),
                                    HTTP_HOST="localhost:5173", HTTP_ORIGIN="http://localhost:5173")
        self.assertEqual(response.status_code, 200)

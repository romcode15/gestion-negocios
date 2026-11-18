from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accesos.models import Membresia, Rol
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios


class CambioRolTests(TestCase):
    def setUp(self):
        self.tienda, self.ferreteria = crear_dos_negocios()
        self.rol_inicial = crear_rol(self.tienda.negocio, "Inicial")
        self.rol_nuevo = crear_rol(self.tienda.negocio, "Nuevo", ["listar_membresias"])
        self.usuario = get_user_model().objects.create_user(username="miembro", password="Clave!Prueba-9283")
        self.membresia = Membresia.objects.create(
            usuario=self.usuario, negocio=self.tienda.negocio, rol=self.rol_inicial,
        )
        self.url = f"/api/v1/negocios/{self.tienda.negocio.pk}/membresias/{self.membresia.pk}/"
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.tienda.administrador)
        self.client.get("/api/v1/auth/csrf/")
        self.csrf = self.client.cookies["csrftoken"].value

    def cambiar(self, datos, url=None):
        return self.client.patch(url or self.url, datos, format="json", HTTP_X_CSRFTOKEN=self.csrf)

    def test_cambio_reflejado_en_listado_y_sesion_existente(self):
        cliente_miembro = APIClient()
        cliente_miembro.force_login(self.usuario)
        hash_anterior = self.usuario.password
        respuesta = self.cambiar({"rol_id": self.rol_nuevo.pk, "activo": False, "usuario": 999, "password": "otra"})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(set(respuesta.data), {"id", "usuario", "negocio_id", "rol_id", "activo"})
        self.membresia.refresh_from_db()
        self.usuario.refresh_from_db()
        self.assertEqual(self.membresia.rol_id, self.rol_nuevo.pk)
        self.assertTrue(self.membresia.activo)
        self.assertEqual(self.usuario.password, hash_anterior)
        listado = self.client.get(f"/api/v1/negocios/{self.tienda.negocio.pk}/membresias/")
        self.assertEqual(listado.status_code, 200)
        registro = next(m for m in listado.data["results"] if m["id"] == self.membresia.pk)
        self.assertEqual(registro["rol_id"], self.rol_nuevo.pk)
        sesion = cliente_miembro.get("/api/v1/auth/me/")
        negocio = next(n for n in sesion.data["negocios"] if n["id"] == self.tienda.negocio.pk)
        self.assertEqual(negocio["rol_id"], self.rol_nuevo.pk)
        self.assertIn("listar_membresias", negocio["permisos"])

    def test_roles_invalidos_y_campo_requerido(self):
        global_rol = Rol.objects.create(nombre="Global")
        for datos in ({"rol_id": global_rol.pk}, {"rol_id": self.ferreteria.rol.pk},
                      {"rol_id": 99999999}, {}):
            with self.subTest(datos=datos):
                respuesta = self.cambiar(datos)
                self.assertEqual(respuesta.status_code, 400)
                self.assertEqual(respuesta.data["code"], "validation_error")
                self.assertIn("rol_id", respuesta.data["errors"])
                self.membresia.refresh_from_db()
                self.assertEqual(self.membresia.rol_id, self.rol_inicial.pk)

    def test_membresia_ajena_no_existe_en_contexto_autorizado(self):
        url = f"/api/v1/negocios/{self.tienda.negocio.pk}/membresias/{self.ferreteria.membresia.pk}/"
        respuesta = self.cambiar({"rol_id": self.rol_nuevo.pk}, url)
        self.assertEqual(respuesta.status_code, 404)
        self.assertEqual(respuesta.data["code"], "not_found")
        self.ferreteria.membresia.refresh_from_db()
        self.assertEqual(self.ferreteria.membresia.rol_id, self.ferreteria.rol.pk)

    def test_sesion_csrf_y_permiso_especifico(self):
        anonimo = APIClient(enforce_csrf_checks=True).patch(self.url, {"rol_id": self.rol_nuevo.pk}, format="json")
        self.assertEqual((anonimo.status_code, anonimo.data["code"]), (403, "not_authenticated"))
        sin_csrf = self.client.patch(self.url, {"rol_id": self.rol_nuevo.pk}, format="json")
        self.assertEqual((sin_csrf.status_code, sin_csrf.data["code"]), (403, "csrf_failed"))
        creador = crear_rol(self.tienda.negocio, "Creador", ["crear_membresia"])
        self.tienda.membresia.rol = creador
        self.tienda.membresia.save(update_fields=["rol"])
        denegado = self.cambiar({"rol_id": self.rol_nuevo.pk})
        self.assertEqual((denegado.status_code, denegado.data["code"]), (403, "permission_denied"))
        self.tienda.negocio.activo = False
        self.tienda.negocio.save(update_fields=["activo"])
        inactivo = self.cambiar({"rol_id": self.rol_nuevo.pk})
        self.assertEqual((inactivo.status_code, inactivo.data["code"]), (403, "permission_denied"))

    def test_delegacion_y_ultimo_administrador(self):
        limitado = crear_rol(self.tienda.negocio, "Limitado", ["asignar_rol"])
        self.tienda.membresia.rol = limitado
        self.tienda.membresia.save(update_fields=["rol"])
        respuesta = self.cambiar({"rol_id": self.rol_nuevo.pk})
        self.assertEqual(respuesta.status_code, 400)
        self.tienda.membresia.rol = self.tienda.rol
        self.tienda.membresia.save(update_fields=["rol"])
        url_admin = f"/api/v1/negocios/{self.tienda.negocio.pk}/membresias/{self.tienda.membresia.pk}/"
        respuesta = self.cambiar({"rol_id": self.rol_inicial.pk}, url_admin)
        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("rol_id", respuesta.data["errors"])
        self.tienda.membresia.refresh_from_db()
        self.assertEqual(self.tienda.membresia.rol_id, self.tienda.rol.pk)

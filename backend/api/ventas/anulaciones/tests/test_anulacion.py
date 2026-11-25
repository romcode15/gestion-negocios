from decimal import Decimal
from uuid import uuid4

from django.test import TestCase
from rest_framework.test import APIClient

from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import crear_producto_venta_prueba, crear_venta_confirmada_prueba


class AnularVentaApiTests(TestCase):
    def setUp(self):
        self.escenario, _ = crear_dos_negocios()
        self.negocio = self.escenario.negocio
        self.actor = self.escenario.administrador
        rol = crear_rol(self.negocio, "Solo anular", ["anular_venta"])
        self.escenario.membresia.rol = rol
        self.escenario.membresia.save(update_fields=["rol"])
        producto = crear_producto_venta_prueba(self.negocio, saldo=Decimal("3.000"), usuario=self.actor, sku="API-ANULA")
        self.venta = crear_venta_confirmada_prueba(self.negocio, self.actor, detalles=[(producto, Decimal("1.000"))])
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.actor)
        self.client.get("/api/v1/auth/csrf/")

    @property
    def url(self):
        return f"/api/v1/negocios/{self.negocio.pk}/ventas/{self.venta.pk}/anulacion/"

    def post(self, data):
        return self.client.post(
            self.url,
            data,
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )

    def test_post_anula_con_permiso_minimo_y_reintento_devuelve_200(self):
        clave = str(uuid4())
        primera = self.post({"clave_operacion": clave, "motivo": "Error de cobro"})
        self.assertEqual(primera.status_code, 200)
        self.assertEqual(primera.data["id"], self.venta.pk)
        self.assertEqual(primera.data["estado"], "anulada")
        self.assertEqual(primera.data["anulacion"]["motivo"], "Error de cobro")

        repetida = self.post({"clave_operacion": clave, "motivo": "  Error de cobro  "})
        self.assertEqual(repetida.status_code, 200)
        self.assertEqual(repetida.data["id"], primera.data["id"])

    def test_csrf_campos_desconocidos_y_permiso_se_validan(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.actor)
        respuesta = client.post(self.url, {"clave_operacion": str(uuid4()), "motivo": "Sin CSRF"}, format="json")
        self.assertEqual(respuesta.status_code, 403)

        respuesta = self.post({"clave_operacion": str(uuid4()), "motivo": "x", "usuario_id": 1})
        self.assertEqual(respuesta.status_code, 400)

        rol = crear_rol(self.negocio, "Solo lectura", ["listar_ventas"])
        self.escenario.membresia.rol = rol
        self.escenario.membresia.save(update_fields=["rol"])
        respuesta = self.post({"clave_operacion": str(uuid4()), "motivo": "No permitido"})
        self.assertEqual(respuesta.status_code, 403)

    def test_venta_inexistente_es_404_y_motivo_es_obligatorio(self):
        respuesta = self.client.post(
            f"/api/v1/negocios/{self.negocio.pk}/ventas/999999/anulacion/",
            {"clave_operacion": str(uuid4()), "motivo": "No existe"},
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(respuesta.status_code, 404)
        self.assertEqual(self.post({"clave_operacion": str(uuid4())}).status_code, 400)

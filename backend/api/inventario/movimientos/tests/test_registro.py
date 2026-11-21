from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accesos.models import Membresia
from catalogo.models import Producto
from inventario.models import Existencia, MovimientoInventario
from tests.support.api import crear_rol
from tests.support.factories import crear_contexto_negocio
from tests.support.fase2 import crear_producto_prueba


def url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/movimientos/"


class RegistroMovimientoTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.contexto = crear_contexto_negocio()
        cls.producto = crear_producto_prueba(cls.contexto.negocio, unidad=Producto.Unidad.KG)
        cls.otro_contexto = crear_contexto_negocio("Otro negocio", "ferreteria", "otro_admin")
        cls.producto_ajeno = crear_producto_prueba(cls.otro_contexto.negocio)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.contexto.administrador)

    def login(self, usuario):
        self.client.force_login(usuario)
        self.client.get("/api/v1/auth/csrf/")
        self.csrf = self.client.cookies["csrftoken"].value

    def post(self, **datos):
        datos.setdefault("producto_id", self.producto.pk)
        datos.setdefault("tipo", "entrada")
        datos.setdefault("cantidad", "2.500")
        datos.setdefault("motivo", "Recepción")
        datos.setdefault("clave_operacion", str(uuid4()))
        return self.client.post(url(self.contexto.negocio.pk), datos, format="json",
                                HTTP_X_CSRFTOKEN=self.csrf)

    def assert_error(self, response, status, campos=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        if campos is not None:
            self.assertEqual(set(response.data["errors"]), set(campos), response.data)

    def saldo(self):
        return Existencia.objects.get(producto=self.producto).cantidad

    def test_entrada_y_salida_delegan_al_servicio_y_anidan_la_respuesta(self):
        entrada = self.post()
        self.assertEqual(entrada.status_code, 201, entrada.content)
        self.assertEqual(set(entrada.data), {
            "id", "negocio_id", "producto", "usuario", "tipo", "cantidad",
            "saldo_anterior", "saldo_posterior", "motivo", "clave_operacion", "creado_en",
        })
        self.assertEqual(entrada.data["cantidad"], "2.500")
        self.assertEqual(entrada.data["saldo_posterior"], "2.500")
        self.assertEqual(entrada.data["producto"], {
            "id": self.producto.pk, "negocio_id": self.contexto.negocio.pk,
            "sku": self.producto.sku, "nombre": self.producto.nombre, "unidad": "kg",
        })
        self.assertEqual(entrada.data["usuario"]["id"], self.contexto.administrador.pk)

        salida = self.post(tipo="salida", cantidad="1.125")
        self.assertEqual(salida.status_code, 201, salida.content)
        self.assertEqual(salida.data["cantidad"], "-1.125")
        self.assertEqual(salida.data["saldo_anterior"], "2.500")
        self.assertEqual(salida.data["saldo_posterior"], "1.375")
        self.assertEqual(self.saldo(), Decimal("1.375"))
        self.assertEqual(MovimientoInventario.objects.count(), 2)

    def test_reintento_identico_retorna_el_mismo_movimiento_sin_duplicar(self):
        clave = str(uuid4())
        primera = self.post(clave_operacion=clave)
        segunda = self.post(clave_operacion=clave)
        self.assertEqual((primera.status_code, segunda.status_code), (201, 201))
        self.assertEqual(primera.data["id"], segunda.data["id"])
        self.assertEqual(self.saldo(), Decimal("2.500"))
        self.assertEqual(MovimientoInventario.objects.count(), 1)

    def test_reutilizacion_incompatible_devuelve_conflicto_sin_cambio(self):
        clave = str(uuid4())
        self.assertEqual(self.post(clave_operacion=clave).status_code, 201)
        response = self.post(clave_operacion=clave, cantidad="1.000")
        self.assert_error(response, 409)
        self.assertEqual(self.saldo(), Decimal("2.500"))
        self.assertEqual(MovimientoInventario.objects.count(), 1)

    def test_validacion_y_saldo_insuficiente_no_dejan_cambios_parciales(self):
        antes = (self.saldo(), MovimientoInventario.objects.count())
        for datos, campos in (
            ({"tipo": "ajuste"}, ["tipo"]),
            ({"cantidad": "1.0000"}, ["cantidad"]),
            ({"cantidad": 1}, ["cantidad"]),
            ({"producto_id": self.producto_ajeno.pk}, ["producto_id"]),
            ({"saldo": "99"}, ["saldo"]),
        ):
            with self.subTest(datos=datos):
                response = self.post(**datos)
                self.assert_error(response, 400, campos)
        response = self.post(tipo="salida", cantidad="1.000")
        self.assert_error(response, 400, ["cantidad"])
        self.assertEqual((self.saldo(), MovimientoInventario.objects.count()), antes)

    def test_tipo_exige_su_permiso_sin_exigir_listado(self):
        usuario = get_user_model().objects.create_user(username="solo_entradas")
        rol = crear_rol(self.contexto.negocio, "Entradas", ["registrar_entrada"])
        Membresia.objects.create(usuario=usuario, negocio=self.contexto.negocio, rol=rol)
        self.login(usuario)
        self.assertEqual(self.post().status_code, 201)
        response = self.post(tipo="salida", cantidad="1.000")
        self.assert_error(response, 403)

    def test_csrf_ausente_no_escribe(self):
        antes = (self.saldo(), MovimientoInventario.objects.count())
        response = self.client.post(url(self.contexto.negocio.pk), {
            "producto_id": self.producto.pk, "tipo": "entrada", "cantidad": "1.000",
            "motivo": "CSRF", "clave_operacion": str(uuid4()),
        }, format="json")
        self.assert_error(response, 403)
        self.assertEqual((self.saldo(), MovimientoInventario.objects.count()), antes)

    def test_tipos_json_invalidos_no_generan_error_interno_ni_escritura(self):
        for tipo in ([], {}, True, 1):
            with self.subTest(tipo=tipo):
                self.assert_error(self.post(tipo=tipo), 400, campos=["tipo"])
        for producto_id in (True, str(self.producto.pk), float(self.producto.pk)):
            with self.subTest(producto_id=producto_id):
                self.assert_error(self.post(producto_id=producto_id), 400, campos=["producto_id"])
        self.assertEqual(self.saldo(), Decimal("0.000"))
        self.assertEqual(MovimientoInventario.objects.count(), 0)


@override_settings(DEBUG=True)
class DocumentacionRegistroMovimientoTests(TestCase):
    def test_swagger_documenta_get_y_post_movimientos(self):
        schema = APIClient().get("/api/schema/?format=json").data
        ruta = schema["paths"]["/api/v1/negocios/{negocio_id}/movimientos/"]
        self.assertEqual(set(ruta), {"get", "post"})
        self.assertEqual(set(schema["components"]["schemas"]["RegistrarMovimientoRequest"]["properties"]), {
            "producto_id", "tipo", "cantidad", "motivo", "clave_operacion",
        })
        self.assertEqual(set(schema["components"]["schemas"]["Movimiento"]["properties"]), {
            "id", "negocio_id", "producto", "usuario", "tipo", "cantidad",
            "saldo_anterior", "saldo_posterior", "motivo", "clave_operacion", "creado_en",
        })
        self.assertEqual(set(ruta["post"]["responses"]), {"201", "400", "403", "409"})

from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accesos.models import Membresia
from catalogo.models import Producto
from inventario.models import Existencia, MovimientoInventario
from api.inventario.services import registrar_movimiento
from tests.support.api import crear_rol
from tests.support.factories import crear_contexto_negocio
from tests.support.fase2 import crear_producto_prueba


def url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/ajustes/"


class RegistroAjusteTests(TestCase):
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
        datos.setdefault("stock_objetivo", "5.000")
        datos.setdefault("version_esperada", Existencia.objects.get(producto=self.producto).version)
        datos.setdefault("motivo", "Conteo físico")
        datos.setdefault("clave_operacion", str(uuid4()))
        return self.client.post(url(self.contexto.negocio.pk), datos, format="json",
                                HTTP_X_CSRFTOKEN=self.csrf)

    def seed_stock(self, cantidad="2.000"):
        registrar_movimiento(
            self.contexto,
            producto_id=self.producto.pk,
            tipo="entrada",
            cantidad=cantidad,
            motivo="Saldo inicial",
            clave_operacion=uuid4(),
        )

    def assert_error(self, response, status, campos=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        if campos is not None:
            self.assertEqual(set(response.data["errors"]), set(campos), response.data)

    def existencia(self):
        return Existencia.objects.get(producto=self.producto)

    def test_ajuste_positivo_y_negativo_fija_el_objetivo_y_devuelve_delta(self):
        self.seed_stock("2.000")
        primera = self.post(stock_objetivo="7.250", version_esperada=1)
        self.assertEqual(primera.status_code, 201, primera.content)
        self.assertEqual(primera.data["tipo"], "ajuste")
        self.assertEqual(primera.data["cantidad"], "5.250")
        self.assertEqual(primera.data["saldo_anterior"], "2.000")
        self.assertEqual(primera.data["saldo_posterior"], "7.250")
        self.assertEqual(primera.data["producto"]["id"], self.producto.pk)
        self.assertEqual(primera.data["usuario"]["id"], self.contexto.administrador.pk)

        segunda = self.post(stock_objetivo="3.125", version_esperada=2)
        self.assertEqual(segunda.status_code, 201, segunda.content)
        self.assertEqual(segunda.data["cantidad"], "-4.125")
        self.assertEqual(segunda.data["saldo_posterior"], "3.125")
        self.assertEqual(self.existencia().cantidad, Decimal("3.125"))
        self.assertEqual(MovimientoInventario.objects.filter(tipo="ajuste").count(), 2)

    def test_objetivo_igual_no_crea_movimiento_y_no_cambia_saldo(self):
        self.seed_stock("2.000")
        antes = (self.existencia().cantidad, self.existencia().version, MovimientoInventario.objects.count())
        response = self.post(stock_objetivo="2.000", version_esperada=1)
        self.assert_error(response, 400, ["stock_objetivo"])
        actual = self.existencia()
        self.assertEqual((actual.cantidad, actual.version, MovimientoInventario.objects.count()), antes)

    def test_version_antigua_no_sobrescribe(self):
        self.seed_stock("2.000")
        self.assertEqual(self.post(stock_objetivo="4.000", version_esperada=1).status_code, 201)
        antes = (self.existencia().cantidad, self.existencia().version, MovimientoInventario.objects.count())
        response = self.post(stock_objetivo="9.000", version_esperada=1)
        self.assert_error(response, 409)
        actual = self.existencia()
        self.assertEqual((actual.cantidad, actual.version, MovimientoInventario.objects.count()), antes)

    def test_reintento_identico_devuelve_original_aunque_la_version_haya_avanzado(self):
        self.seed_stock("2.000")
        clave = str(uuid4())
        primera = self.post(stock_objetivo="4.000", version_esperada=1, clave_operacion=clave)
        self.assertEqual(primera.status_code, 201, primera.content)
        self.assertEqual(self.post(stock_objetivo="6.000", version_esperada=2).status_code, 201)
        repetida = self.post(stock_objetivo="4.000", version_esperada=1, clave_operacion=clave)
        self.assertEqual(repetida.status_code, 201, repetida.content)
        self.assertEqual(repetida.data["id"], primera.data["id"])
        self.assertEqual(MovimientoInventario.objects.filter(tipo="ajuste").count(), 2)

    def test_clave_reutilizada_con_datos_distintos_devuelve_conflicto(self):
        self.seed_stock("2.000")
        clave = str(uuid4())
        self.assertEqual(self.post(stock_objetivo="4.000", version_esperada=1, clave_operacion=clave).status_code, 201)
        response = self.post(stock_objetivo="5.000", version_esperada=2, clave_operacion=clave)
        self.assert_error(response, 409)
        self.assertEqual(self.existencia().cantidad, Decimal("4.000"))

    def test_solo_exige_ajustar_inventario_y_no_listados(self):
        usuario = get_user_model().objects.create_user(username="solo_ajustes")
        rol = crear_rol(self.contexto.negocio, "Ajustes", ["ajustar_inventario"])
        Membresia.objects.create(usuario=usuario, negocio=self.contexto.negocio, rol=rol)
        self.login(usuario)
        response = self.post()
        self.assertEqual(response.status_code, 201, response.content)

    def test_sin_permiso_csrf_producto_ajeno_y_campos_no_permitidos(self):
        rol_usuario = get_user_model().objects.create_user(username="sin_ajustes")
        rol = crear_rol(self.contexto.negocio, "Lectura", [])
        Membresia.objects.create(usuario=rol_usuario, negocio=self.contexto.negocio, rol=rol)
        self.login(rol_usuario)
        response = self.post()
        self.assert_error(response, 403)

        self.login(self.contexto.administrador)
        antes = (self.existencia().cantidad, MovimientoInventario.objects.count())
        self.client.cookies.pop("csrftoken", None)
        response = self.client.post(url(self.contexto.negocio.pk), {
            "producto_id": self.producto.pk, "stock_objetivo": "1.000", "version_esperada": 0,
            "motivo": "CSRF", "clave_operacion": str(uuid4()),
        }, format="json")
        self.assert_error(response, 403)
        self.login(self.contexto.administrador)
        for datos, campos in (
            ({"producto_id": self.producto_ajeno.pk}, ["producto_id"]),
            ({"cantidad": "1.000"}, ["cantidad"]),
            ({"tipo": "ajuste"}, ["tipo"]),
            ({"saldo": "99"}, ["saldo"]),
            ({"stock_objetivo": "-1.000"}, ["stock_objetivo"]),
            ({"stock_objetivo": "1.0000"}, ["stock_objetivo"]),
        ):
            with self.subTest(datos=datos):
                response = self.post(**datos)
                self.assert_error(response, 400, campos)
        self.assertEqual((self.existencia().cantidad, MovimientoInventario.objects.count()), antes)


@override_settings(DEBUG=True)
class DocumentacionAjusteTests(TestCase):
    def test_swagger_documenta_solo_post_ajustes_y_su_contrato(self):
        schema = APIClient().get("/api/schema/?format=json").data
        ruta = schema["paths"]["/api/v1/negocios/{negocio_id}/ajustes/"]
        self.assertEqual(set(ruta), {"post"})
        self.assertEqual(set(schema["components"]["schemas"]["RegistrarAjusteRequest"]["properties"]), {
            "producto_id", "stock_objetivo", "version_esperada", "motivo", "clave_operacion",
        })
        self.assertEqual(set(ruta["post"]["responses"]), {"201", "400", "403", "409"})

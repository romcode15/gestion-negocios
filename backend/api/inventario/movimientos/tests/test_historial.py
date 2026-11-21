from datetime import datetime, timedelta, timezone
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accesos.models import Membresia
from catalogo.models import Producto
from inventario.models import MovimientoInventario
from tests.support.api import crear_rol
from tests.support.factories import crear_contexto_negocio
from tests.support.fase2 import crear_movimiento_prueba, crear_producto_prueba


def url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/movimientos/"


class HistorialMovimientoTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.contexto = crear_contexto_negocio()
        cls.otro_contexto = crear_contexto_negocio("Otro negocio", "ferreteria", "otro_admin")
        cls.producto = crear_producto_prueba(
            cls.contexto.negocio, sku="ARROZ-01", nombre="Arroz",
        )
        cls.otro_producto = crear_producto_prueba(
            cls.contexto.negocio, sku="CAFE-01", nombre="Cafe",
        )
        cls.inactivo = crear_producto_prueba(
            cls.contexto.negocio, sku="INACTIVO-01", nombre="Producto archivado",
        )
        cls.producto_ajeno = crear_producto_prueba(cls.otro_contexto.negocio, sku="AJENO-01")

        cls.entrada = crear_movimiento_prueba(
            cls.producto, cls.contexto.administrador, tipo="entrada", cantidad=Decimal("5.000"),
            motivo="Recepcion de arroz",
        )
        cls.salida = crear_movimiento_prueba(
            cls.producto, cls.contexto.administrador, tipo="salida", cantidad=Decimal("-2.000"),
            motivo="Venta de arroz",
        )
        cls.ajuste = crear_movimiento_prueba(
            cls.otro_producto, cls.contexto.administrador, tipo="ajuste", cantidad=Decimal("3.000"),
            motivo="Conteo de cafe",
        )
        cls.movimiento_inactivo = crear_movimiento_prueba(
            cls.inactivo, cls.contexto.administrador, tipo="entrada", cantidad=Decimal("1.000"),
            motivo="Alta archivada",
        )
        cls.inactivo.activo = False
        cls.inactivo.save(update_fields=["activo"])

        base = datetime(2026, 1, 2, 12, 0, tzinfo=timezone.utc)
        for indice, movimiento in enumerate(
            (cls.entrada, cls.salida, cls.ajuste, cls.movimiento_inactivo),
        ):
            MovimientoInventario.objects.filter(pk=movimiento.pk).update(
                creado_en=base + timedelta(minutes=indice),
            )

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.contexto.administrador)

    def login(self, usuario):
        self.client.force_login(usuario)
        self.client.get("/api/v1/auth/csrf/")

    def assert_error(self, response, status, code="validation_error", campos=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)
        if campos is not None:
            self.assertEqual(set(response.data["errors"]), set(campos), response.data)

    def todas(self, consulta=""):
        response = self.client.get(url(self.contexto.negocio.pk) + consulta)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(response.data), {"count", "next", "previous", "results"})
        resultados = list(response.data["results"])
        while response.data["next"]:
            response = self.client.get(response.data["next"])
            self.assertEqual(response.status_code, 200, response.content)
            resultados.extend(response.data["results"])
        return resultados

    def test_historial_paginado_ordenado_y_sin_campos_internos(self):
        response = self.client.get(url(self.contexto.negocio.pk))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["count"], 4)
        self.assertEqual(len(response.data["results"]), 2)
        resultados = self.todas()
        self.assertEqual([item["id"] for item in resultados], [
            self.movimiento_inactivo.pk, self.ajuste.pk, self.salida.pk, self.entrada.pk,
        ])
        campos = {
            "id", "negocio_id", "producto", "usuario", "tipo", "cantidad",
            "saldo_anterior", "saldo_posterior", "motivo", "clave_operacion", "creado_en",
        }
        self.assertTrue(all(set(item) == campos for item in resultados))
        self.assertNotIn("huella_solicitud", resultados[0])
        self.assertEqual(resultados[0]["producto"]["id"], self.inactivo.pk)
        self.assertEqual(resultados[0]["usuario"]["id"], self.contexto.administrador.pk)

    def test_filtros_por_producto_tipo_texto_y_rango_inclusivo_exclusivo(self):
        self.assertEqual(
            [item["id"] for item in self.todas(f"?producto_id={self.producto.pk}")],
            [self.salida.pk, self.entrada.pk],
        )
        self.assertEqual(
            [item["id"] for item in self.todas("?tipo=ajuste")], [self.ajuste.pk],
        )
        self.assertEqual(
            [item["id"] for item in self.todas("?search=ARROZ")],
            [self.salida.pk, self.entrada.pk],
        )
        self.assertEqual(
            [item["id"] for item in self.todas("?search=venta")], [],
        )
        self.assertEqual(
            [item["id"] for item in self.todas("?desde=2026-01-02T12:01:00Z&hasta=2026-01-02T12:03:00Z")],
            [self.ajuste.pk, self.salida.pk],
        )

    def test_filtros_invalidos_ajenos_o_repetidos(self):
        casos = {
            "?producto_id=0": ["producto_id"],
            "?tipo=otro": ["tipo"],
            "?desde=no-es-fecha": ["desde"],
            "?desde=2026-01-02": ["desde"],
            "?hasta=2026-01-02T12:00:00": ["hasta"],
            "?producto_id=1.0": ["producto_id"],
            "?producto_id=9999999999999999999999999": ["producto_id"],
            "?desde=2026-01-03T00:00:00Z&hasta=2026-01-02T00:00:00Z": ["hasta"],
            "?orden=id": ["orden"],
            "?page_size=50": ["page_size"],
            "?tipo=entrada&tipo=salida": ["tipo"],
        }
        for consulta, campos in casos.items():
            with self.subTest(consulta=consulta):
                self.assert_error(self.client.get(url(self.contexto.negocio.pk) + consulta), 400, campos=campos)
        self.assert_error(self.client.get(url(self.contexto.negocio.pk) + f"?producto_id={self.producto_ajeno.pk}"), 400, campos=["producto_id"])

    def test_permiso_de_lectura_es_independiente_de_escritura(self):
        usuario = get_user_model().objects.create_user(username="solo_historial")
        rol = crear_rol(self.contexto.negocio, "Historial", ["listar_movimientos"])
        Membresia.objects.create(usuario=usuario, negocio=self.contexto.negocio, rol=rol)
        self.login(usuario)
        self.assertEqual(self.client.get(url(self.contexto.negocio.pk)).status_code, 200)
        self.assertEqual(self.client.post(url(self.contexto.negocio.pk), {}, format="json").status_code, 403)

    def test_sin_listar_movimientos_no_consulta_y_otro_negocio_no_se_filtra(self):
        usuario = get_user_model().objects.create_user(username="solo_escritura")
        rol = crear_rol(self.contexto.negocio, "Entradas", ["registrar_entrada"])
        Membresia.objects.create(usuario=usuario, negocio=self.contexto.negocio, rol=rol)
        self.login(usuario)
        self.assert_error(self.client.get(url(self.contexto.negocio.pk)), 403, "permission_denied")
        self.assertEqual(self.client.head(url(self.contexto.negocio.pk)).status_code, 403)

        self.login(self.contexto.administrador)
        self.assert_error(self.client.get(url(self.otro_contexto.negocio.pk)), 403, "permission_denied")
        self.assert_error(self.client.get(url(self.contexto.negocio.pk) + f"?producto_id={self.producto_ajeno.pk}"), 400, campos=["producto_id"])

    def test_get_no_modifica_historial_y_metodos_de_escritura_no_estan_habilitados(self):
        antes = list(MovimientoInventario.objects.values_list("id", "creado_en"))
        csrf = self.client.cookies["csrftoken"].value
        self.assert_error(self.client.delete(url(self.contexto.negocio.pk), HTTP_X_CSRFTOKEN=csrf), 405, "method_not_allowed")
        self.assert_error(self.client.patch(url(self.contexto.negocio.pk), {}, format="json", HTTP_X_CSRFTOKEN=csrf), 405, "method_not_allowed")
        self.assertEqual(list(MovimientoInventario.objects.values_list("id", "creado_en")), antes)


@override_settings(DEBUG=True)
class DocumentacionHistorialMovimientoTests(TestCase):
    def test_swagger_documenta_get_y_post_con_filtros(self):
        schema = APIClient().get("/api/schema/?format=json").data
        ruta = schema["paths"]["/api/v1/negocios/{negocio_id}/movimientos/"]
        self.assertEqual(set(ruta), {"get", "post"})
        self.assertEqual(
            {parametro["name"] for parametro in ruta["get"]["parameters"]},
            {"negocio_id", "page", "producto_id", "tipo", "search", "desde", "hasta"},
        )
        self.assertEqual(set(ruta["get"]["responses"]), {"200", "400", "403", "404"})

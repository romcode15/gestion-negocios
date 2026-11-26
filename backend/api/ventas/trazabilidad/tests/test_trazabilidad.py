from decimal import Decimal
from uuid import uuid4

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.common.access import resolver_contexto_negocio
from api.ventas.serializers import MovimientoVentaSerializer
from api.ventas.trazabilidad.selectors import movimientos_de_venta
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import crear_producto_venta_prueba, crear_venta_confirmada_prueba
from ventas.models import VinculoMovimientoVenta
from ventas.services.anulacion import anular_venta


def movimientos_url(negocio_id, venta_id):
    return f"/api/v1/negocios/{negocio_id}/ventas/{venta_id}/movimientos/"


class BaseTrazabilidadVenta(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.otro = crear_dos_negocios()
        cls.negocio = cls.tienda.negocio
        cls.actor = cls.tienda.administrador
        cls.rol = crear_rol(cls.negocio, "Trazabilidad", ["registrar_venta", "anular_venta"])
        cls.tienda.membresia.rol = cls.rol
        cls.tienda.membresia.save(update_fields=["rol"])
        cls.producto = crear_producto_venta_prueba(
            cls.negocio, usuario=cls.actor, saldo=Decimal("10.000"), sku="TRAZ-U",
        )
        cls.kg = crear_producto_venta_prueba(
            cls.negocio, usuario=cls.actor, saldo=Decimal("5.000"), unidad="kg", sku="TRAZ-KG",
        )
        cls.litro = crear_producto_venta_prueba(
            cls.negocio, usuario=cls.actor, saldo=Decimal("4.000"), unidad="litro", sku="TRAZ-L",
        )
        cls.venta = crear_venta_confirmada_prueba(
            cls.negocio, cls.actor,
            detalles=[
                (cls.producto, Decimal("2.000")),
                (cls.kg, Decimal("1.500")),
                (cls.litro, Decimal("0.750")),
            ],
        )
        cls.contexto = resolver_contexto_negocio(cls.actor, cls.negocio.pk)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.actor)

    def login(self, usuario):
        self.client.force_login(usuario)
        self.client.get("/api/v1/auth/csrf/")

    def resultados(self, url=None):
        response = self.client.get(url or movimientos_url(self.negocio.pk, self.venta.pk))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(response.data), {"count", "next", "previous", "results"})
        return response

    def todos_los_resultados(self, url=None):
        response = self.resultados(url)
        resultados = list(response.data["results"])
        while response.data["next"]:
            response = self.client.get(response.data["next"])
            self.assertEqual(response.status_code, 200, response.content)
            resultados.extend(response.data["results"])
        return resultados


class TrazabilidadVentaTests(BaseTrazabilidadVenta):
    def test_venta_confirmada_devuelve_una_salida_por_detalle_en_orden_estable(self):
        response = self.resultados()
        self.assertEqual(response.data["count"], 3)
        self.assertEqual([item["detalle_id"] for item in response.data["results"]],
                         list(self.venta.detalles.order_by("id").values_list("id", flat=True))[:2])
        self.assertEqual([item["operacion"] for item in response.data["results"]], ["venta", "venta"])
        self.assertTrue(all(set(item) == {"detalle_id", "operacion", "movimiento"} for item in response.data["results"]))
        self.assertTrue(all(item["movimiento"]["tipo"] == "salida" for item in response.data["results"]))

    def test_venta_anulada_devuelve_salidas_y_reposiciones_sin_duplicar(self):
        anular_venta(self.contexto, self.venta.pk, clave_operacion=uuid4(), motivo="Error de cobro")
        resultados = self.todos_los_resultados()
        self.assertEqual(len(resultados), 6)
        self.assertEqual([item["operacion"] for item in resultados],
                         ["venta", "venta", "venta", "anulacion", "anulacion", "anulacion"])
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=self.venta).count(), 6)
        self.producto.activo = False
        self.producto.save(update_fields=["activo"])
        self.assertEqual(len(self.todos_los_resultados()), 6)

    def test_permiso_de_ventas_alternativo_y_aislamiento_de_negocio(self):
        rol = crear_rol(self.negocio, "Solo listar ventas", ["listar_ventas"])
        self.tienda.membresia.rol = rol
        self.tienda.membresia.save(update_fields=["rol"])
        self.assertEqual(self.resultados().status_code, 200)

        producto_ajeno = crear_producto_venta_prueba(
            self.otro.negocio, usuario=self.otro.administrador, saldo=Decimal("2.000"), sku="TRAZ-U",
        )
        venta_ajena = crear_venta_confirmada_prueba(
            self.otro.negocio, self.otro.administrador, detalles=[(producto_ajeno, Decimal("1.000"))],
        )
        response = self.client.get(movimientos_url(self.negocio.pk, venta_ajena.pk))
        self.assertEqual(response.status_code, 404)

    def test_sin_permisos_y_metodos_no_soportados(self):
        rol = crear_rol(self.negocio, "Sin ventas", ["listar_movimientos"])
        self.tienda.membresia.rol = rol
        self.tienda.membresia.save(update_fields=["rol"])
        self.assertEqual(self.client.get(movimientos_url(self.negocio.pk, self.venta.pk)).status_code, 403)
        rol = crear_rol(self.negocio, "Solo registrar ventas", ["registrar_venta"])
        self.tienda.membresia.rol = rol
        self.tienda.membresia.save(update_fields=["rol"])
        self.assertEqual(
            self.client.post(
                movimientos_url(self.negocio.pk, self.venta.pk), {}, format="json",
                HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
            ).status_code,
            405,
        )

    def test_filtros_no_admitidos_repetidos_y_pagina_invalida(self):
        url = movimientos_url(self.negocio.pk, self.venta.pk)
        self.assertEqual(self.client.get(url + "?tipo=salida").status_code, 400)
        self.assertEqual(self.client.get(url + "?page=1&page=2").status_code, 400)
        self.assertEqual(self.client.get(url + "?page=no").status_code, 404)

    def test_paginacion_y_selector_sin_n_mas_uno(self):
        url = movimientos_url(self.negocio.pk, self.venta.pk)
        primera = self.resultados(url)
        self.assertIsNotNone(primera.data["next"])
        segunda = self.client.get(primera.data["next"])
        self.assertEqual(segunda.status_code, 200)
        self.assertEqual(segunda.data["count"], 3)

        contexto = resolver_contexto_negocio(self.actor, self.negocio.pk)
        with self.assertNumQueries(2):
            datos = MovimientoVentaSerializer(
                movimientos_de_venta(contexto, self.venta.pk),
                many=True,
            ).data
        self.assertEqual(len(datos), 3)


@override_settings(DEBUG=True)
class DocumentacionTrazabilidadVentaTests(BaseTrazabilidadVenta):
    def test_openapi_documenta_respuesta_paginada_y_parametro_page(self):
        schema = self.client.get("/api/schema/?format=json")
        self.assertEqual(schema.status_code, 200)
        path = schema.data["paths"]["/api/v1/negocios/{negocio_id}/ventas/{venta_id}/movimientos/"]
        self.assertEqual(set(path), {"get"})
        operation = path["get"]
        self.assertEqual({parameter["name"] for parameter in operation["parameters"]}, {"negocio_id", "venta_id", "page"})
        self.assertEqual(operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
                         "#/components/schemas/PaginatedMovimientoVentaList")

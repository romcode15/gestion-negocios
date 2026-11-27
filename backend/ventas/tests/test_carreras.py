from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier, Lock, get_ident
from unittest.mock import patch
from uuid import uuid4

from django.db import connection, connections
from django.test import TransactionTestCase

from api.common.access import resolver_contexto_negocio
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import crear_producto_venta_prueba, crear_venta_confirmada_prueba
from ventas.models import AnulacionVenta, DetalleVenta, VinculoMovimientoVenta
from ventas.services import anulacion
from ventas.services.common import ConflictoVenta


class CarrerasAnulacionTests(TransactionTestCase):
    def setUp(self):
        self.escenario, _ = crear_dos_negocios()
        self.negocio = self.escenario.negocio
        self.actor = self.escenario.administrador
        rol = crear_rol(self.negocio, "Solo anular", ["anular_venta"])
        self.escenario.membresia.rol = rol
        self.escenario.membresia.save(update_fields=["rol"])
        self.producto = crear_producto_venta_prueba(
            self.negocio, saldo=Decimal("5.000"), usuario=self.actor, sku="CARRERA-U",
        )
        self.kg = crear_producto_venta_prueba(
            self.negocio, saldo=Decimal("3.000"), usuario=self.actor, unidad="kg", sku="CARRERA-KG",
        )
        self.venta = crear_venta_confirmada_prueba(
            self.negocio,
            self.actor,
            detalles=[(self.producto, Decimal("2.000")), (self.kg, Decimal("1.000"))],
        )

    def _operar_en_conexion(self, clave, motivo):
        try:
            contexto = resolver_contexto_negocio(self.actor, self.negocio.pk)
            try:
                venta = anulacion.anular_venta(
                    contexto, self.venta.pk, clave_operacion=clave, motivo=motivo,
                )
                return 200, venta.pk
            except ConflictoVenta as error:
                return error.status_code, error
        finally:
            connections.close_all()

    def _en_paralelo(self, operaciones):
        barrera = Barrier(2, timeout=12)
        pids = {}
        candado = Lock()
        original = anulacion.revalidar_contexto_ventas

        def sincronizar(*args, **kwargs):
            contexto = original(*args, **kwargs)
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '8s'")
                cursor.execute("SELECT pg_backend_pid()")
                pid = cursor.fetchone()[0]
            with candado:
                primera = get_ident() not in pids
                pids[get_ident()] = pid
            if primera:
                barrera.wait()
            return contexto

        with patch.object(anulacion, "revalidar_contexto_ventas", side_effect=sincronizar):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futuros = [pool.submit(self._operar_en_conexion, *operacion) for operacion in operaciones]
                resultados = [futuro.result(timeout=25) for futuro in futuros]
        self.assertEqual(len(set(pids.values())), 2)
        return resultados

    def test_misma_clave_simultanea_retorna_la_misma_anulacion(self):
        clave = uuid4()
        resultados = self._en_paralelo([(clave, "Error de cobro"), (clave, "  Error de cobro  ")])

        self.assertEqual([status for status, _ in resultados], [200, 200])
        self.assertEqual(resultados[0][1], resultados[1][1])
        self.assertEqual(AnulacionVenta.objects.filter(venta=self.venta).count(), 1)
        self.assertEqual(DetalleVenta.objects.filter(venta=self.venta).count(), 2)
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=self.venta).count(), 4)
        self.assertEqual(self.producto.existencias.get().cantidad, Decimal("5.000"))
        self.assertEqual(self.kg.existencias.get().cantidad, Decimal("3.000"))

    def test_claves_distintas_compiten_y_el_perdedor_no_escribe(self):
        resultados = self._en_paralelo([(uuid4(), "Una solicitud"), (uuid4(), "Otra solicitud")])

        self.assertCountEqual([status for status, _ in resultados], [200, 409])
        self.assertEqual(AnulacionVenta.objects.filter(venta=self.venta).count(), 1)
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=self.venta).count(), 4)
        self.assertEqual(self.producto.existencias.get().version, 3)
        self.assertEqual(self.kg.existencias.get().version, 3)

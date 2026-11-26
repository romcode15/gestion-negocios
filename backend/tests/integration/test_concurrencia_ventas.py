from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier, Lock, get_ident
from unittest.mock import patch
from uuid import uuid4

from django.db import connection, connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import crear_producto_venta_prueba, crear_venta_confirmada_prueba
from ventas.models import AnulacionVenta, DetalleVenta, VinculoMovimientoVenta
from ventas.services import anulacion


class ConcurrenciaVentasHTTPTests(TransactionTestCase):
    def setUp(self):
        self.escenario, _ = crear_dos_negocios()
        self.negocio = self.escenario.negocio
        self.actor = self.escenario.administrador
        rol = crear_rol(self.negocio, "Solo anular", ["anular_venta"])
        self.escenario.membresia.rol = rol
        self.escenario.membresia.save(update_fields=["rol"])
        self.producto = crear_producto_venta_prueba(
            self.negocio, saldo=Decimal("5.000"), usuario=self.actor, sku="HTTP-CARRERA",
        )
        self.venta = crear_venta_confirmada_prueba(
            self.negocio, self.actor, detalles=[(self.producto, Decimal("2.000"))],
        )

        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.actor)
        self.client.get("/api/v1/auth/csrf/")

    @property
    def url(self):
        return f"/api/v1/negocios/{self.negocio.pk}/ventas/{self.venta.pk}/anulacion/"

    def _post_en_conexion(self, payload):
        try:
            client = APIClient(enforce_csrf_checks=True)
            client.force_login(self.actor)
            client.get("/api/v1/auth/csrf/")
            return client.post(
                self.url,
                payload,
                format="json",
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            )
        finally:
            connections.close_all()

    def _en_paralelo(self, payloads):
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
                futuros = [pool.submit(self._post_en_conexion, payload) for payload in payloads]
                respuestas = [futuro.result(timeout=25) for futuro in futuros]
        self.assertEqual(len(set(pids.values())), 2)
        return respuestas

    def test_csrf_real_reintento_concurrente_devuelve_una_anulacion(self):
        clave = str(uuid4())
        respuestas = self._en_paralelo([
            {"clave_operacion": clave, "motivo": "Error de cobro"},
            {"clave_operacion": clave, "motivo": "  Error de cobro  "},
        ])

        self.assertEqual([respuesta.status_code for respuesta in respuestas], [200, 200])
        self.assertEqual(respuestas[0].data["id"], respuestas[1].data["id"])
        self.assertEqual(AnulacionVenta.objects.filter(venta=self.venta).count(), 1)
        self.assertEqual(DetalleVenta.objects.filter(venta=self.venta).count(), 1)
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=self.venta).count(), 2)
        self.assertEqual(self.producto.existencias.get().cantidad, Decimal("5.000"))

    def test_claves_distintas_devuelven_409_sin_reposicion_parcial(self):
        respuestas = self._en_paralelo([
            {"clave_operacion": str(uuid4()), "motivo": "Solicitud A"},
            {"clave_operacion": str(uuid4()), "motivo": "Solicitud B"},
        ])

        self.assertCountEqual([respuesta.status_code for respuesta in respuestas], [200, 409])
        self.assertEqual(AnulacionVenta.objects.filter(venta=self.venta).count(), 1)
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=self.venta).count(), 2)
        self.assertEqual(self.producto.existencias.get().cantidad, Decimal("5.000"))

    def test_sin_csrf_no_modifica_la_venta(self):
        respuesta = self.client.post(
            self.url,
            {"clave_operacion": str(uuid4()), "motivo": "Sin CSRF"},
            format="json",
        )

        self.assertEqual(respuesta.status_code, 403)
        self.assertFalse(AnulacionVenta.objects.filter(venta=self.venta).exists())
        self.assertEqual(self.producto.existencias.get().cantidad, Decimal("3.000"))

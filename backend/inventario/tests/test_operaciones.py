from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.db import connection, transaction
from django.db.transaction import TransactionManagementError
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.exceptions import PermissionDenied, ValidationError

from api.common.access import resolver_contexto_negocio
from api.inventario.services import registrar_movimiento
from inventario.models import Existencia, MovimientoInventario
from inventario.operaciones import MAX_ENTERO_API, aplicar_delta_bloqueado, bloquear_existencias
from tests.support.api import crear_rol
from tests.support.factories import crear_contexto_negocio, crear_dos_negocios
from tests.support.fase2 import crear_producto_prueba


class PrimitivasInventarioTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.otro = crear_dos_negocios()
        cls.producto = crear_producto_prueba(cls.tienda.negocio, unidad="kg")
        cls.segundo = crear_producto_prueba(cls.tienda.negocio)
        cls.ajeno = crear_producto_prueba(cls.otro.negocio)

    def aplicar(self, existencia=None, **cambios):
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)
        existencia = existencia or self.producto.existencias.get()
        return aplicar_delta_bloqueado(contexto, existencia, **dict({
            "tipo": "entrada", "delta": Decimal("1.250"), "motivo": "Prueba interna", "clave_operacion": uuid4(),
            "huella_solicitud": "e" * 64,
        }, **cambios))

    def test_bloqueo_ordenado_limita_tenant_y_no_bloquea_producto_o_categoria_por_join(self):
        with CaptureQueriesContext(connection) as consultas:
            mapa = bloquear_existencias(self.tienda.negocio.pk, [self.segundo.pk, self.ajeno.pk, self.producto.pk])
        self.assertEqual(list(mapa), [self.producto.pk, self.segundo.pk])
        self.assertEqual(len(consultas), 1)
        sql = consultas[0]["sql"]
        self.assertIn('ORDER BY "inventario_existencia"."producto_id" ASC', sql)
        self.assertIn("FOR UPDATE", sql)
        self.assertNotIn("JOIN", sql)

    def test_relectura_no_pierde_delta_ni_version_con_instancia_anterior(self):
        fila = self.producto.existencias.get()
        primero = self.aplicar(fila)
        segundo = self.aplicar(fila, delta=Decimal("0.750"))
        self.assertEqual((primero.saldo_anterior, segundo.saldo_anterior, segundo.saldo_posterior),
                         (Decimal("0.000"), Decimal("1.250"), Decimal("2.000")))
        fila.refresh_from_db()
        self.assertEqual((fila.cantidad, fila.version), (Decimal("2.000"), 2))

    def test_savepoint_revierte_saldo_y_version_si_falla_movimiento_y_deja_transaccion_utilizable(self):
        def fallar(**datos):
            self.assertEqual(self.producto.existencias.get().cantidad, Decimal("1.250"))
            raise RuntimeError("Fallo de persistencia controlado")
        with patch.object(MovimientoInventario.objects, "create", side_effect=fallar):
            with self.assertRaisesMessage(RuntimeError, "Fallo de persistencia"):
                self.aplicar()
        self.assertEqual((self.producto.existencias.get().cantidad, self.producto.existencias.get().version), (Decimal("0.000"), 0))
        self.assertFalse(self.producto.movimientos.exists())
        self.aplicar()
        self.assertEqual(self.producto.movimientos.count(), 1)

    def test_delta_invalido_unidad_saldo_y_version_rechazados_sin_escrituras(self):
        for datos in [{"delta": Decimal("0")}, {"delta": Decimal("-1"), "tipo": "entrada"},
                      {"delta": Decimal("1"), "tipo": "salida"}, {"delta": Decimal("1"), "tipo": "otro"},
                      {"delta": 1.25}, {"delta": Decimal("NaN")}, {"delta": Decimal("1.0001")},
                      {"delta": Decimal("100000000000.000")}, {"tipo": "salida", "delta": Decimal("-1")},
                      {"existencia": self.segundo.existencias.get(), "delta": Decimal("0.125")},
                      {"existencia": self.ajeno.existencias.get(), "delta": Decimal("1")}]:
            with self.subTest(datos=datos), self.assertRaises(ValidationError):
                self.aplicar(**datos)
        self.assertFalse(MovimientoInventario.objects.exists())
        Existencia.objects.filter(producto=self.producto).update(version=MAX_ENTERO_API)
        with self.assertRaises(ValidationError):
            self.aplicar()
        self.assertEqual(self.producto.existencias.get().cantidad, Decimal("0.000"))

    def test_ids_estrictos_y_producto_faltante_no_se_resuelve_en_otro_negocio(self):
        for ids in [[True], ["1"], [1.0], [0], [-1], [MAX_ENTERO_API + 1]]:
            with self.subTest(ids=ids), self.assertRaises(ValidationError):
                bloquear_existencias(self.tienda.negocio.pk, ids)
        self.assertEqual(bloquear_existencias(self.tienda.negocio.pk, [self.ajeno.pk, 999999]), {})

    def test_primitiva_admite_reposicion_inactiva_pero_wrapper_manual_conserva_su_autorizacion(self):
        self.producto.activo = False
        self.producto.save(update_fields=["activo"])
        self.aplicar()
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)
        with self.assertRaises(ValidationError):
            registrar_movimiento(contexto, producto_id=self.producto.pk, tipo="entrada", cantidad="1",
                                  motivo="Manual", clave_operacion=uuid4())
        rol = crear_rol(self.tienda.negocio, "Solo ventas", ["registrar_venta"])
        self.tienda.membresia.rol = rol
        self.tienda.membresia.save(update_fields=["rol"])
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk, "registrar_venta")
        with self.assertRaises(PermissionDenied):
            registrar_movimiento(contexto, producto_id=self.producto.pk, tipo="salida", cantidad="1",
                                  motivo="Manual", clave_operacion=uuid4())
        self.assertEqual(self.producto.existencias.get().cantidad, Decimal("1.250"))


class TransaccionObligatoriaTests(TransactionTestCase):
    def test_no_se_bloquea_ni_aplica_fuera_de_atomic(self):
        contexto = crear_contexto_negocio()
        producto = crear_producto_prueba(contexto.negocio)
        with self.assertRaises(TransactionManagementError):
            bloquear_existencias(contexto.negocio.pk, [producto.pk])
        autorizado = resolver_contexto_negocio(contexto.administrador, contexto.negocio.pk)
        with self.assertRaises(TransactionManagementError):
            aplicar_delta_bloqueado(autorizado, producto.existencias.get(), tipo="entrada", delta=Decimal("1"),
                                   motivo="Sin transacción", clave_operacion=uuid4(), huella_solicitud="e" * 64)
        self.assertEqual(producto.existencias.get().cantidad, Decimal("0.000"))

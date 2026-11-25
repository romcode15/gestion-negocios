from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from api.common.access import resolver_contexto_negocio
from catalogo.models import Producto
from inventario.models import MovimientoInventario
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import crear_producto_venta_prueba, crear_venta_confirmada_prueba
from ventas.models import AnulacionVenta, DetalleVenta, Venta, VinculoMovimientoVenta
from ventas.services.anulacion import anular_venta
from ventas.services.common import ConflictoVenta


class AnularVentaTests(TestCase):
    def setUp(self):
        self.escenario, self.otro = crear_dos_negocios()
        self.negocio = self.escenario.negocio
        self.actor = self.escenario.administrador
        self.contexto = resolver_contexto_negocio(self.actor, self.negocio.pk)
        self.producto = crear_producto_venta_prueba(
            self.negocio, saldo=Decimal("10.000"), usuario=self.actor, sku="ANULA-U",
        )
        self.kg = crear_producto_venta_prueba(
            self.negocio, saldo=Decimal("5.000"), usuario=self.actor, unidad="kg", sku="ANULA-KG",
        )
        self.litro = crear_producto_venta_prueba(
            self.negocio, saldo=Decimal("4.000"), usuario=self.actor, unidad="litro", sku="ANULA-L",
        )
        self.venta = crear_venta_confirmada_prueba(
            self.negocio, self.actor,
            detalles=[
                (self.producto, Decimal("2.000")),
                (self.kg, Decimal("1.500")),
                (self.litro, Decimal("0.750")),
            ],
        )

    def saldo(self, producto):
        return producto.existencias.get().cantidad, producto.existencias.get().version

    def test_anula_todas_las_lineas_y_repite_sin_nuevos_movimientos(self):
        antes_movimientos = MovimientoInventario.objects.count()
        antes_versiones = {p.pk: self.saldo(p) for p in (self.producto, self.kg, self.litro)}
        clave = uuid4()

        resultado = anular_venta(self.contexto, self.venta.pk, clave_operacion=clave, motivo="  Error de cobro  ")

        self.assertEqual(resultado.pk, self.venta.pk)
        self.assertEqual(Venta.objects.get(pk=self.venta.pk).estado, Venta.Estado.ANULADA)
        self.assertEqual(AnulacionVenta.objects.filter(venta=self.venta).count(), 1)
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=self.venta, operacion="anulacion").count(), 3)
        self.assertEqual(MovimientoInventario.objects.count(), antes_movimientos + 3)
        self.assertEqual(self.saldo(self.producto), (Decimal("10.000"), antes_versiones[self.producto.pk][1] + 1))
        self.assertEqual(self.saldo(self.kg), (Decimal("5.000"), antes_versiones[self.kg.pk][1] + 1))
        self.assertEqual(self.saldo(self.litro), (Decimal("4.000"), antes_versiones[self.litro.pk][1] + 1))
        self.assertEqual(AnulacionVenta.objects.get(venta=self.venta).motivo, "Error de cobro")

        repetida = anular_venta(self.contexto, self.venta.pk, clave_operacion=str(clave).upper(), motivo="Error de cobro")
        self.assertEqual(repetida.pk, resultado.pk)
        self.assertEqual(MovimientoInventario.objects.count(), antes_movimientos + 3)

    def test_restituye_producto_inactivo_y_rechaza_segunda_anulacion_distinta(self):
        self.producto.activo = False
        self.producto.save(update_fields=["activo"])
        Producto.objects.filter(categoria_id=self.producto.categoria_id).update(activo=False)
        self.producto.categoria.activo = False
        self.producto.categoria.save(update_fields=["activo"])
        clave = uuid4()
        anular_venta(self.contexto, self.venta.pk, clave_operacion=clave, motivo="Producto retirado")
        with self.assertRaises(ConflictoVenta) as error:
            anular_venta(self.contexto, self.venta.pk, clave_operacion=uuid4(), motivo="Otra solicitud")
        self.assertEqual(error.exception.status_code, 409)

    def test_sin_permiso_no_escribe_y_venta_ajena_es_invisible(self):
        rol = crear_rol(self.negocio, "Sin anulacion", ["registrar_venta"])
        membresia = self.escenario.membresia
        membresia.rol = rol
        membresia.save(update_fields=["rol"])
        antes = (Venta.objects.count(), MovimientoInventario.objects.count())
        with self.assertRaises(PermissionDenied):
            anular_venta(self.contexto, self.venta.pk, clave_operacion=uuid4(), motivo="Sin permiso")
        self.assertEqual((Venta.objects.count(), MovimientoInventario.objects.count()), antes)

        contexto_otro = resolver_contexto_negocio(self.otro.administrador, self.otro.negocio.pk)
        with self.assertRaises(NotFound):
            anular_venta(contexto_otro, self.venta.pk, clave_operacion=uuid4(), motivo="Venta ajena")

    def test_fallo_en_segundo_vinculo_revierte_auditoria_y_reposiciones(self):
        antes = (
            Venta.objects.get(pk=self.venta.pk).estado,
            AnulacionVenta.objects.count(),
            MovimientoInventario.objects.count(),
            VinculoMovimientoVenta.objects.count(),
            self.saldo(self.producto),
            self.saldo(self.kg),
        )
        original = VinculoMovimientoVenta.objects.create
        llamadas = 0

        def guardar(**datos):
            nonlocal llamadas
            llamadas += 1
            if llamadas == 2:
                raise RuntimeError("Fallo controlado en el segundo vinculo")
            return original(**datos)

        with patch.object(VinculoMovimientoVenta.objects, "create", side_effect=guardar):
            with self.assertRaises(RuntimeError):
                anular_venta(self.contexto, self.venta.pk, clave_operacion=uuid4(), motivo="Debe revertir")
        despues = (
            Venta.objects.get(pk=self.venta.pk).estado,
            AnulacionVenta.objects.count(),
            MovimientoInventario.objects.count(),
            VinculoMovimientoVenta.objects.count(),
            self.saldo(self.producto),
            self.saldo(self.kg),
        )
        self.assertEqual(despues, antes)

    def test_motivo_y_clave_invalidos_no_escriben(self):
        antes = (AnulacionVenta.objects.count(), MovimientoInventario.objects.count())
        for clave, motivo in [("no-uuid", "Motivo"), (uuid4(), ""), (uuid4(), "x" * 256)]:
            with self.subTest(clave=clave, motivo=motivo), self.assertRaises(ValidationError):
                anular_venta(self.contexto, self.venta.pk, clave_operacion=clave, motivo=motivo)
        self.assertEqual((AnulacionVenta.objects.count(), MovimientoInventario.objects.count()), antes)

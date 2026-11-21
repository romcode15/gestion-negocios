from decimal import Decimal
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.http import Http404
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from api.common.access import obtener_recurso_negocio, resolver_contexto_negocio
from catalogo.models import Producto
from inventario.models import Existencia, MovimientoInventario
from tests.support.fase2 import crear_dos_catalogos_prueba, crear_movimiento_prueba, crear_producto_prueba


class RutasBaseTests(SimpleTestCase):
    def test_composiciones_sin_endpoints_ficticios(self):
        for ruta in ("existencias/", "movimientos/", "ajustes/"):
            with self.subTest(ruta=ruta):
                respuesta = self.client.get(f"/api/v1/negocios/1/{ruta}")
                self.assertEqual(respuesta.status_code, 404)
                self.assertEqual(respuesta.json()["code"], "not_found")


class InventarioTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.otro = crear_dos_catalogos_prueba()

    def datos_movimiento(self, **cambios):
        datos = {
            "negocio": self.tienda.contexto.negocio, "producto": self.tienda.producto_fraccionario,
            "usuario": self.tienda.contexto.administrador, "tipo": "entrada",
            "cantidad": Decimal("1.500"), "saldo_anterior": Decimal("0.000"),
            "saldo_posterior": Decimal("1.500"), "motivo": "Motivo de prueba",
            "clave_operacion": uuid4(), "huella_solicitud": "e" * 64,
        }
        return dict(datos, **cambios)

    def test_fabricas_entregan_dos_tenants_con_saldos_versiones_y_permisos_distintos(self):
        primero, segundo = self.tienda, self.otro
        self.assertEqual(primero.categoria.nombre, segundo.categoria.nombre)
        self.assertEqual(primero.producto.sku, segundo.producto.sku)
        self.assertEqual(primero.producto.nombre, segundo.producto.nombre)
        self.assertEqual(primero.membresia_compartida.usuario_id, segundo.membresia_compartida.usuario_id)
        for catalogo, unidad in ((primero, "kg"), (segundo, "litro")):
            with self.subTest(unidad=unidad):
                self.assertFalse(catalogo.categoria_inactiva.activo)
                self.assertFalse(catalogo.producto_inactivo.activo)
                self.assertEqual(catalogo.producto_inactivo.existencias.get().cantidad, Decimal("1.000"))
                self.assertEqual(catalogo.producto_inactivo.movimientos.count(), 1)
                self.assertEqual(catalogo.producto.unidad, "unidad")
                cero = catalogo.producto.existencias.get()
                self.assertEqual((cero.cantidad, cero.version), (Decimal("0.000"), 0))
                fraccionario = catalogo.producto_fraccionario
                self.assertEqual(fraccionario.unidad, unidad)
                saldo = fraccionario.existencias.get()
                self.assertEqual((saldo.cantidad, saldo.version), (Decimal("2.125"), 2))
                salida, entrada = fraccionario.movimientos.all()
                self.assertEqual((salida.tipo, entrada.tipo), ("salida", "entrada"))
                self.assertEqual(salida.saldo_anterior, entrada.saldo_posterior)
                self.assertEqual(salida.saldo_posterior, saldo.cantidad)
                self.assertTrue(timezone.is_aware(salida.creado_en))

        usuario = primero.membresia_compartida.usuario
        negocio = primero.contexto.negocio
        otro_negocio = segundo.contexto.negocio
        contexto = resolver_contexto_negocio(usuario, negocio.pk, "listar_productos")
        self.assertEqual(
            obtener_recurso_negocio(contexto, Producto.objects.all(), pk=primero.producto.pk), primero.producto,
        )
        with self.assertRaises(Http404):
            obtener_recurso_negocio(contexto, Producto.objects.all(), pk=segundo.producto.pk)
        with self.assertRaises(PermissionDenied):
            resolver_contexto_negocio(usuario, otro_negocio.pk, "listar_productos")
        self.assertEqual(
            resolver_contexto_negocio(usuario, otro_negocio.pk, "registrar_entrada").permisos, {"registrar_entrada"},
        )

    def test_existencia_unica_rango_y_precision(self):
        existencia = self.tienda.producto.existencias.get()
        for cambios in (
            {"cantidad": Decimal("-1.000")}, {"version": -1}, {"cantidad": Decimal("0.1234")},
            {"cantidad": Decimal("100000000000.000")}, {"cantidad": Decimal("0.125")},
        ):
            with self.subTest(cambios=cambios), self.assertRaises(ValidationError):
                fila = Existencia.objects.get(pk=existencia.pk)
                for campo, valor in cambios.items():
                    setattr(fila, campo, valor)
                fila.save()
        for cambios in ({"cantidad": Decimal("-0.001")}, {"version": -1}):
            with self.subTest(cambios=cambios), self.assertRaises(IntegrityError), transaction.atomic():
                Existencia.objects.filter(pk=existencia.pk).update(**cambios)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Existencia.objects.bulk_create([Existencia(negocio=existencia.negocio, producto=existencia.producto)])

    def test_existencia_y_movimiento_rechazan_productos_ajenos(self):
        producto = self.otro.producto_fraccionario
        with self.assertRaisesMessage(ValidationError, "El producto debe pertenecer al mismo negocio"):
            Existencia.objects.create(negocio=self.tienda.contexto.negocio, producto=producto)
        with self.assertRaisesMessage(ValidationError, "El producto debe pertenecer al mismo negocio"):
            MovimientoInventario.objects.create(**self.datos_movimiento(producto=producto))
        existencia = self.tienda.producto.existencias.get()
        existencia.negocio = producto.negocio
        existencia.producto = producto
        with self.assertRaisesMessage(ValidationError, "El negocio de un registro existente no se puede cambiar"):
            existencia.save()

    def test_postgres_rechaza_delta_signos_tipo_y_saldos_inconsistentes(self):
        for cambios in (
            {"tipo": "otro"}, {"cantidad": Decimal("0.000"), "saldo_posterior": Decimal("0.000")},
            {"cantidad": Decimal("-0.500"), "saldo_anterior": Decimal("2.000")}, {"tipo": "salida"},
            {"saldo_anterior": Decimal("-1.000"), "saldo_posterior": Decimal("0.500")},
            {"tipo": "salida", "cantidad": Decimal("-1.500"), "saldo_posterior": Decimal("-1.500")},
            {"saldo_posterior": Decimal("2.000")}, {"huella_solicitud": "sin-huella"},
        ):
            with self.subTest(cambios=cambios), self.assertRaises(IntegrityError), transaction.atomic():
                MovimientoInventario.objects.bulk_create([MovimientoInventario(**self.datos_movimiento(**cambios))])

    def test_movimiento_requiere_unidades_enteras_y_motivo(self):
        with self.assertRaisesMessage(ValidationError, "La cantidad debe ser entera"):
            MovimientoInventario.objects.create(**self.datos_movimiento(producto=self.tienda.producto))
        with self.assertRaises(ValidationError):
            MovimientoInventario.objects.create(**self.datos_movimiento(motivo="   "))

    def test_clave_unica_por_negocio_y_rollback_de_saldo_al_fallar(self):
        producto = self.tienda.producto_fraccionario
        anterior = producto.existencias.get()
        existente = producto.movimientos.first()
        with self.assertRaises(ValidationError):
            crear_movimiento_prueba(
                producto, existente.usuario, tipo="entrada", cantidad=Decimal("1.000"),
                clave_operacion=existente.clave_operacion,
            )
        saldo = producto.existencias.get()
        self.assertEqual((saldo.cantidad, saldo.version), (anterior.cantidad, anterior.version))
        self.assertEqual(producto.movimientos.count(), 2)
        otro_producto = crear_producto_prueba(producto.negocio, unidad="kg")
        with self.assertRaises(IntegrityError), transaction.atomic():
            MovimientoInventario.objects.bulk_create([MovimientoInventario(**self.datos_movimiento(
                producto=otro_producto, clave_operacion=existente.clave_operacion,
            ))])
        otro = crear_movimiento_prueba(
            self.otro.producto_fraccionario, self.otro.contexto.administrador, tipo="ajuste",
            cantidad=Decimal("-0.125"), clave_operacion=existente.clave_operacion, motivo=" Conteo ",
        )
        self.assertEqual(otro.motivo, "Conteo")
        self.assertEqual(otro.saldo_posterior, Decimal("2.000"))
        self.assertEqual(otro.clave_operacion, existente.clave_operacion)

    def test_historial_protegido_e_inmutable_y_unidad_congelada(self):
        producto = self.tienda.producto_fraccionario
        movimiento = producto.movimientos.first()
        movimiento.motivo = "Reemplazo"
        with self.assertRaises(ValidationError):
            movimiento.save()
        with self.assertRaises(ValidationError):
            movimiento.delete()
        with self.assertRaises(ProtectedError):
            movimiento.usuario.delete()
        with self.assertRaises(ProtectedError):
            producto.delete()
        producto.unidad = "litro"
        with self.assertRaisesMessage(ValidationError, "La unidad no se puede cambiar después del primer movimiento"):
            producto.save()
        self.assertEqual(producto.movimientos.count(), 2)

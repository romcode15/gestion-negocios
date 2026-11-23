from decimal import Decimal, localcontext
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase
from django.urls import Resolver404, resolve
from rest_framework.exceptions import PermissionDenied, ValidationError as ApiValidationError

from api.common.access import resolver_contexto_negocio
from api.ventas.serializers import (DetalleVentaSerializer, MovimientoVentaSerializer,
                                   VentaDetalleSerializer, VentaProductoOpcionSerializer, VentaResumenSerializer)
from inventario.models import Existencia, MovimientoInventario
from tests.support.fase3 import (anular_venta_prueba, crear_dos_escenarios_ventas,
                                crear_producto_venta_prueba, crear_venta_confirmada_prueba)
from ventas.decimales import calcular_subtotal
from ventas.models import AnulacionVenta, DetalleVenta, Venta, VinculoMovimientoVenta
from ventas.services.common import huella_anulacion, huella_venta


class BaseVentasTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.otro = crear_dos_escenarios_ventas()

    def test_fixtures_concilian_saldos_versiones_y_vinculos_y_aislan_cuenta_compartida(self):
        self.assertEqual(self.tienda.producto.sku, self.otro.producto.sku)
        self.assertEqual(self.tienda.membresia_compartida.usuario_id, self.otro.membresia_compartida.usuario_id)
        self.assertNotEqual(self.tienda.producto_fraccionario.unidad, self.otro.producto_fraccionario.unidad)
        for escenario in (self.tienda, self.otro):
            negocio = escenario.contexto.negocio
            for saldo in Existencia.objects.filter(negocio=negocio):
                anterior = Decimal(0)
                movimientos = list(MovimientoInventario.objects.filter(producto_id=saldo.producto_id).order_by("creado_en", "id"))
                for movimiento in movimientos:
                    self.assertEqual(movimiento.saldo_anterior, anterior)
                    anterior += movimiento.cantidad
                    self.assertEqual(movimiento.saldo_posterior, anterior)
                self.assertEqual((saldo.cantidad, saldo.version), (anterior, len(movimientos)))
            self.assertEqual(escenario.venta.total, Decimal("5.01"))
            self.assertEqual(escenario.venta_anulada.estado, "anulada")
            self.assertEqual(escenario.venta.detalles.count(), 2)
            self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=escenario.venta).count(), 2)
            self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=escenario.venta_anulada).count(), 2)
        cuenta = self.tienda.membresia_compartida.usuario
        self.assertEqual(resolver_contexto_negocio(cuenta, self.tienda.contexto.negocio.pk, "registrar_venta").permisos, {"registrar_venta"})
        self.assertEqual(resolver_contexto_negocio(cuenta, self.otro.contexto.negocio.pk, "anular_venta").permisos, {"anular_venta", "listar_ventas"})
        with self.assertRaises(PermissionDenied):
            resolver_contexto_negocio(cuenta, self.tienda.contexto.negocio.pk, "registrar_salida")
        with self.assertRaises(PermissionDenied):
            resolver_contexto_negocio(cuenta, self.otro.contexto.negocio.pk, "registrar_venta")

    def test_redondeo_por_linea_exacto_y_limites_sin_float(self):
        with localcontext() as ctx:
            ctx.prec = 3
            self.assertEqual(calcular_subtotal(Decimal("0.005"), Decimal("1.00")), Decimal("0.01"))
            self.assertEqual(calcular_subtotal(Decimal("1.234"), Decimal("2.55")), Decimal("3.15"))
            self.assertEqual(calcular_subtotal(Decimal("1000.000"), Decimal("1234.56")), Decimal("1234560.00"))
        self.assertEqual(calcular_subtotal(Decimal("1"), Decimal("0.00")), Decimal("0.00"))
        for cantidad, precio in [(1.5, Decimal("1")), (Decimal("NaN"), Decimal("1")),
                                  (Decimal("1"), Decimal("-0.01")), (Decimal("1.0001"), Decimal("1")),
                                  (Decimal("99999999999.999"), Decimal("9999999999.99"))]:
            with self.subTest(cantidad=cantidad), self.assertRaises(ValidationError):
                calcular_subtotal(cantidad, precio)

    def test_clave_registro_es_unica_por_negocio_pero_se_puede_repetir_en_otro(self):
        original = self.tienda.venta
        datos = dict(negocio=original.negocio, vendedor=original.vendedor, total=original.total,
                     clave_operacion=original.clave_operacion, huella_solicitud="a" * 64)
        with self.assertRaises(ValidationError):
            Venta.objects.create(**datos)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Venta.objects.bulk_create([Venta(**datos)])
        datos.update(negocio=self.otro.contexto.negocio, vendedor=self.otro.contexto.administrador)
        Venta.objects.create(**datos)

    def test_venta_rechaza_actor_ajeno_y_conserva_encabezado_y_estado(self):
        original = self.tienda.venta
        for cambios in [{"total": Decimal("-0.01")}, {"total": Decimal("1.001")},
                        {"huella_solicitud": "no-hash"}, {"estado": "anulada"},
                        {"vendedor": self.otro.contexto.administrador}]:
            with self.subTest(cambios=cambios), self.assertRaises(ValidationError):
                Venta.objects.create(negocio=original.negocio, clave_operacion=uuid4(),
                                     **dict({"vendedor": original.vendedor, "total": Decimal("1.00"), "huella_solicitud": "b" * 64}, **cambios))
        for campo, valor in [("total", Decimal("1.00")), ("observaciones", "Cambio"), ("clave_operacion", uuid4()),
                             ("estado", "anulada")]:
            venta = Venta.objects.get(pk=original.pk)
            setattr(venta, campo, valor)
            with self.subTest(campo=campo), self.assertRaises(ValidationError):
                venta.save()
        with self.assertRaises(ValidationError):
            original.delete()
        copia = Venta(pk=original.pk, negocio=original.negocio, vendedor=original.vendedor,
                      total=Decimal("999.00"), clave_operacion=uuid4(), huella_solicitud="b" * 64)
        with self.assertRaises(ValidationError):
            copia.save()

    def test_detalle_rechaza_tenant_unidad_precio_subtotal_y_duplicado(self):
        detalle = self.tienda.venta.detalles.first()
        # Una venta vacía transitoria es válida dentro de la preparación de la transacción.
        venta = Venta.objects.create(negocio=detalle.negocio, vendedor=self.tienda.contexto.administrador,
                                     total=Decimal("1.00"), clave_operacion=uuid4(), huella_solicitud="c" * 64)
        datos = dict(negocio=detalle.negocio, venta=venta, producto=detalle.producto,
                     sku=detalle.sku, nombre=detalle.nombre, unidad=detalle.unidad,
                     cantidad=Decimal("1.000"), precio_unitario=Decimal("2.50"), subtotal=Decimal("2.50"))
        for cambios in [{"negocio": self.otro.contexto.negocio}, {"producto": self.otro.producto},
                        {"unidad": "kg"}, {"cantidad": Decimal("0.125")}, {"subtotal": Decimal("2.49")},
                        {"precio_unitario": Decimal("-1.00")}, {"cantidad": Decimal("1.0001")}]:
            with self.subTest(cambios=cambios), self.assertRaises(ValidationError):
                DetalleVenta.objects.create(**dict(datos, **cambios))
        nueva = DetalleVenta.objects.create(**datos)
        with self.assertRaises(ValidationError):
            DetalleVenta.objects.create(**datos)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DetalleVenta.objects.bulk_create([DetalleVenta(**datos)])
        with self.assertRaises(IntegrityError), transaction.atomic():
            DetalleVenta.objects.filter(pk=nueva.pk).update(subtotal=Decimal("2.49"))
        with self.assertRaises(IntegrityError), transaction.atomic():
            DetalleVenta.objects.filter(pk=nueva.pk).update(cantidad=Decimal("0.125"))

    def test_historico_no_se_edita_ni_borra_y_snapshots_no_siguen_el_catalogo(self):
        venta = self.tienda.venta
        antes = VentaDetalleSerializer(venta).data
        producto = self.tienda.producto
        producto.sku = "CAMBIADO"
        producto.nombre = "Nombre nuevo"
        producto.precio_venta = Decimal("99.00")
        producto.save()
        despues = VentaDetalleSerializer(Venta.objects.get(pk=venta.pk)).data
        self.assertEqual(antes, despues)
        for registro in [venta.detalles.first(), self.tienda.venta_anulada.anulacion,
                         VinculoMovimientoVenta.objects.filter(detalle__venta=venta).first()]:
            with self.subTest(model=type(registro).__name__):
                with self.assertRaises(ValidationError):
                    registro.save()
                with self.assertRaises(ValidationError):
                    registro.delete()
        for registro in [producto, venta, venta.vendedor, venta.negocio]:
            with self.assertRaises(ProtectedError), transaction.atomic():
                type(registro).objects.filter(pk=registro.pk).delete()

    def test_anulacion_unica_auditada_y_restituye_producto_inactivo_en_fixture(self):
        venta = self.tienda.venta
        for producto in (self.tienda.producto, self.tienda.producto_fraccionario):
            producto.activo = False
            producto.save(update_fields=["activo"])
        anulada = anular_venta_prueba(venta, venta.vendedor, motivo="  Corrección  ", clave_operacion=venta.clave_operacion)
        self.assertEqual(anulada.anulacion.motivo, "Corrección")
        self.assertEqual(anulada.total, venta.total)
        self.assertEqual(anulada.clave_operacion, anulada.anulacion.clave_operacion)  # espacios de claves distintos
        self.assertEqual(self.tienda.producto.existencias.get().cantidad, Decimal("10.000"))
        with self.assertRaises(ValidationError):
            anular_venta_prueba(anulada, venta.vendedor)
        anulada.estado = "confirmada"
        with self.assertRaises(ValidationError):
            anulada.save()

    def test_anulacion_rechaza_relaciones_ajenas_y_clave_repetida(self):
        venta = self.tienda.venta
        for cambios in [{"usuario": self.otro.contexto.administrador}, {"negocio": self.otro.contexto.negocio},
                        {"motivo": "   "}, {"huella_solicitud": "INVALIDA"}]:
            datos = dict(venta=venta, negocio=venta.negocio, usuario=venta.vendedor, motivo="Motivo",
                         huella_solicitud="d" * 64, clave_operacion=uuid4())
            with self.subTest(cambios=cambios), self.assertRaises(ValidationError):
                AnulacionVenta.objects.create(**dict(datos, **cambios))
        clave = self.tienda.venta_anulada.anulacion.clave_operacion
        with self.assertRaises(ValidationError):
            AnulacionVenta.objects.create(venta=venta, negocio=venta.negocio, usuario=venta.vendedor,
                                          motivo="Motivo", huella_solicitud="d" * 64, clave_operacion=clave)

    def test_vinculos_rechazan_operacion_producto_actor_y_tenant_incoherentes(self):
        detalle = self.tienda.venta.detalles.first()
        vinculo = detalle.vinculos_movimientos.first()
        for cambios in [{"operacion": "anulacion"}, {"detalle": self.otro.venta.detalles.first()},
                        {"negocio": self.otro.contexto.negocio}, {"movimiento": self.otro.producto.movimientos.first()}]:
            with self.subTest(cambios=cambios), self.assertRaises(ValidationError):
                VinculoMovimientoVenta.objects.create(**(dict(
                    negocio=detalle.negocio, detalle=detalle, movimiento=vinculo.movimiento,
                    operacion="venta",
                ) | cambios))
        with self.assertRaises(IntegrityError), transaction.atomic():
            VinculoMovimientoVenta.objects.bulk_create([VinculoMovimientoVenta(
                negocio=detalle.negocio, detalle=detalle, movimiento=vinculo.movimiento, operacion="venta")])

    def test_fallo_fixture_revierte_toda_venta_y_stock(self):
        tienda = self.tienda.contexto
        primero = crear_producto_venta_prueba(tienda.negocio, usuario=tienda.administrador, saldo=Decimal("2.000"))
        segundo = crear_producto_venta_prueba(tienda.negocio)
        antes = (Venta.objects.count(), DetalleVenta.objects.count(), MovimientoInventario.objects.count(), VinculoMovimientoVenta.objects.count())
        with self.assertRaises(ApiValidationError):
            crear_venta_confirmada_prueba(tienda.negocio, tienda.administrador,
                                          detalles=[(primero, Decimal("1.000")), (segundo, Decimal("1.000"))])
        self.assertEqual(antes, (Venta.objects.count(), DetalleVenta.objects.count(), MovimientoInventario.objects.count(), VinculoMovimientoVenta.objects.count()))
        self.assertEqual(primero.existencias.get().cantidad, Decimal("2.000"))

    def test_huellas_canonicas_ignoran_orden_y_escala_pero_no_actor_entrada_o_venta(self):
        lineas = [{"producto_id": 2, "cantidad": Decimal("1.5"), "precio_unitario_esperado": Decimal("2.5")},
                  {"producto_id": 1, "cantidad": Decimal("1"), "precio_unitario_esperado": Decimal("1")}]
        original = huella_venta(1, lineas, " Nota ")
        self.assertEqual(original, huella_venta(1, list(reversed(lineas)), "Nota"))
        self.assertNotEqual(original, huella_venta(2, lineas, "Nota"))
        self.assertNotEqual(original, huella_venta(1, lineas, "Otra"))
        self.assertNotEqual(huella_anulacion(1, 1, "Motivo"), huella_anulacion(1, 2, "Motivo"))
        self.assertEqual(huella_anulacion(1, 1, " Motivo "), huella_anulacion(1, 1, "Motivo"))

    def test_serializers_tienen_campos_exactos_decimales_y_sin_huellas(self):
        venta = Venta.objects.get(pk=self.tienda.venta.pk)
        resumen = VentaResumenSerializer(venta).data
        self.assertEqual(set(resumen), {"id", "negocio_id", "estado", "total", "vendedor", "creado_en"})
        self.assertEqual(resumen["total"], "5.01")
        detalle = VentaDetalleSerializer(venta).data
        self.assertEqual(set(detalle), set(resumen) | {"clave_operacion", "observaciones", "detalles", "anulacion"})
        self.assertIsNone(detalle["anulacion"])
        self.assertEqual(set(detalle["detalles"][0]), {"id", "producto_id", "sku", "nombre", "unidad", "cantidad", "precio_unitario", "subtotal"})
        anulada = VentaDetalleSerializer(self.tienda.venta_anulada).data
        self.assertEqual(set(anulada["anulacion"]), {"id", "usuario", "motivo", "clave_operacion", "creado_en"})
        self.assertNotIn("huella_solicitud", str(detalle))
        self.assertNotIn("huella_solicitud", str(anulada))
        vinculo = venta.detalles.first().vinculos_movimientos.first()
        self.assertEqual(set(MovimientoVentaSerializer(vinculo).data), {"detalle_id", "operacion", "movimiento"})
        producto = self.tienda.producto
        opcion = VentaProductoOpcionSerializer(dict(id=producto.pk, negocio_id=producto.negocio_id, sku=producto.sku,
                   nombre=producto.nombre, unidad=producto.unidad, precio_venta=producto.precio_venta, disponible=Decimal("0.000"))).data
        self.assertEqual(set(opcion), {"id", "negocio_id", "sku", "nombre", "unidad", "precio_venta", "disponible"})
        self.assertEqual((opcion["precio_venta"], opcion["disponible"]), ("2.50", "0.000"))
        for clase in (VentaDetalleSerializer, DetalleVentaSerializer):
            self.assertTrue(all(campo.read_only for campo in clase().fields.values()))

    def test_base_no_publica_endpoints_de_ventas_antes_de_implementarlos(self):
        for relativa in ["ventas/", "ventas/1/", "ventas/productos/opciones/", "ventas/productos/1/", "ventas/1/anulacion/", "ventas/1/movimientos/"]:
            with self.subTest(ruta=relativa), self.assertRaises(Resolver404):
                resolve("/api/v1/negocios/1/" + relativa)

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, localcontext
from threading import Barrier, Event, Lock, get_ident
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase
from rest_framework.exceptions import NotAuthenticated, PermissionDenied, ValidationError

from accesos.models import Membresia, RolPermiso
from api.common.access import resolver_contexto_negocio
from api.common.errors import manejar_excepcion
from api.ventas.serializers import VentaDetalleSerializer
from catalogo.models import Categoria, Producto
from inventario.models import Existencia, MovimientoInventario
from inventario.operaciones import MAX_ENTERO_API
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import anular_venta_prueba, crear_producto_venta_prueba
from ventas.models import DetalleVenta, Venta, VinculoMovimientoVenta
from ventas.services import confirmacion
from ventas.services.common import ConflictoVenta


class EscenarioConfirmacion:
    def preparar(self):
        self.tienda, self.otro = crear_dos_negocios()
        self.producto = crear_producto_venta_prueba(
            self.tienda.negocio, usuario=self.tienda.administrador, saldo=Decimal("10.000"),
            sku="VENTA-COMUN", nombre="Arroz", precio_venta=Decimal("2.50"),
        )
        self.fraccionario = crear_producto_venta_prueba(
            self.tienda.negocio, usuario=self.tienda.administrador, saldo=Decimal("5.000"),
            sku="VENTA-KG", unidad="kg", precio_venta=Decimal("1.00"),
        )
        self.ajeno = crear_producto_venta_prueba(
            self.otro.negocio, usuario=self.otro.administrador, saldo=Decimal("10.000"),
            sku="VENTA-COMUN", precio_venta=Decimal("2.50"),
        )
        self.contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)

    def linea(self, producto=None, **cambios):
        producto = producto or self.producto
        return dict({"producto_id": producto.pk, "cantidad": "1.000", "precio_unitario_esperado": str(producto.precio_venta)}, **cambios)

    def datos(self, **cambios):
        return dict({"detalles": [self.linea()], "clave_operacion": uuid4(), "observaciones": ""}, **cambios)

    def confirmar(self, contexto=None, **cambios):
        return confirmacion.confirmar_venta(contexto or self.contexto, **self.datos(**cambios))

    def instantanea(self):
        return tuple(list(modelo.objects.order_by("pk").values()) for modelo in
                     (Venta, DetalleVenta, Existencia, MovimientoInventario, VinculoMovimientoVenta))

    def saldo(self, producto=None):
        fila = (producto or self.producto).existencias.get()
        return fila.cantidad, fila.version


class ConfirmarVentaTests(EscenarioConfirmacion, TestCase):
    @classmethod
    def setUpTestData(cls):
        EscenarioConfirmacion.preparar(cls)

    def test_venta_multilinea_con_permiso_minimo_y_snapshots_calculados_en_servidor(self):
        rol = crear_rol(self.tienda.negocio, "Solo registrar ventas", ["registrar_venta"])
        self.tienda.membresia.rol = rol
        self.tienda.membresia.save(update_fields=["rol"])
        venta = self.confirmar(detalles=[self.linea(self.fraccionario, cantidad="0.005"), self.linea(cantidad="2")], observaciones="  Nota  ")
        self.assertEqual((venta.total, venta.observaciones, venta.vendedor_id, venta.estado),
                         (Decimal("5.01"), "Nota", self.tienda.administrador.pk, "confirmada"))
        detalles = list(venta.detalles.all())
        self.assertEqual([d.producto_id for d in detalles], [self.producto.pk, self.fraccionario.pk])
        self.assertEqual([d.subtotal for d in detalles], [Decimal("5.00"), Decimal("0.01")])
        self.assertEqual(self.saldo(), (Decimal("8.000"), 2))
        self.assertEqual(self.saldo(self.fraccionario), (Decimal("4.995"), 2))
        vinculos = list(VinculoMovimientoVenta.objects.filter(detalle__venta=venta).select_related("movimiento"))
        self.assertEqual(len(vinculos), 2)
        self.assertEqual(len({v.movimiento.clave_operacion for v in vinculos}), 2)
        for v in vinculos:
            self.assertEqual((v.operacion, v.movimiento.tipo, v.movimiento.usuario_id), ("venta", "salida", venta.vendedor_id))
            self.assertNotEqual(v.movimiento.clave_operacion, venta.clave_operacion)
            self.assertIn(f"Venta {venta.pk}", v.movimiento.motivo)
        self.assertEqual(self.saldo(self.ajeno), (Decimal("10.000"), 1))
        antes = VentaDetalleSerializer(venta).data
        self.producto.precio_venta = Decimal("9.99")
        self.producto.nombre = "Nombre actual"
        self.producto.sku = "SKU-NUEVO"
        self.producto.save()
        self.assertEqual(VentaDetalleSerializer(Venta.objects.get(pk=venta.pk)).data, antes)

    def test_redondea_cada_linea_antes_de_sumar_y_permite_venta_gratuita(self):
        otro_kg = crear_producto_venta_prueba(self.tienda.negocio, usuario=self.tienda.administrador,
                    saldo=Decimal("2.000"), unidad="kg", precio_venta=Decimal("1.00"))
        with localcontext() as ctx:
            ctx.prec = 3
            venta = self.confirmar(detalles=[self.linea(self.fraccionario, cantidad="0.005"), self.linea(otro_kg, cantidad="0.005")])
        self.assertEqual(venta.total, Decimal("0.02"))
        self.producto.precio_venta = Decimal("0.00")
        self.producto.save()
        clave = uuid4()
        gratis = self.confirmar(clave_operacion=clave, detalles=[self.linea(self.producto, precio_unitario_esperado="-0.00")])
        self.assertEqual(gratis.total, Decimal("0.00"))
        antes = self.instantanea()
        repetida = self.confirmar(clave_operacion=clave, detalles=[self.linea(self.producto, precio_unitario_esperado="0")])
        self.assertEqual(repetida.pk, gratis.pk)
        self.assertEqual(self.instantanea(), antes)

    def test_reintento_normalizado_lineas_reordenadas_devuelve_misma_venta_sin_cambios(self):
        clave = uuid4()
        original = self.confirmar(clave_operacion=clave, observaciones=" Nota ",
                                 detalles=[self.linea(self.fraccionario, cantidad="1.5"), self.linea(cantidad="2")])
        antes = self.instantanea()
        repetida = self.confirmar(clave_operacion=str(clave).upper(), observaciones="Nota",
                                 detalles=[self.linea(cantidad=Decimal("2.000")),
                                           self.linea(self.fraccionario, cantidad="1.500", precio_unitario_esperado=Decimal("1.00"))])
        self.assertEqual((repetida.pk, repetida.creado_en), (original.pk, original.creado_en))
        self.assertEqual(self.instantanea(), antes)

    def test_reutilizacion_de_clave_con_otro_contenido_o_actor_es_conflicto_sin_cambios(self):
        clave = uuid4()
        self.confirmar(clave_operacion=clave)
        antes = self.instantanea()
        for cambios in [{"observaciones": "Otra nota"}, {"detalles": [self.linea(cantidad="2")]},
                        {"detalles": [self.linea(precio_unitario_esperado="2.00")]},
                        {"detalles": [self.linea(self.fraccionario)]}]:
            with self.subTest(cambios=cambios), self.assertRaises(ConflictoVenta) as error:
                self.confirmar(clave_operacion=clave, **cambios)
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(self.instantanea(), antes)
        usuario = get_user_model().objects.create_user(username="otro_vendedor")
        Membresia.objects.create(negocio=self.tienda.negocio, usuario=usuario, rol=self.tienda.rol)
        contexto = resolver_contexto_negocio(usuario, self.tienda.negocio.pk)
        with self.assertRaises(ConflictoVenta):
            self.confirmar(contexto, clave_operacion=clave)
        self.assertEqual(self.instantanea(), antes)

    def test_reintento_precede_stock_precio_actividad_y_version_actuales(self):
        clave = uuid4()
        original = self.confirmar(clave_operacion=clave, detalles=[self.linea(cantidad="10")])
        self.assertEqual(self.saldo(), (Decimal("0.000"), 2))
        self.producto.activo = False
        self.producto.precio_venta = Decimal("8.00")
        self.producto.save()
        self.fraccionario.activo = False
        self.fraccionario.save(update_fields=["activo"])
        categoria = self.producto.categoria
        categoria.activo = False
        categoria.save(update_fields=["activo"])
        Existencia.objects.filter(producto=self.producto).update(version=MAX_ENTERO_API)
        antes = self.instantanea()
        repetida = self.confirmar(clave_operacion=clave, detalles=[self.linea(cantidad="10", precio_unitario_esperado="2.50")])
        self.assertEqual(repetida.pk, original.pk)
        self.assertEqual(self.instantanea(), antes)

    def test_reintento_despues_de_anular_devuelve_estado_actual_sin_nueva_salida(self):
        clave = uuid4()
        original = self.confirmar(clave_operacion=clave)
        anular_venta_prueba(original, self.tienda.administrador)
        antes = self.instantanea()
        repetida = self.confirmar(clave_operacion=clave)
        self.assertEqual((repetida.pk, repetida.estado), (original.pk, "anulada"))
        self.assertIsNotNone(VentaDetalleSerializer(repetida).data["anulacion"])
        self.assertEqual(self.instantanea(), antes)

    def test_forma_de_detalles_campos_requeridos_y_desconocidos_no_escriben(self):
        antes = self.instantanea()
        for detalles in [None, {}, (), [], [None], ["producto"], [{}],
                         [dict(self.linea(), total="1.00")], [dict(self.linea(), negocio_id=self.tienda.negocio.pk)],
                         [self.linea() for _ in range(101)]]:
            with self.subTest(detalles=detalles), self.assertRaises(ValidationError):
                self.confirmar(detalles=detalles)
            self.assertEqual(self.instantanea(), antes)
        with self.assertRaises(ValidationError) as error:
            self.confirmar(detalles=[{}, dict(self.linea(), usuario_id=1)])
        self.assertEqual(set(error.exception.detail), {"detalles.0.producto_id", "detalles.0.cantidad", "detalles.0.precio_unitario_esperado", "detalles.1.usuario_id"})
        respuesta = manejar_excepcion(error.exception, {})
        self.assertEqual((respuesta.status_code, respuesta.data["code"]), (400, "validation_error"))
        self.assertEqual(set(respuesta.data["errors"]), set(error.exception.detail))
        conflicto = manejar_excepcion(ConflictoVenta("Precio cambiado"), {})
        self.assertEqual((conflicto.status_code, conflicto.data), (409, {"code": "conflict", "detail": "Precio cambiado", "errors": {}}))

    def test_limite_cien_productos_confirma_todas_las_lineas_y_saldos(self):
        productos = [crear_producto_venta_prueba(self.tienda.negocio, usuario=self.tienda.administrador,
                     saldo=Decimal("1.000"), precio_venta=Decimal("0.01")) for _ in range(100)]
        venta = self.confirmar(detalles=[self.linea(p) for p in productos])
        self.assertEqual((venta.total, venta.detalles.count()), (Decimal("1.00"), 100))
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=venta).count(), 100)
        saldos = list(Existencia.objects.filter(producto_id__in=[p.pk for p in productos]).values_list("cantidad", "version"))
        self.assertEqual(len(saldos), 100)
        self.assertEqual(set(saldos), {(Decimal("0.000"), 2)})

    def test_ids_json_estrictos_y_repetidos_con_indice_original(self):
        antes = self.instantanea()
        for producto_id in [True, False, 0, -1, 1.0, "1", None, MAX_ENTERO_API + 1, [], {}]:
            with self.subTest(producto_id=producto_id), self.assertRaises(ValidationError) as error:
                self.confirmar(detalles=[self.linea(producto_id=producto_id)])
            self.assertIn("detalles.0.producto_id", error.exception.detail)
        with self.assertRaises(ValidationError) as error:
            self.confirmar(detalles=[self.linea(self.fraccionario), self.linea(), self.linea()])
        self.assertEqual(set(error.exception.detail), {"detalles.2.producto_id"})
        self.assertEqual(self.instantanea(), antes)

    def test_decimales_estrictos_precision_rango_signo_y_unidad(self):
        antes = self.instantanea()
        invalidos = [None, True, 1, 1.25, "", "1,25", "1e2", " 1 ", "+1", "NaN", "Infinity", "1.0001", "-1", "0", Decimal("NaN"), "9" * 1000]
        for cantidad in invalidos:
            with self.subTest(cantidad=str(cantidad)[:30]), self.assertRaises(ValidationError) as error:
                self.confirmar(detalles=[self.linea(cantidad=cantidad)])
            self.assertIn("detalles.0.cantidad", error.exception.detail)
        for precio in [None, True, 1, 1.25, "1.001", "-0.01", "1e1", "NaN", Decimal("Infinity"), "10000000000.00"]:
            with self.subTest(precio=precio), self.assertRaises(ValidationError) as error:
                self.confirmar(detalles=[self.linea(precio_unitario_esperado=precio)])
            self.assertIn("detalles.0.precio_unitario_esperado", error.exception.detail)
        with self.assertRaises(ValidationError) as error:
            self.confirmar(detalles=[self.linea(self.fraccionario), self.linea(cantidad="0.125")])
        self.assertEqual(set(error.exception.detail), {"detalles.1.cantidad"})
        self.assertEqual(self.instantanea(), antes)

    def test_clave_y_observaciones_invalidas_son_error_sin_cambios(self):
        antes = self.instantanea()
        for clave in [None, True, 1, {}, "uuid", uuid4().hex, " " + str(uuid4())]:
            with self.subTest(clave=clave), self.assertRaises(ValidationError) as error:
                self.confirmar(clave_operacion=clave)
            self.assertEqual(set(error.exception.detail), {"clave_operacion"})
        for observaciones in [None, 1, [], "x" * 501, "No\x00", "\ud800"]:
            with self.subTest(observaciones=repr(observaciones)[:30]), self.assertRaises(ValidationError) as error:
                self.confirmar(observaciones=observaciones)
            self.assertEqual(set(error.exception.detail), {"observaciones"})
        self.assertEqual(self.instantanea(), antes)

    def test_ajeno_inexistente_inactivo_o_sin_existencia_mismo_error_por_linea(self):
        inactivo = crear_producto_venta_prueba(self.tienda.negocio, activo=False)
        sin_saldo = crear_producto_venta_prueba(self.tienda.negocio)
        sin_saldo.existencias.all().delete()
        antes = self.instantanea()
        respuestas = []
        for producto_id in [self.ajeno.pk, 999999, inactivo.pk, sin_saldo.pk]:
            with self.assertRaises(ValidationError) as error:
                self.confirmar(detalles=[self.linea(self.fraccionario), self.linea(producto_id=producto_id)])
            respuestas.append(error.exception.detail)
        self.assertTrue(all(respuesta == respuestas[0] for respuesta in respuestas))
        self.assertEqual(set(respuestas[0]), {"detalles.1.producto_id"})
        self.assertEqual(self.instantanea(), antes)
        Categoria.objects.filter(pk=self.producto.categoria_id).update(activo=False)
        with self.assertRaises(ValidationError):
            self.confirmar()
        self.assertEqual(self.instantanea(), antes)

    def test_precio_antiguo_y_stock_insuficiente_rechazan_toda_la_venta(self):
        antes = self.instantanea()
        with self.assertRaises(ConflictoVenta):
            self.confirmar(detalles=[self.linea(precio_unitario_esperado="2.49")])
        with self.assertRaises(ValidationError) as error:
            self.confirmar(detalles=[self.linea(), self.linea(self.fraccionario, cantidad="6.000")])
        self.assertEqual(set(error.exception.detail), {"detalles.1.cantidad"})
        self.assertEqual(self.instantanea(), antes)

    def test_revalidacion_de_cuenta_membresia_negocio_y_rol_persistidos(self):
        antes = self.instantanea()
        for registro, campo in [(self.tienda.administrador, "is_active"), (self.tienda.membresia, "activo"), (self.tienda.negocio, "activo")]:
            setattr(registro, campo, False)
            registro.save(update_fields=[campo])
            with self.subTest(campo=campo), self.assertRaises((PermissionDenied, NotAuthenticated)):
                self.confirmar()
            setattr(registro, campo, True)
            registro.save(update_fields=[campo])
        solo_manual = crear_rol(self.tienda.negocio, "Solo salida", ["registrar_salida"])
        self.tienda.membresia.rol = solo_manual
        self.tienda.membresia.save(update_fields=["rol"])
        with self.assertRaises(PermissionDenied):
            self.confirmar()
        self.assertEqual(self.instantanea(), antes)

    def test_reintento_tambien_exige_permiso_actual(self):
        clave = uuid4()
        self.confirmar(clave_operacion=clave)
        antes = self.instantanea()
        self.tienda.membresia.activo = False
        self.tienda.membresia.save(update_fields=["activo"])
        with self.assertRaises(PermissionDenied):
            self.confirmar(clave_operacion=clave)
        self.assertEqual(self.instantanea(), antes)

    def test_desbordamiento_de_linea_total_y_version_no_deja_venta_parcial(self):
        alto = []
        for _ in range(2):
            alto.append(crear_producto_venta_prueba(self.tienda.negocio, usuario=self.tienda.administrador,
                        saldo=Decimal("1000.000"), precio_venta=Decimal("9999999999.99")))
        antes = self.instantanea()
        with self.assertRaises(ValidationError) as error:
            self.confirmar(detalles=[self.linea(alto[0], cantidad="1000")])
        self.assertIn("detalles.0.cantidad", error.exception.detail)
        with self.assertRaises(ValidationError) as error:
            self.confirmar(detalles=[self.linea(p, cantidad="100") for p in alto])
        self.assertEqual(set(error.exception.detail), {"detalles"})
        self.assertEqual(self.instantanea(), antes)
        Existencia.objects.filter(producto=self.producto).update(version=MAX_ENTERO_API)
        antes = self.instantanea()
        with self.assertRaises(ValidationError):
            self.confirmar()
        self.assertEqual(self.instantanea(), antes)

    def test_fallos_en_segunda_linea_movimiento_o_vinculo_revierten_todo_y_no_ocultan_error(self):
        antes = self.instantanea()
        for modelo in [DetalleVenta, MovimientoInventario, VinculoMovimientoVenta]:
            original = modelo.objects.create
            llamadas = 0
            fallo = RuntimeError(f"Fallo controlado de {modelo.__name__}")
            def guardar(**datos):
                nonlocal llamadas
                llamadas += 1
                if llamadas == 2:
                    self.assertEqual(self.saldo(), (Decimal("9.000"), 2))
                    raise fallo
                return original(**datos)
            with self.subTest(modelo=modelo.__name__), patch.object(modelo.objects, "create", side_effect=guardar):
                with self.assertRaises(RuntimeError) as error:
                    self.confirmar(detalles=[self.linea(), self.linea(self.fraccionario)])
                self.assertIs(error.exception, fallo)
            self.assertEqual(self.instantanea(), antes)

    def test_errores_inesperados_de_integridad_y_modelo_no_se_convierten_en_conflictos(self):
        antes = self.instantanea()
        for fallo in [IntegrityError("Otra restricción"), DjangoValidationError({"total": "Fallo inesperado"})]:
            with self.subTest(fallo=type(fallo)), patch.object(Venta.objects, "create", side_effect=fallo):
                with self.assertRaises(type(fallo)) as error:
                    self.confirmar()
                self.assertIs(error.exception, fallo)
            self.assertEqual(self.instantanea(), antes)

    def test_misma_clave_en_otro_negocio_crea_ventas_independientes(self):
        clave = uuid4()
        primera = self.confirmar(clave_operacion=clave)
        contexto = resolver_contexto_negocio(self.otro.administrador, self.otro.negocio.pk)
        segunda = self.confirmar(contexto, clave_operacion=clave, detalles=[self.linea(self.ajeno)])
        self.assertNotEqual(primera.pk, segunda.pk)
        self.assertNotEqual(primera.negocio_id, segunda.negocio_id)
        self.assertEqual(self.saldo(), self.saldo(self.ajeno))


class ConcurrenciaConfirmacionTests(EscenarioConfirmacion, TransactionTestCase):
    def setUp(self):
        self.preparar()

    def en_conexion(self, datos):
        try:
            contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)
            try:
                venta = confirmacion.confirmar_venta(contexto, **datos)
                return 201, venta.pk
            except (ConflictoVenta, ValidationError, PermissionDenied, NotAuthenticated) as error:
                return error.status_code, error
        finally:
            connections.close_all()

    def en_paralelo(self, operaciones):
        barrera, candado, pids = Barrier(2, timeout=12), Lock(), {}
        original = confirmacion.revalidar_contexto_ventas
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
        with patch.object(confirmacion, "revalidar_contexto_ventas", side_effect=sincronizar), ThreadPoolExecutor(max_workers=2) as pool:
            futuros = [pool.submit(self.en_conexion, datos) for datos in operaciones]
            resultados = [f.result(timeout=25) for f in futuros]
        self.assertEqual(len(set(pids.values())), 2)
        return resultados

    def test_carritos_en_orden_inverso_no_sobregiran_ni_generan_venta_parcial(self):
        lineas = [self.linea(cantidad="6"), self.linea(self.fraccionario, cantidad="4")]
        resultados = self.en_paralelo([self.datos(detalles=lineas), self.datos(detalles=list(reversed(lineas)))])
        self.assertCountEqual([s for s, _ in resultados], [201, 400])
        self.assertEqual((Venta.objects.count(), DetalleVenta.objects.count(), VinculoMovimientoVenta.objects.count()), (1, 2, 2))
        self.assertEqual(self.saldo(), (Decimal("4.000"), 2))
        self.assertEqual(self.saldo(self.fraccionario), (Decimal("1.000"), 2))

    def test_dos_ventas_compatibles_se_acumulan(self):
        resultados = self.en_paralelo([self.datos(), self.datos()])
        self.assertEqual([s for s, _ in resultados], [201, 201])
        self.assertNotEqual(resultados[0][1], resultados[1][1])
        self.assertEqual(self.saldo(), (Decimal("8.000"), 3))

    def test_reintentos_simultaneos_reordenados_confirman_una_sola_venta(self):
        clave = uuid4()
        lineas = [self.linea(), self.linea(self.fraccionario, cantidad="1.5")]
        repetido = [self.linea(self.fraccionario, cantidad="1.500"), self.linea(cantidad="1")]
        resultados = self.en_paralelo([self.datos(clave_operacion=clave, detalles=lineas), self.datos(clave_operacion=clave, detalles=repetido)])
        self.assertEqual([s for s, _ in resultados], [201, 201])
        self.assertEqual(resultados[0][1], resultados[1][1])
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(self.saldo(), (Decimal("9.000"), 2))
        self.assertEqual(self.saldo(self.fraccionario), (Decimal("3.500"), 2))

    def test_clave_igual_entre_carritos_disjuntos_resuelta_por_postgres_sin_cambios_del_perdedor(self):
        barrera = Barrier(2, timeout=12)
        original = Venta.full_clean
        def validar_y_esperar(obj, *args, **kwargs):
            original(obj, *args, **kwargs)
            barrera.wait()
        clave = uuid4()
        with patch.object(Venta, "full_clean", validar_y_esperar):
            resultados = self.en_paralelo([self.datos(clave_operacion=clave),
                                         self.datos(clave_operacion=clave, detalles=[self.linea(self.fraccionario)])])
        self.assertCountEqual([s for s, _ in resultados], [201, 409])
        self.assertEqual((Venta.objects.count(), DetalleVenta.objects.count(), VinculoMovimientoVenta.objects.count()), (1, 1, 1))
        for producto, (status, _) in zip((self.producto, self.fraccionario), resultados):
            inicial = Decimal("10.000") if producto == self.producto else Decimal("5.000")
            self.assertEqual(self.saldo(producto), (inicial - 1, 2) if status == 201 else (inicial, 1))

    def esperando_bloqueo(self, cambiar):
        autorizado = Event()
        original = confirmacion.revalidar_contexto_ventas
        def avisar(*args, **kwargs):
            contexto = original(*args, **kwargs)
            autorizado.set()
            return contexto
        with patch.object(confirmacion, "revalidar_contexto_ventas", side_effect=avisar), ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                Existencia.objects.select_for_update().get(producto=self.producto)
                futuro = pool.submit(self.en_conexion, self.datos())
                self.assertTrue(autorizado.wait(timeout=12))
                cambiar()
            return futuro.result(timeout=25)

    def test_clave_confirmada_antes_de_full_clean_se_resuelve_sin_ocultar_otros_errores(self):
        antes_de_validar, continuar = Event(), Event()
        original = Venta.full_clean
        def validar_despues(obj, *args, **kwargs):
            if obj.observaciones == "Perdedor":
                antes_de_validar.set()
                if not continuar.wait(timeout=12):
                    raise RuntimeError("No se confirmó la venta competidora a tiempo.")
            return original(obj, *args, **kwargs)
        clave = uuid4()
        with patch.object(Venta, "full_clean", validar_despues), \
                patch.object(confirmacion, "es_colision_clave", wraps=confirmacion.es_colision_clave) as detectar, \
                ThreadPoolExecutor(max_workers=1) as pool:
            futuro = pool.submit(self.en_conexion, self.datos(clave_operacion=clave, observaciones="Perdedor", detalles=[self.linea(self.fraccionario)]))
            try:
                self.assertTrue(antes_de_validar.wait(timeout=12))
                ganadora = self.confirmar(clave_operacion=clave, observaciones="Ganador")
            finally:
                continuar.set()
            status, _ = futuro.result(timeout=25)
        self.assertEqual(status, 409)
        detectar.assert_called_once()
        self.assertIsInstance(detectar.call_args.args[0], DjangoValidationError)
        self.assertEqual(Venta.objects.get().pk, ganadora.pk)
        self.assertEqual(self.saldo(), (Decimal("9.000"), 2))
        self.assertEqual(self.saldo(self.fraccionario), (Decimal("5.000"), 1))

    def test_permiso_revocado_durante_espera_impide_confirmar(self):
        def revocar():
            Membresia.objects.filter(pk=self.tienda.membresia.pk).update(activo=False)
        status, _ = self.esperando_bloqueo(revocar)
        self.assertEqual(status, 403)
        self.assertFalse(Venta.objects.exists())
        self.assertEqual(self.saldo(), (Decimal("10.000"), 1))

    def test_precio_cambiado_durante_espera_es_conflicto_sin_escritura(self):
        def cambiar():
            producto = Producto.objects.get(pk=self.producto.pk)
            producto.precio_venta = Decimal("3.00")
            producto.save(update_fields=["precio_venta"])
        status, _ = self.esperando_bloqueo(cambiar)
        self.assertEqual(status, 409)
        self.assertFalse(Venta.objects.exists())
        self.assertEqual(self.saldo(), (Decimal("10.000"), 1))

    def test_permiso_revocado_despues_de_guardar_encabezado_revierte_la_venta_completa(self):
        encabezado_guardado, continuar = Event(), Event()
        original = Venta.objects.create
        def guardar_y_esperar(**datos):
            venta = original(**datos)
            encabezado_guardado.set()
            if not continuar.wait(timeout=12):
                raise RuntimeError("No se revocó el permiso a tiempo.")
            return venta
        with patch.object(Venta.objects, "create", side_effect=guardar_y_esperar), ThreadPoolExecutor(max_workers=1) as pool:
            futuro = pool.submit(self.en_conexion, self.datos())
            try:
                self.assertTrue(encabezado_guardado.wait(timeout=12))
                RolPermiso.objects.filter(rol=self.tienda.rol, permiso__codigo="registrar_venta").delete()
            finally:
                continuar.set()
            status, _ = futuro.result(timeout=25)
        self.assertEqual(status, 403)
        self.assertFalse(Venta.objects.exists())
        self.assertFalse(DetalleVenta.objects.exists())
        self.assertFalse(VinculoMovimientoVenta.objects.exists())
        self.assertFalse(MovimientoInventario.objects.filter(tipo="salida").exists())
        self.assertEqual(self.saldo(), (Decimal("10.000"), 1))
        self.assertFalse(RolPermiso.objects.filter(rol=self.tienda.rol, permiso__codigo="registrar_venta").exists())

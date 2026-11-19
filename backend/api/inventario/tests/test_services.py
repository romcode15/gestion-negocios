from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier, Event
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import NotAuthenticated, PermissionDenied, ValidationError

from accesos.models import Membresia, RolPermiso
from api.common.access import resolver_contexto_negocio
from api.common.errors import manejar_excepcion
from api.inventario import services
from api.inventario.exceptions import ConflictoInventario
from api.inventario.services import registrar_movimiento
from catalogo.models import Categoria, Producto
from inventario.models import Existencia, MovimientoInventario
from tests.support.factories import crear_contexto_negocio
from tests.support.fase2 import crear_dos_catalogos_prueba, crear_producto_prueba


class RegistrarMovimientoTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.otro = crear_dos_catalogos_prueba()
        cls.producto = crear_producto_prueba(cls.tienda.contexto.negocio, unidad="kg")
        cls.contexto = resolver_contexto_negocio(cls.tienda.contexto.administrador, cls.producto.negocio_id)

    def registrar(self, contexto=None, **cambios):
        datos = {
            "producto_id": self.producto.pk, "tipo": "entrada", "cantidad": Decimal("1.250"),
            "motivo": "  Recepción de bodega  ", "clave_operacion": uuid4(),
        }
        return registrar_movimiento(contexto or self.contexto, **dict(datos, **cambios))

    def assert_saldo(self, cantidad, version, producto=None):
        existencia = (producto or self.producto).existencias.get()
        self.assertEqual((existencia.cantidad, existencia.version), (Decimal(cantidad), version))

    def test_entrada_salida_y_ajustes_actualizan_saldo_version_e_historial(self):
        entrada = self.registrar(cantidad="8.125")
        salida = self.registrar(tipo="salida", cantidad=Decimal("2.005"))
        ajuste = self.registrar(tipo="ajuste", cantidad=None, stock_objetivo="2.250", version_esperada=2)
        aumento = self.registrar(tipo="ajuste", cantidad=None, stock_objetivo="3", version_esperada=3)

        for movimiento, delta, anterior, saldo in (
            (entrada, "8.125", "0.000", "8.125"), (salida, "-2.005", "8.125", "6.120"),
            (ajuste, "-3.870", "6.120", "2.250"), (aumento, "0.750", "2.250", "3.000"),
        ):
            self.assertEqual(
                (movimiento.cantidad, movimiento.saldo_anterior, movimiento.saldo_posterior),
                (Decimal(delta), Decimal(anterior), Decimal(saldo)),
            )
            self.assertEqual(movimiento.negocio_id, self.contexto.negocio.pk)
            self.assertEqual(movimiento.usuario_id, self.contexto.membresia.usuario_id)
            self.assertTrue(timezone.is_aware(movimiento.creado_en))
            self.assertRegex(movimiento.huella_solicitud, r"^[0-9a-f]{64}$")
        self.assertEqual(entrada.motivo, "Recepción de bodega")
        self.assert_saldo("3.000", 4)
        self.assertEqual(list(self.producto.movimientos.all()), [aumento, ajuste, salida, entrada])

    def test_errores_de_entrada_no_modifican_inventario(self):
        for campo, cambios in (
            ("tipo", {"tipo": []}), ("tipo", {"tipo": "otro"}),
            ("producto_id", {"producto_id": True}), ("producto_id", {"producto_id": -1}),
            ("clave_operacion", {"clave_operacion": "123"}), ("clave_operacion", {"clave_operacion": 123}),
            ("motivo", {"motivo": "   "}), ("motivo", {"motivo": "a" * 256}), ("motivo", {"motivo": "a\x00b"}),
            ("stock_objetivo", {"stock_objetivo": "1"}), ("version_esperada", {"version_esperada": 0}),
        ):
            with self.subTest(cambios=cambios), self.assertRaises(ValidationError) as error:
                self.registrar(**cambios)
            self.assertIn(campo, error.exception.detail)
        for cantidad in (None, 1, 1.25, True, "1e2", "1,25", "1_000", "1.2500", " 1 ", "+1", "0.000",
                         "-1", "100000000000.000", Decimal("NaN"), Decimal("Infinity"), Decimal("1.0001")):
            with self.subTest(cantidad=cantidad), self.assertRaises(ValidationError) as error:
                self.registrar(cantidad=cantidad)
            self.assertIn("cantidad", error.exception.detail)
        self.assert_saldo("0.000", 0)
        self.assertFalse(self.producto.movimientos.exists())

    def test_unidades_enteras_y_fracciones_de_litro(self):
        producto = self.tienda.producto
        with self.assertRaises(ValidationError) as error:
            self.registrar(producto_id=producto.pk, cantidad="1.125")
        self.assertIn("cantidad", error.exception.detail)
        with self.assertRaises(ValidationError) as error:
            self.registrar(
                producto_id=producto.pk, tipo="ajuste", cantidad=None, stock_objetivo="1.125", version_esperada=0,
            )
        self.assertIn("stock_objetivo", error.exception.detail)
        self.registrar(producto_id=producto.pk, cantidad="2.000")
        self.assert_saldo("2.000", 1, producto)

        litros = self.otro.producto_fraccionario
        limitado = resolver_contexto_negocio(self.otro.membresia_compartida.usuario, litros.negocio_id)
        self.registrar(limitado, producto_id=litros.pk, cantidad="0.001")
        self.assert_saldo("2.126", 3, litros)

    def test_salida_sin_saldo_y_desbordamiento_quedan_sin_cambios(self):
        with self.assertRaises(ValidationError) as error:
            self.registrar(tipo="salida", cantidad="0.001")
        self.assertIn("cantidad", error.exception.detail)
        self.assert_saldo("0.000", 0)
        self.registrar(cantidad="99999999999.999")
        with self.assertRaises(ValidationError) as error:
            self.registrar(cantidad="0.001")
        self.assertIn("cantidad", error.exception.detail)
        self.assert_saldo("99999999999.999", 1)
        self.assertEqual(self.producto.movimientos.count(), 1)

    def test_ajuste_invalido_y_version_antigua(self):
        self.registrar(cantidad="3")
        for campo, cambios in (
            ("stock_objetivo", {"stock_objetivo": "-0.001"}), ("stock_objetivo", {"stock_objetivo": "3.000"}),
            ("cantidad", {"cantidad": "1"}), ("version_esperada", {"version_esperada": None}),
            ("version_esperada", {"version_esperada": False}), ("version_esperada", {"version_esperada": -1}),
            ("version_esperada", {"version_esperada": 2**53}),
        ):
            datos = dict({"tipo": "ajuste", "cantidad": None, "stock_objetivo": "2", "version_esperada": 1}, **cambios)
            with self.subTest(cambios=cambios), self.assertRaises(ValidationError) as error:
                self.registrar(**datos)
            self.assertIn(campo, error.exception.detail)
        with self.assertRaises(ConflictoInventario) as conflicto:
            self.registrar(tipo="ajuste", cantidad=None, stock_objetivo="2", version_esperada=0)
        respuesta = manejar_excepcion(conflicto.exception, {})
        self.assertEqual(respuesta.status_code, 409)
        self.assertEqual(respuesta.data, {"code": "conflict", "detail": str(conflicto.exception.detail), "errors": {}})
        self.assert_saldo("3.000", 1)
        self.assertEqual(self.producto.movimientos.count(), 1)

    def test_reintento_normalizado_devuelve_original_aunque_haya_cambiado_saldo_o_estado(self):
        clave = uuid4()
        entrada = self.registrar(clave_operacion=str(clave).upper(), cantidad="5.0", motivo=" Recepción ")
        ajuste = self.registrar(tipo="ajuste", cantidad=None, stock_objetivo="2", version_esperada=1)
        self.producto.activo = False
        self.producto.save(update_fields=["activo"])

        repetido = self.registrar(clave_operacion=clave, cantidad=Decimal("5.000"), motivo="Recepción")
        ajuste_repetido = self.registrar(
            clave_operacion=ajuste.clave_operacion, tipo="ajuste", cantidad=None,
            stock_objetivo=Decimal("2.000"), version_esperada=1,
        )
        self.assertEqual((repetido.pk, repetido.creado_en), (entrada.pk, entrada.creado_en))
        self.assertEqual((ajuste_repetido.pk, ajuste_repetido.creado_en), (ajuste.pk, ajuste.creado_en))
        self.assert_saldo("2.000", 2)
        self.assertEqual(self.producto.movimientos.count(), 2)

    def test_clave_incompatible_por_entrada_o_actor_y_clave_independiente_por_negocio(self):
        producto = self.otro.producto
        administrador = resolver_contexto_negocio(self.otro.contexto.administrador, producto.negocio_id)
        otro_actor = resolver_contexto_negocio(self.otro.membresia_compartida.usuario, producto.negocio_id)
        clave = self.registrar(cantidad="2").clave_operacion
        movimiento = self.registrar(administrador, producto_id=producto.pk, cantidad="2", clave_operacion=clave)
        self.assertEqual(movimiento.negocio_id, producto.negocio_id)

        for cambios in ({"cantidad": "3"}, {"motivo": "Otro motivo"}, {"tipo": "salida"},
                        {"producto_id": self.tienda.producto.pk}):
            datos = dict({"cantidad": "2", "clave_operacion": clave}, **cambios)
            with self.subTest(cambios=cambios), self.assertRaises(ConflictoInventario):
                self.registrar(**datos)
        with self.assertRaises(ConflictoInventario):
            self.registrar(otro_actor, producto_id=producto.pk, cantidad="2", clave_operacion=clave)
        self.assert_saldo("2.000", 1)
        self.assert_saldo("2.000", 1, producto)

    def test_permiso_por_tipo_y_revocacion_incluso_para_reintentos(self):
        contexto = resolver_contexto_negocio(self.otro.membresia_compartida.usuario, self.otro.contexto.negocio.pk)
        producto = self.otro.producto
        datos = {"producto_id": producto.pk, "cantidad": "2", "clave_operacion": uuid4()}
        self.registrar(contexto, **datos)
        with self.assertRaises(PermissionDenied):
            self.registrar(contexto, tipo="salida", **datos)
        with self.assertRaises(PermissionDenied):
            self.registrar(contexto, producto_id=producto.pk, tipo="ajuste", cantidad=None,
                           stock_objetivo="1", version_esperada=1)
        RolPermiso.objects.filter(rol_id=contexto.membresia.rol_id, permiso__codigo="registrar_entrada").delete()
        with self.assertRaises(PermissionDenied):
            self.registrar(contexto, **datos)
        self.assert_saldo("2.000", 1, producto)
        self.assertEqual(producto.movimientos.count(), 1)

    def test_revalida_cuenta_membresia_y_negocio_persistidos(self):
        for entidad, campo, excepcion in (
            (self.contexto.membresia.usuario, "is_active", NotAuthenticated),
            (self.contexto.membresia, "activo", PermissionDenied),
            (self.contexto.negocio, "activo", PermissionDenied),
        ):
            with self.subTest(entidad=entidad), transaction.atomic():
                type(entidad).objects.filter(pk=entidad.pk).update(**{campo: False})
                with self.assertRaises(excepcion):
                    self.registrar()
                transaction.set_rollback(True)
        self.assert_saldo("0.000", 0)
        self.assertFalse(self.producto.movimientos.exists())

    def test_producto_ajeno_inexistente_o_inactivo_devuelve_el_mismo_error_de_campo(self):
        sin_existencia = Producto.objects.create(
            negocio=self.contexto.negocio, categoria=self.producto.categoria, sku="SIN-EXISTENCIA",
            nombre="Producto sin existencia", unidad="kg", precio_venta=Decimal("0.00"),
        )
        respuestas = []
        for producto_id in (self.otro.producto.pk, 999999, self.tienda.producto_inactivo.pk, sin_existencia.pk):
            with self.subTest(producto_id=producto_id), self.assertRaises(ValidationError) as error:
                self.registrar(producto_id=producto_id)
            respuestas.append(error.exception.detail)
        self.assertTrue(all(respuesta == respuestas[0] for respuesta in respuestas))
        self.assertEqual(set(respuestas[0]), {"producto_id"})

        Categoria.objects.filter(pk=self.producto.categoria_id).update(activo=False)
        with self.assertRaises(ValidationError) as error:
            self.registrar()
        self.assertEqual(error.exception.detail, respuestas[0])
        self.assert_saldo("0.000", 0)
        self.assert_saldo("0.000", 0, self.otro.producto)

    def test_fallo_de_guardado_revierte_saldo_y_version_y_conserva_el_error_original(self):
        for fallo in (IntegrityError("Restricción distinta"), DjangoValidationError({"motivo": "Fallo inesperado"})):
            def fallar(**datos):
                self.assert_saldo("1.250", 1)
                raise fallo

            with self.subTest(fallo=fallo), patch.object(MovimientoInventario.objects, "create", side_effect=fallar):
                with self.assertRaises(type(fallo)) as error:
                    self.registrar()
                self.assertIs(error.exception, fallo)
            self.assert_saldo("0.000", 0)
            self.assertFalse(self.producto.movimientos.exists())


class ConcurrenciaMovimientosTests(TransactionTestCase):
    def setUp(self):
        self.negocio = crear_contexto_negocio()
        self.primero = crear_producto_prueba(self.negocio.negocio, unidad="kg")
        self.segundo = crear_producto_prueba(self.negocio.negocio, unidad="litro")

    def registrar(self, producto, **cambios):
        contexto = resolver_contexto_negocio(self.negocio.administrador, self.negocio.negocio.pk)
        datos = {"tipo": "entrada", "cantidad": "1", "motivo": "Conteo", "clave_operacion": uuid4()}
        return registrar_movimiento(contexto, producto_id=producto.pk, **dict(datos, **cambios))

    def en_conexion(self, producto, *, barrera=None, **datos):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                pid, = cursor.fetchone()
            if barrera is not None:
                barrera.wait()
            try:
                resultado = self.registrar(producto, **datos)
            except (ConflictoInventario, PermissionDenied, ValidationError) as error:
                resultado = error
            return pid, resultado
        finally:
            connections.close_all()

    def en_paralelo(self, operaciones):
        barrera = Barrier(2, timeout=10)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futuros = [pool.submit(self.en_conexion, producto, barrera=barrera, **datos) for producto, datos in operaciones]
            resultados = [futuro.result(timeout=15) for futuro in futuros]
        self.assertNotEqual(resultados[0][0], resultados[1][0])
        return [resultado for _, resultado in resultados]

    def assert_saldo(self, producto, cantidad, version):
        saldo = producto.existencias.get()
        self.assertEqual((saldo.cantidad, saldo.version), (Decimal(cantidad), version))

    def test_dos_salidas_no_sobregiran_y_dos_entradas_se_acumulan(self):
        entradas = self.en_paralelo([
            (self.primero, {"cantidad": "2.125"}), (self.primero, {"cantidad": "2.875"}),
        ])
        self.assertTrue(all(isinstance(resultado, MovimientoInventario) for resultado in entradas))
        self.assert_saldo(self.primero, "5.000", 2)
        self.assertNotEqual(entradas[0].clave_operacion, entradas[1].clave_operacion)
        self.assertEqual(self.primero.movimientos.count(), 2)

        salidas = self.en_paralelo([
            (self.primero, {"tipo": "salida", "cantidad": "4.000"}),
            (self.primero, {"tipo": "salida", "cantidad": "4.000"}),
        ])
        self.assertCountEqual([type(resultado) for resultado in salidas], [MovimientoInventario, ValidationError])
        error = next(resultado for resultado in salidas if isinstance(resultado, ValidationError))
        self.assertIn("cantidad", error.detail)
        self.assert_saldo(self.primero, "1.000", 3)
        self.assertEqual(self.primero.movimientos.count(), 3)

    def test_dos_ajustes_con_la_misma_version_no_se_sobrescriben(self):
        resultados = self.en_paralelo([
            (self.primero, {"tipo": "ajuste", "cantidad": None, "stock_objetivo": objetivo, "version_esperada": 0})
            for objetivo in ("1.125", "2.250")
        ])
        self.assertCountEqual([type(resultado) for resultado in resultados], [MovimientoInventario, ConflictoInventario])
        aceptado = next(resultado for resultado in resultados if isinstance(resultado, MovimientoInventario))
        self.assert_saldo(self.primero, aceptado.saldo_posterior, 1)
        self.assertEqual(list(self.primero.movimientos.all()), [aceptado])

    def test_reintentos_identicos_concurrentes_devuelven_un_movimiento(self):
        clave = uuid4()
        primero, segundo = self.en_paralelo([
            (self.primero, {"clave_operacion": clave, "cantidad": cantidad}) for cantidad in ("1.5", "1.500")
        ])
        self.assertIsInstance(primero, MovimientoInventario)
        self.assertIsInstance(segundo, MovimientoInventario)
        self.assertEqual((primero.pk, primero.creado_en), (segundo.pk, segundo.creado_en))
        self.assert_saldo(self.primero, "1.500", 1)
        self.assertEqual(self.primero.movimientos.count(), 1)

    def test_carrera_de_clave_entre_productos_resuelta_por_la_restriccion_de_postgres(self):
        clave = uuid4()
        antes_de_insertar = Barrier(2, timeout=10)
        validar_original = MovimientoInventario.full_clean

        def validar_y_esperar(movimiento, *args, **kwargs):
            validar_original(movimiento, *args, **kwargs)
            antes_de_insertar.wait()

        with (
            patch.object(MovimientoInventario, "full_clean", validar_y_esperar),
            patch.object(services, "_es_colision_de_clave", wraps=services._es_colision_de_clave) as detectar,
        ):
            resultados = self.en_paralelo([
                (self.primero, {"clave_operacion": clave}), (self.segundo, {"clave_operacion": clave}),
            ])
        detectar.assert_called_once()
        self.assertIsInstance(detectar.call_args.args[0], IntegrityError)
        self.assertCountEqual([type(resultado) for resultado in resultados], [MovimientoInventario, ConflictoInventario])
        self.assertEqual(MovimientoInventario.objects.filter(clave_operacion=clave).count(), 1)
        for producto, resultado in zip((self.primero, self.segundo), resultados):
            if isinstance(resultado, MovimientoInventario):
                self.assert_saldo(producto, "1.000", 1)
            else:
                self.assert_saldo(producto, "0.000", 0)

    def test_carrera_de_clave_si_el_otro_producto_confirma_antes_de_validar_el_modelo(self):
        clave = uuid4()
        antes_de_validar = Event()
        confirmado = Event()
        validar_original = MovimientoInventario.full_clean

        def validar_despues_de_confirmar(movimiento, *args, **kwargs):
            if movimiento.producto_id == self.segundo.pk:
                antes_de_validar.set()
                self.assertTrue(confirmado.wait(timeout=10))
            validar_original(movimiento, *args, **kwargs)

        with (
            patch.object(MovimientoInventario, "full_clean", validar_despues_de_confirmar),
            patch.object(services, "_es_colision_de_clave", wraps=services._es_colision_de_clave) as detectar,
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            segundo = pool.submit(self.en_conexion, self.segundo, clave_operacion=clave)
            try:
                self.assertTrue(antes_de_validar.wait(timeout=10))
                pid_primero, primero = pool.submit(self.en_conexion, self.primero, clave_operacion=clave).result(timeout=15)
            finally:
                confirmado.set()
            pid_segundo, conflicto = segundo.result(timeout=15)
        self.assertNotEqual(pid_primero, pid_segundo)
        self.assertIsInstance(primero, MovimientoInventario)
        self.assertIsInstance(conflicto, ConflictoInventario)
        detectar.assert_called_once()
        self.assertIsInstance(detectar.call_args.args[0], DjangoValidationError)
        self.assert_saldo(self.primero, "1.000", 1)
        self.assert_saldo(self.segundo, "0.000", 0)
        self.assertEqual(list(MovimientoInventario.objects.filter(clave_operacion=clave)), [primero])

    def test_revalida_la_membresia_si_se_desactiva_mientras_espera_el_bloqueo(self):
        preautorizado = Event()

        def autorizar_y_avisar(*args, **kwargs):
            contexto = resolver_contexto_negocio(*args, **kwargs)
            preautorizado.set()
            return contexto

        with (
            patch.object(services, "resolver_contexto_negocio", autorizar_y_avisar),
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            with transaction.atomic():
                Existencia.objects.select_for_update().get(producto=self.primero)
                futuro = pool.submit(self.en_conexion, self.primero)
                self.assertTrue(preautorizado.wait(timeout=10))
                Membresia.objects.filter(pk=self.negocio.membresia.pk).update(activo=False)
            _, resultado = futuro.result(timeout=15)
        self.assertIsInstance(resultado, PermissionDenied)
        self.assert_saldo(self.primero, "0.000", 0)
        self.assertFalse(self.primero.movimientos.exists())

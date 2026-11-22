"""Cierre B3: API con sesiones/CSRF reales y concurrencia en PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from decimal import Decimal
from threading import Barrier, Event, Lock, get_ident
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from accesos.models import Membresia
from accesos.services import asignar_superadministrador
from api.catalogo.categorias import services as categorias_services
from api.inventario import services
from catalogo.models import Categoria
from inventario.models import Existencia, MovimientoInventario


# Credencial ficticia de cuentas efímeras; nunca se lee la base local del usuario.
PASSWORD = "Integracion-FaseDos-48!"


class EscenarioAPI:
    def login(self, username):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.get("/api/v1/auth/csrf/").status_code, 204)
        previo = client.cookies["csrftoken"].value
        response = client.post("/api/v1/auth/login/", {"username": username, "password": PASSWORD},
                               format="json", HTTP_X_CSRFTOKEN=previo)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotEqual(client.cookies["csrftoken"].value, previo)
        return client

    def escribir(self, path, data, *, client=None, method="post", csrf=True):
        client = client or self.client
        headers = {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value} if csrf else {}
        return getattr(client, method)(path, data, format="json", **headers)

    def ruta(self, recurso, negocio=None):
        return f"/api/v1/negocios/{negocio or self.negocio['id']}/{recurso}"

    def alta(self, path, data, *, client=None):
        response = self.escribir(path, data, client=client)
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def todas(self, path, *, client=None):
        client = client or self.client
        rows = []
        while path:
            response = client.get(path)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(set(response.data), {"count", "next", "previous", "results"})
            rows.extend(response.data["results"])
            path = response.data["next"]
        return rows

    def preparar(self):
        plataforma = get_user_model().objects.create_user(
            username="plataforma48", password=PASSWORD, is_superuser=True, is_staff=True,
        )
        asignar_superadministrador(plataforma)
        # Solo el arranque de plataforma usa ORM: todo el flujo funcional se realiza por API.
        self.plataforma = self.login(plataforma.username)
        self.admin = self.alta("/api/v1/plataforma/usuarios/", {
            "username": "administrador48", "password": PASSWORD,
        }, client=self.plataforma)
        self.negocio = self.alta("/api/v1/plataforma/negocios/", {
            "nombre": "Tienda B3", "tipo": "tienda", "administrador_id": self.admin["id"],
        }, client=self.plataforma)
        self.client = self.login(self.admin["username"])
        self.categoria = self.alta(self.ruta("categorias/"), {"nombre": "Alimentos"})
        self.producto = self.crear_producto("B3-ARROZ")

    def crear_producto(self, sku, *, negocio=None, categoria=None):
        return self.alta(self.ruta("productos/", negocio), {
            "categoria_id": (categoria or self.categoria)["id"], "sku": sku,
            "nombre": "Arroz", "unidad": "kg", "precio_venta": "2.50", "stock_minimo": "2.000",
        })

    def movimiento(self, *, producto=None, **cambios):
        return dict({"producto_id": (producto or self.producto)["id"], "tipo": "entrada",
                     "cantidad": "5.000", "motivo": "Entrada B3", "clave_operacion": str(uuid4())}, **cambios)

    def saldo(self, producto=None):
        producto = producto or self.producto
        response = self.client.get(self.ruta(f"existencias/{producto['id']}/"))
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def assert_error(self, response, status, code, campo=None):
        self.assertEqual(response.status_code, status, getattr(response, "data", None))
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)
        if campo:
            self.assertIn(campo, response.data["errors"])

    def instantanea(self):
        return (list(Existencia.objects.order_by("id").values()),
                list(MovimientoInventario.objects.order_by("id").values()))

    def rol(self, negocio, nombre, codigos):
        permisos = self.todas(self.ruta("permisos/", negocio))
        return self.alta(self.ruta("roles/", negocio), {
            "nombre": nombre, "permiso_ids": [p["id"] for p in permisos if p["codigo"] in codigos],
        })


class FlujoFase2Tests(EscenarioAPI, TestCase):
    def setUp(self):
        self.preparar()

    def test_ciclo_completo_catalogo_stock_movimientos_y_auditoria(self):
        inicial = self.saldo()
        self.assertEqual((inicial["cantidad"], inicial["version"]), ("0.000", 0))
        self.assertTrue(inicial["bajo_minimo"])
        entrada = self.alta(self.ruta("movimientos/"), self.movimiento())
        salida = self.alta(self.ruta("movimientos/"), self.movimiento(tipo="salida", cantidad="1.250"))
        ajuste = self.alta(self.ruta("ajustes/"), {
            "producto_id": self.producto["id"], "stock_objetivo": "4.125", "version_esperada": 2,
            "motivo": "Conteo B3", "clave_operacion": str(uuid4()),
        })
        self.assertEqual((salida["cantidad"], ajuste["cantidad"]), ("-1.250", "0.375"))
        self.assertEqual((self.saldo()["cantidad"], self.saldo()["version"]), ("4.125", 3))
        rows = self.todas(self.ruta("movimientos/"))
        self.assertEqual([r["id"] for r in rows], [ajuste["id"], salida["id"], entrada["id"]])
        for row in rows:
            self.assertEqual(row["usuario"]["id"], self.admin["id"])
            self.assertEqual(Decimal(row["saldo_anterior"]) + Decimal(row["cantidad"]), Decimal(row["saldo_posterior"]))
            self.assertTrue(row["creado_en"])
            self.assertNotIn("huella_solicitud", row)
        edicion = self.escribir(self.ruta(f"productos/{self.producto['id']}/"), {
            "nombre": "Arroz actualizado", "precio_venta": "3.00", "stock_minimo": "5.000",
        }, method="patch")
        self.assertEqual(edicion.status_code, 200, edicion.data)
        self.assertEqual((self.saldo()["cantidad"], self.saldo()["version"]), ("4.125", 3))
        self.assertTrue(self.saldo()["bajo_minimo"])

    def test_cuenta_compartida_permiso_distinto_y_sku_igual_en_dos_negocios(self):
        otro = self.alta("/api/v1/plataforma/negocios/", {
            "nombre": "Ferretería B3", "tipo": "ferreteria", "administrador_id": self.admin["id"],
        }, client=self.plataforma)
        categoria = self.alta(self.ruta("categorias/", otro["id"]), {"nombre": "Alimentos"})
        producto = self.crear_producto("B3-ARROZ", negocio=otro["id"], categoria=categoria)
        lector = self.rol(self.negocio["id"], "Lector", ["consultar_existencias"])
        escritor = self.rol(otro["id"], "Entradas", ["registrar_entrada"])
        self.alta(self.ruta("membresias/"), {"username": "compartido48", "password": PASSWORD, "rol_id": lector["id"]})
        self.alta(self.ruta("membresias/", otro["id"]), {"username": "compartido48", "rol_id": escritor["id"]})
        client = self.login("compartido48")
        sesion = client.get("/api/v1/auth/me/").data
        self.assertEqual({r["id"]: r["permisos"] for r in sesion["negocios"]}, {
            self.negocio["id"]: ["consultar_existencias"], otro["id"]: ["registrar_entrada"],
        })
        self.assertEqual(client.get(self.ruta("existencias/")).status_code, 200)
        self.assert_error(client.get(self.ruta("existencias/", otro["id"])), 403, "permission_denied")
        self.assert_error(client.get(self.ruta(f"existencias/{producto['id']}/")), 404, "not_found")
        self.assert_error(self.escribir(self.ruta("movimientos/"), self.movimiento(), client=client), 403, "permission_denied")
        self.alta(self.ruta("movimientos/", otro["id"]), self.movimiento(producto=producto), client=client)
        self.assertEqual(self.saldo()["cantidad"], "0.000")
        ajeno = self.escribir(self.ruta("movimientos/"), self.movimiento(producto=producto))
        self.assert_error(ajeno, 400, "validation_error", "producto_id")
        self.assert_error(self.plataforma.get(self.ruta("existencias/")), 403, "permission_denied")

    def test_reintento_y_conflicto_de_clave_no_duplican_ni_modifican_auditoria(self):
        payload = self.movimiento(cantidad="1.5")
        primero = self.alta(self.ruta("movimientos/"), payload)
        antes = self.instantanea()
        segundo = self.alta(self.ruta("movimientos/"), dict(payload, cantidad="1.500"))
        self.assertEqual(primero, segundo)
        self.assertEqual(self.instantanea(), antes)
        self.assert_error(self.escribir(self.ruta("movimientos/"), dict(payload, cantidad="2.000")), 409, "conflict")
        otro = self.crear_producto("B3-OTRO")
        antes = self.instantanea()
        self.assert_error(self.escribir(self.ruta("movimientos/"), dict(payload, producto_id=otro["id"])), 409, "conflict")
        self.assertEqual(self.instantanea(), antes)

    def test_errores_de_escritura_y_csrf_dejan_stock_y_historial_intactos(self):
        antes = self.instantanea()
        casos = [
            ("movimientos/", self.movimiento(tipo="salida"), 400, "validation_error", "cantidad"),
            ("movimientos/", self.movimiento(cantidad="0.0001"), 400, "validation_error", "cantidad"),
            ("movimientos/", self.movimiento(negocio_id=self.negocio["id"]), 400, "validation_error", "negocio_id"),
            ("ajustes/", {"producto_id": self.producto["id"], "stock_objetivo": "3.000", "version_esperada": 9,
                          "motivo": "Desactualizado", "clave_operacion": str(uuid4())}, 409, "conflict", None),
        ]
        for recurso, payload, status, code, campo in casos:
            with self.subTest(recurso=recurso, campo=campo):
                self.assert_error(self.escribir(self.ruta(recurso), payload), status, code, campo)
                self.assertEqual(self.instantanea(), antes)
        self.assert_error(self.escribir(self.ruta("movimientos/"), self.movimiento(), csrf=False), 403, "csrf_failed")
        self.assertEqual(self.instantanea(), antes)

    def test_fallo_de_persistencia_despues_del_saldo_revierte_la_peticion(self):
        antes = self.instantanea()
        def fallar(**datos):
            # Se alcanza la escritura real después de haber actualizado la existencia.
            row = Existencia.objects.get(producto_id=self.producto["id"])
            self.assertEqual((row.cantidad, row.version), (Decimal("5.000"), 1))
            raise RuntimeError("Fallo controlado de persistencia B3")
        with patch.object(MovimientoInventario.objects, "create", side_effect=fallar):
            with self.assertLogs("django.request", level="ERROR"):
                with self.assertRaisesMessage(RuntimeError, "Fallo controlado"):
                    self.escribir(self.ruta("movimientos/"), self.movimiento())
        self.assertEqual(self.instantanea(), antes)
        self.assertEqual(self.saldo()["cantidad"], "0.000")

    def test_inactivos_relectura_y_reintento_ya_confirmado(self):
        payload = self.movimiento()
        registrado = self.alta(self.ruta("movimientos/"), payload)
        self.escribir(self.ruta(f"productos/{self.producto['id']}/"), {"activo": False}, method="patch")
        antes = self.instantanea()
        self.assertEqual(self.alta(self.ruta("movimientos/"), payload), registrado)
        self.assert_error(self.escribir(self.ruta("movimientos/"), self.movimiento()), 400, "validation_error", "producto_id")
        self.assertEqual(self.instantanea(), antes)
        self.assertEqual(len(self.todas(self.ruta("movimientos/"))), 1)
        self.assertFalse(self.saldo()["producto"]["activo"])
        self.assertEqual(self.escribir(self.ruta(f"productos/{self.producto['id']}/"), {"activo": True}, method="patch").status_code, 200)
        membresia = Membresia.objects.get(usuario_id=self.admin["id"], negocio_id=self.negocio["id"])
        for obj, campo in [(membresia, "activo"), (membresia.usuario, "is_active"), (membresia.negocio, "activo")]:
            setattr(obj, campo, False)
            obj.save()
            self.assertEqual(self.client.get(self.ruta("existencias/")).status_code, 403)
            self.assertEqual(self.escribir(self.ruta("movimientos/"), self.movimiento()).status_code, 403)
            setattr(obj, campo, True)
            obj.save()

    def test_listados_solo_admiten_numeros_de_pagina(self):
        for recurso in ("categorias/", "productos/", "existencias/", "movimientos/"):
            with self.subTest(recurso=recurso):
                self.assert_error(self.client.get(self.ruta(recurso) + "?page=last"), 404, "not_found")


class ConcurrenciaFase2HTTPTests(EscenarioAPI, TransactionTestCase):
    def setUp(self):
        self.preparar()
        self.otro_producto = self.crear_producto("B3-OTRO")

    def en_conexion(self, recurso, payload):
        try:
            client = APIClient(enforce_csrf_checks=True)
            client.cookies = deepcopy(self.client.cookies)
            response = self.escribir(self.ruta(recurso), payload, client=client)
            return response.status_code, response.data
        finally:
            connections.close_all()

    def en_paralelo(self, operaciones):
        barrera = Barrier(2, timeout=12)
        pids = {}
        candado = Lock()
        original = services._revalidar_contexto
        def sincronizar(*args, **kwargs):
            contexto = original(*args, **kwargs)
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '8s'")
                cursor.execute("SELECT pg_backend_pid()")
                pid = cursor.fetchone()[0]
            with candado:
                primero = get_ident() not in pids
                pids[get_ident()] = pid
            if primero:
                barrera.wait()
            return contexto
        with patch.object(services, "_revalidar_contexto", side_effect=sincronizar), ThreadPoolExecutor(max_workers=2) as pool:
            futuros = [pool.submit(self.en_conexion, recurso, payload) for recurso, payload in operaciones]
            resultados = [f.result(timeout=25) for f in futuros]
        self.assertEqual(len(set(pids.values())), 2, "Cada petición debe usar su conexión PostgreSQL real.")
        return resultados

    def test_entradas_se_acumulan_y_salidas_simultaneas_no_sobregiran(self):
        entradas = self.en_paralelo([("movimientos/", self.movimiento(cantidad=q)) for q in ("2.125", "2.875")])
        self.assertEqual([status for status, _ in entradas], [201, 201])
        self.assertEqual((self.saldo()["cantidad"], self.saldo()["version"]), ("5.000", 2))
        salidas = self.en_paralelo([("movimientos/", self.movimiento(tipo="salida", cantidad="4.000")) for _ in range(2)])
        self.assertCountEqual([status for status, _ in salidas], [201, 400])
        self.assertEqual((self.saldo()["cantidad"], self.saldo()["version"]), ("1.000", 3))
        self.assertEqual(MovimientoInventario.objects.count(), 3)

    def test_dos_ajustes_con_la_misma_version_no_se_pisan(self):
        ajustes = [("ajustes/", {"producto_id": self.producto["id"], "stock_objetivo": q,
                    "version_esperada": 0, "motivo": "Conteo concurrente", "clave_operacion": str(uuid4())})
                   for q in ("1.125", "2.250")]
        resultados = self.en_paralelo(ajustes)
        self.assertCountEqual([status for status, _ in resultados], [201, 409])
        aceptado = next(data for status, data in resultados if status == 201)
        self.assertEqual((self.saldo()["cantidad"], self.saldo()["version"]), (aceptado["saldo_posterior"], 1))
        self.assertEqual(MovimientoInventario.objects.count(), 1)

    def test_reintentos_http_concurrentes_generan_un_solo_movimiento(self):
        payload = self.movimiento(cantidad="1.5")
        primero, segundo = self.en_paralelo([("movimientos/", payload), ("movimientos/", dict(payload, cantidad="1.500"))])
        self.assertEqual((primero[0], segundo[0]), (201, 201))
        self.assertEqual(primero[1], segundo[1])
        self.assertEqual((self.saldo()["cantidad"], self.saldo()["version"]), ("1.500", 1))
        self.assertEqual(MovimientoInventario.objects.count(), 1)

    def test_colision_de_clave_entre_productos_revierte_el_perdedor(self):
        barrera_insert = Barrier(2, timeout=12)
        original = MovimientoInventario.full_clean
        def validar_y_esperar(obj, *args, **kwargs):
            original(obj, *args, **kwargs)
            barrera_insert.wait()
        clave = str(uuid4())
        with patch.object(MovimientoInventario, "full_clean", validar_y_esperar):
            resultados = self.en_paralelo([
                ("movimientos/", self.movimiento(producto=producto, cantidad="1.000", clave_operacion=clave))
                for producto in (self.producto, self.otro_producto)
            ])
        self.assertCountEqual([status for status, _ in resultados], [201, 409])
        for producto, (status, _) in zip((self.producto, self.otro_producto), resultados):
            saldo = self.saldo(producto)
            self.assertEqual((saldo["cantidad"], saldo["version"]), ("1.000", 1) if status == 201 else ("0.000", 0))
        self.assertEqual(MovimientoInventario.objects.count(), 1)

    def test_revocacion_mientras_espera_categoria_impide_la_edicion_http(self):
        autorizado = Event()
        original = categorias_services.resolver_contexto_negocio
        def avisar(*args, **kwargs):
            contexto = original(*args, **kwargs)
            autorizado.set()
            return contexto
        with patch.object(categorias_services, "resolver_contexto_negocio", side_effect=avisar), ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                Categoria.objects.select_for_update().get(pk=self.categoria["id"])
                futuro = pool.submit(self.editar_categoria_en_conexion)
                self.assertTrue(autorizado.wait(timeout=12))
                Membresia.objects.filter(usuario_id=self.admin["id"], negocio_id=self.negocio["id"]).update(activo=False)
            status, _ = futuro.result(timeout=25)
        self.assertEqual(status, 403)
        self.assertEqual(Categoria.objects.get(pk=self.categoria["id"]).nombre, "Alimentos")

    def editar_categoria_en_conexion(self):
        try:
            client = APIClient(enforce_csrf_checks=True)
            client.cookies = deepcopy(self.client.cookies)
            response = self.escribir(self.ruta(f"categorias/{self.categoria['id']}/"), {"nombre": "No autorizado"}, client=client, method="patch")
            return response.status_code, response.data
        finally:
            connections.close_all()

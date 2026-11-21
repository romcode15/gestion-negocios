import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from accesos.models import Membresia
from api.catalogo.productos import services
from api.catalogo.productos.selectors import productos_del_negocio
from api.catalogo.productos.serializers import ProductoSerializer
from api.common.access import resolver_contexto_negocio
from catalogo.models import Categoria, Producto
from inventario.models import Existencia
from tests.support.api import crear_rol
from tests.support.factories import crear_contexto_negocio, crear_dos_negocios
from tests.support.fase2 import crear_movimiento_prueba, crear_producto_prueba

CAMPOS = {"id", "negocio_id", "categoria_id", "categoria_nombre", "sku", "nombre", "descripcion",
          "unidad", "precio_venta", "stock_minimo", "activo"}
CAMPOS_OPCION = {"id", "negocio_id", "sku", "nombre", "unidad"}


def lista_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/productos/"


def detalle_url(negocio_id, producto_id):
    return f"/api/v1/negocios/{negocio_id}/productos/{producto_id}/"


def opciones_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/productos/opciones/"


class BaseProductos(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.negocio = cls.tienda.negocio
        cls.bebidas = Categoria.objects.create(negocio=cls.negocio, nombre="Bebidas")
        cls.snacks = Categoria.objects.create(negocio=cls.negocio, nombre="Snacks")
        cls.archivada = Categoria.objects.create(negocio=cls.negocio, nombre="Archivada")
        cls.ajena = Categoria.objects.create(negocio=cls.ferreteria.negocio, nombre="Bebidas")
        cls.agua = crear_producto_prueba(cls.negocio, categoria=cls.bebidas, sku="AGUA-1", nombre="Agua mineral",
                                         unidad="litro", precio_venta=Decimal("0.50"))
        cls.papas = crear_producto_prueba(cls.negocio, categoria=cls.snacks, sku="PAPAS-1", nombre="Papas fritas",
                                          precio_venta=Decimal("1.25"))
        cls.viejo = crear_producto_prueba(cls.negocio, categoria=cls.archivada, sku="VIEJO-1", nombre="Descontinuado")
        cls.viejo.activo = False
        cls.viejo.save()
        cls.archivada.activo = False
        cls.archivada.save()
        cls.ajeno = crear_producto_prueba(cls.ferreteria.negocio, categoria=cls.ajena, sku="AGUA-1", nombre="Agua")

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.tienda.administrador)

    def login(self, usuario):
        self.client.force_login(usuario)
        self.client.get("/api/v1/auth/csrf/")
        self.csrf = self.client.cookies["csrftoken"].value

    def miembro(self, username, codigos, ctx=None):
        ctx = ctx or self.tienda
        usuario = get_user_model().objects.create_user(username=username)
        rol = crear_rol(ctx.negocio, f"Rol {username}", codigos)
        Membresia.objects.create(usuario=usuario, negocio=ctx.negocio, rol=rol)
        return usuario

    def post(self, datos, negocio_id=None, csrf=True):
        extra = {"HTTP_X_CSRFTOKEN": self.csrf} if csrf else {}
        return self.client.post(lista_url(negocio_id or self.negocio.pk), datos, format="json", **extra)

    def patch(self, producto_id, datos, negocio_id=None, csrf=True):
        extra = {"HTTP_X_CSRFTOKEN": self.csrf} if csrf else {}
        return self.client.patch(detalle_url(negocio_id or self.negocio.pk, producto_id), datos,
                                 format="json", **extra)

    def datos(self, **cambios):
        base = {"categoria_id": self.bebidas.pk, "sku": "JUGO-1", "nombre": "Jugo", "unidad": "unidad",
                "precio_venta": "2.50"}
        base.update(cambios)
        return {k: v for k, v in base.items() if v is not None}

    def assert_error(self, response, status, code, campos=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)
        if campos is not None:
            self.assertEqual(set(response.data["errors"]), set(campos), response.data)

    def todas(self, url):
        respuesta = self.client.get(url)
        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        resultados = list(respuesta.data["results"])
        while respuesta.data["next"]:
            respuesta = self.client.get(respuesta.data["next"])
            resultados += respuesta.data["results"]
        return resultados

    def estado(self):
        productos = list(Producto.objects.order_by("id").values())
        existencias = list(Existencia.objects.order_by("id").values("producto_id", "cantidad", "version"))
        return productos, existencias


class ListadoTests(BaseProductos):
    def test_listado_paginado_con_categoria_nombre_y_solo_del_negocio(self):
        primera = self.client.get(lista_url(self.negocio.pk))
        self.assertEqual(primera.data["count"], 3)
        self.assertEqual(len(primera.data["results"]), 2)
        productos = self.todas(lista_url(self.negocio.pk))
        self.assertEqual([p["id"] for p in productos], [self.agua.pk, self.papas.pk, self.viejo.pk])
        self.assertTrue(all(set(p) == CAMPOS for p in productos))
        agua = productos[0]
        self.assertEqual((agua["categoria_nombre"], agua["precio_venta"], agua["stock_minimo"]),
                         ("Bebidas", "0.50", "0.000"))
        self.assertNotIn(self.ajeno.pk, {p["id"] for p in productos})

    def test_sin_n_mas_uno(self):
        for i in range(6):
            crear_producto_prueba(self.negocio, categoria=self.snacks if i % 2 else self.bebidas)
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.negocio.pk)
        with self.assertNumQueries(1):
            datos = ProductoSerializer(productos_del_negocio(contexto), many=True).data
        self.assertEqual(len(datos), 9)

    def test_busqueda_por_nombre_o_sku_sin_distinguir_mayusculas(self):
        for search, esperados in (("agua", [self.agua.pk]), ("papas-", [self.papas.pk]), ("  FRITAS ", [self.papas.pk]),
                                  ("1", [self.agua.pk, self.papas.pk, self.viejo.pk]), ("zzz", [])):
            with self.subTest(search=search):
                self.assertEqual([p["id"] for p in self.todas(lista_url(self.negocio.pk) + f"?search={search}")], esperados)

    def test_filtros_categoria_activo_y_combinados(self):
        url = lista_url(self.negocio.pk)
        self.assertEqual([p["id"] for p in self.todas(url + f"?categoria_id={self.bebidas.pk}")], [self.agua.pk])
        self.assertEqual([p["id"] for p in self.todas(url + "?activo=false")], [self.viejo.pk])
        self.assertEqual([p["id"] for p in self.todas(url + "?activo=true")], [self.agua.pk, self.papas.pk])
        self.assertEqual(self.todas(url + f"?categoria_id={self.archivada.pk}&activo=true"), [])
        self.assertEqual([p["id"] for p in self.todas(url + f"?categoria_id={self.archivada.pk}")], [self.viejo.pk])

    def test_filtros_invalidos(self):
        casos = {
            f"?categoria_id={self.ajena.pk}": "categoria_id", "?categoria_id=999999": "categoria_id",
            "?categoria_id=abc": "categoria_id", "?categoria_id=0": "categoria_id", "?categoria_id=-1": "categoria_id",
            "?activo=1": "activo", "?orden=sku": "orden", "?search=a&search=b": "search",
            f"?search={'x' * 151}": "search", "?bajo_minimo=true": "bajo_minimo",
        }
        for query, campo in casos.items():
            with self.subTest(query=query):
                self.assert_error(self.client.get(lista_url(self.negocio.pk) + query), 400, "validation_error", [campo])

    def test_paginas_invalidas(self):
        for page in ("999", "0", "x"):
            with self.subTest(page=page):
                self.assert_error(self.client.get(lista_url(self.negocio.pk) + f"?page={page}"), 404, "not_found")


class CreacionTests(BaseProductos):
    def test_crea_producto_normalizado_con_una_existencia_en_cero(self):
        response = self.post(self.datos(sku="  jugo-naranja_1 ", nombre="  Jugo  ", precio_venta="3",
                                         descripcion=" Natural ", unidad="kg", stock_minimo="1.5"))
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(set(response.data), CAMPOS)
        self.assertEqual(
            {k: response.data[k] for k in ("sku", "nombre", "descripcion", "precio_venta", "stock_minimo", "activo",
                                           "categoria_nombre", "negocio_id")},
            {"sku": "JUGO-NARANJA_1", "nombre": "Jugo", "descripcion": "Natural", "precio_venta": "3.00",
             "stock_minimo": "1.500", "activo": True, "categoria_nombre": "Bebidas", "negocio_id": self.negocio.pk},
        )
        existencias = Existencia.objects.filter(producto_id=response.data["id"])
        self.assertEqual(list(existencias.values_list("negocio_id", "cantidad", "version")),
                         [(self.negocio.pk, Decimal("0.000"), 0)])

    def test_stock_minimo_predeterminado(self):
        response = self.post(self.datos())
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["stock_minimo"], "0.000")

    def test_crear_sin_permiso_de_listar(self):
        self.login(self.miembro("solo_crear", ["crear_producto"]))
        self.assertEqual(self.post(self.datos()).status_code, 201)
        self.assert_error(self.client.get(lista_url(self.negocio.pk)), 403, "permission_denied")

    def test_categoria_ajena_inactiva_o_inexistente(self):
        antes = self.estado()
        for categoria_id in (self.ajena.pk, self.archivada.pk, 999999):
            with self.subTest(categoria_id=categoria_id):
                self.assert_error(self.post(self.datos(categoria_id=categoria_id)), 400, "validation_error",
                                  ["categoria_id"])
        self.assertEqual(self.estado(), antes)

    def test_sku_duplicado_normalizado_y_permitido_en_otro_negocio(self):
        antes = self.estado()
        for sku in ("AGUA-1", "agua-1", "  Agua-1  "):
            with self.subTest(sku=sku):
                self.assert_error(self.post(self.datos(sku=sku)), 400, "validation_error", ["sku"])
        self.assertEqual(self.estado(), antes)
        self.login(self.ferreteria.administrador)
        self.assertEqual(self.post(self.datos(categoria_id=self.ajena.pk, sku="PAPAS-1"),
                                   self.ferreteria.negocio.pk).status_code, 201)

    def test_decimales_y_rangos_invalidos_sin_guardar(self):
        antes = self.estado()
        casos = [
            ({"precio_venta": 2.5}, "precio_venta"), ({"precio_venta": 3}, "precio_venta"),
            ({"precio_venta": "-1.00"}, "precio_venta"), ({"precio_venta": "1.234"}, "precio_venta"),
            ({"precio_venta": "1,50"}, "precio_venta"), ({"precio_venta": "1e3"}, "precio_venta"),
            ({"precio_venta": "NaN"}, "precio_venta"), ({"precio_venta": ""}, "precio_venta"),
            ({"precio_venta": " 1.00"}, "precio_venta"), ({"precio_venta": "10000000000.00"}, "precio_venta"),
            ({"stock_minimo": "1.5"}, "stock_minimo"), ({"stock_minimo": "-1"}, "stock_minimo"),
            ({"stock_minimo": "1.2345", "unidad": "kg"}, "stock_minimo"),
            ({"stock_minimo": "100000000000.000", "unidad": "kg"}, "stock_minimo"),
            ({"stock_minimo": 2}, "stock_minimo"),
        ]
        for cambios, campo in casos:
            with self.subTest(cambios=cambios):
                self.assert_error(self.post(self.datos(**cambios)), 400, "validation_error", [campo])
        self.assertEqual(self.estado(), antes)

    def test_limites_validos_de_decimales(self):
        response = self.post(self.datos(precio_venta="9999999999.99", stock_minimo="5.000"))
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.data["precio_venta"], response.data["stock_minimo"]), ("9999999999.99", "5.000"))

    def test_campos_invalidos_desconocidos_y_requeridos(self):
        antes = self.estado()
        casos = [
            (self.datos(sku="-ABC"), ["sku"]), (self.datos(sku="A B"), ["sku"]), (self.datos(sku="A" * 51), ["sku"]),
            (self.datos(sku=123), ["sku"]), (self.datos(unidad="caja"), ["unidad"]), (self.datos(unidad=1), ["unidad"]),
            (self.datos(categoria_id=str(self.bebidas.pk)), ["categoria_id"]), (self.datos(categoria_id=True), ["categoria_id"]),
            (self.datos(nombre="x" * 151), ["nombre"]), (self.datos(descripcion="x" * 501), ["descripcion"]),
            (dict(self.datos(), activo=False), ["activo"]), (dict(self.datos(), cantidad="5"), ["cantidad"]),
            (dict(self.datos(), negocio_id=1, existencia=1), ["negocio_id", "existencia"]),
            ({}, ["categoria_id", "sku", "nombre", "unidad", "precio_venta"]),
        ]
        for datos, campos in casos:
            with self.subTest(datos=datos):
                self.assert_error(self.post(datos), 400, "validation_error", campos)
        self.assertEqual(self.estado(), antes)

    def test_fallo_al_crear_existencia_revierte_el_producto(self):
        antes = self.estado()
        with patch.object(Existencia, "save", side_effect=RuntimeError("Fallo simulado")):
            with self.assertRaises(RuntimeError):
                self.post(self.datos())
        self.assertEqual(self.estado(), antes)

    def test_choque_de_sku_concurrente_responde_400(self):
        respuestas = iter([False, True])
        with patch.object(services, "sku_en_uso", side_effect=lambda *a, **k: next(respuestas)):
            response = self.post(self.datos(sku="AGUA-1"))
        self.assert_error(response, 400, "validation_error", ["sku"])
        self.assertEqual(Producto.objects.filter(negocio=self.negocio, sku="AGUA-1").count(), 1)


class DetalleYEdicionTests(BaseProductos):
    def test_detalle_y_aislamiento(self):
        response = self.client.get(detalle_url(self.negocio.pk, self.agua.pk))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["categoria_nombre"], "Bebidas")
        for producto_id in (self.ajeno.pk, 999999):
            with self.subTest(producto_id=producto_id):
                self.assert_error(self.client.get(detalle_url(self.negocio.pk, producto_id)), 404, "not_found")
                self.assert_error(self.patch(producto_id, {"nombre": "X"}), 404, "not_found")
        self.assert_error(self.client.get(detalle_url(self.negocio.pk, self.agua.pk) + "?page=1"),
                          400, "validation_error", ["page"])

    def test_editar_no_amplia_listado_y_listar_no_permite_editar(self):
        self.login(self.miembro("editor", ["editar_producto"]))
        self.assertEqual(self.client.get(detalle_url(self.negocio.pk, self.agua.pk)).status_code, 200)
        self.assertEqual(self.patch(self.agua.pk, {"nombre": "Agua sin gas"}).status_code, 200)
        self.assert_error(self.client.get(lista_url(self.negocio.pk)), 403, "permission_denied")
        self.assert_error(self.post(self.datos()), 403, "permission_denied")
        self.login(self.miembro("lector", ["listar_productos"]))
        self.assert_error(self.patch(self.agua.pk, {"nombre": "X"}), 403, "permission_denied")
        self.login(self.miembro("creador", ["crear_producto"]))
        self.assert_error(self.client.get(detalle_url(self.negocio.pk, self.agua.pk)), 403, "permission_denied")

    def test_patch_de_catalogo_nunca_cambia_saldo_ni_version(self):
        crear_movimiento_prueba(self.agua, self.tienda.administrador, tipo="entrada", cantidad=Decimal("7.250"))
        existencia = self.agua.existencias.get()
        response = self.patch(self.agua.pk, {"nombre": "Agua 1L", "precio_venta": "0.75", "stock_minimo": "2.500",
                                             "categoria_id": self.snacks.pk, "sku": "agua-1l", "descripcion": "Nueva"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.data["sku"], response.data["categoria_nombre"], response.data["precio_venta"],
                          response.data["stock_minimo"]), ("AGUA-1L", "Snacks", "0.75", "2.500"))
        existencia.refresh_from_db()
        self.assertEqual((existencia.cantidad, existencia.version), (Decimal("7.250"), 1))
        self.assertEqual(self.agua.movimientos.count(), 1)

    def test_unidad_editable_antes_y_protegida_despues_del_primer_movimiento(self):
        self.assertEqual(self.patch(self.papas.pk, {"unidad": "kg"}).data["unidad"], "kg")
        crear_movimiento_prueba(self.papas, self.tienda.administrador, tipo="entrada", cantidad=Decimal("1.000"))
        antes = self.estado()
        self.assert_error(self.patch(self.papas.pk, {"unidad": "unidad", "nombre": "Cambio"}), 400,
                          "validation_error", ["unidad"])
        self.assertEqual(self.estado(), antes)
        self.assertEqual(self.patch(self.papas.pk, {"unidad": "kg"}).status_code, 200)

    def test_stock_minimo_entero_para_unidad(self):
        self.assert_error(self.patch(self.papas.pk, {"stock_minimo": "1.5"}), 400, "validation_error", ["stock_minimo"])
        self.assertEqual(self.patch(self.agua.pk, {"stock_minimo": "1.5"}).status_code, 200)
        self.assert_error(self.patch(self.agua.pk, {"unidad": "unidad"}), 400, "validation_error", ["stock_minimo"])

    def test_categoria_nueva_debe_ser_activa_y_del_negocio(self):
        antes = self.estado()
        for categoria_id in (self.archivada.pk, self.ajena.pk, 999999):
            with self.subTest(categoria_id=categoria_id):
                self.assert_error(self.patch(self.agua.pk, {"categoria_id": categoria_id}), 400, "validation_error",
                                  ["categoria_id"])
        self.assertEqual(self.estado(), antes)

    def test_desactivar_conserva_saldo_y_reactivar_exige_categoria_activa(self):
        crear_movimiento_prueba(self.agua, self.tienda.administrador, tipo="entrada", cantidad=Decimal("3.000"))
        self.assertFalse(self.patch(self.agua.pk, {"activo": False}).data["activo"])
        self.assertEqual(self.agua.existencias.get().cantidad, Decimal("3.000"))
        self.assertTrue(self.patch(self.agua.pk, {"activo": True}).data["activo"])

        self.assertEqual(self.patch(self.viejo.pk, {"nombre": "Histórico"}).status_code, 200)
        self.assert_error(self.patch(self.viejo.pk, {"activo": True}), 400, "validation_error", ["categoria_id"])
        response = self.patch(self.viejo.pk, {"activo": True, "categoria_id": self.bebidas.pk})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.data["activo"], response.data["categoria_id"]), (True, self.bebidas.pk))

    def test_patch_invalido_sin_cambios_parciales(self):
        antes = self.estado()
        casos = [
            ({}, ["non_field_errors"]), ({"cantidad": "5"}, ["cantidad"]), ({"version": 2}, ["version"]),
            ({"existencia": {"cantidad": "9"}}, ["existencia"]), ({"negocio_id": 2}, ["negocio_id"]),
            ({"sku": "PAPAS-1", "nombre": "Cambio"}, ["sku"]), ({"activo": "true"}, ["activo"]),
            ({"precio_venta": 1}, ["precio_venta"]), ({"nombre": "Ok", "precio_venta": "-1"}, ["precio_venta"]),
            ({"categoria_id": None}, ["categoria_id"]),
        ]
        for datos, campos in casos:
            with self.subTest(datos=datos):
                self.assert_error(self.patch(self.agua.pk, datos), 400, "validation_error", campos)
        self.assertEqual(self.estado(), antes)

    def test_metodos_no_permitidos_405(self):
        h = {"HTTP_X_CSRFTOKEN": self.csrf}
        detalle = detalle_url(self.negocio.pk, self.agua.pk)
        for response in (
            self.client.delete(detalle, **h), self.client.put(detalle, self.datos(), format="json", **h),
            self.client.delete(lista_url(self.negocio.pk), **h),
            self.client.post(opciones_url(self.negocio.pk), {}, format="json", **h),
        ):
            self.assert_error(response, 405, "method_not_allowed")
        self.assertTrue(Producto.objects.filter(pk=self.agua.pk).exists())

    def test_servicio_revalida_permiso_actual(self):
        usuario = self.miembro("revocado", ["editar_producto"])
        contexto = resolver_contexto_negocio(usuario, self.negocio.pk, "editar_producto")
        Membresia.objects.filter(usuario=usuario).update(activo=False)
        from rest_framework.exceptions import PermissionDenied
        with self.assertRaises(PermissionDenied):
            services.actualizar_producto(contexto, self.agua.pk, {"nombre": "Tarde"})
        self.assertEqual(Producto.objects.get(pk=self.agua.pk).nombre, "Agua mineral")


class OpcionesTests(BaseProductos):
    def test_opciones_con_permisos_de_movimiento_sin_listar_productos(self):
        for codigo in ("registrar_entrada", "registrar_salida", "ajustar_inventario"):
            with self.subTest(codigo=codigo):
                self.login(self.miembro(f"con_{codigo}", [codigo]))
                opciones = self.todas(opciones_url(self.negocio.pk))
                self.assertEqual([o["id"] for o in opciones], [self.agua.pk, self.papas.pk])
                self.assertTrue(all(set(o) == CAMPOS_OPCION for o in opciones))
                self.assert_error(self.client.get(lista_url(self.negocio.pk)), 403, "permission_denied")

    def test_opciones_rechazan_permisos_de_catalogo(self):
        self.login(self.miembro("catalogo", ["listar_productos", "crear_producto", "editar_producto",
                                             "consultar_existencias", "listar_movimientos"]))
        self.assert_error(self.client.get(opciones_url(self.negocio.pk)), 403, "permission_denied")

    def test_opciones_busqueda_y_parametros(self):
        self.assertEqual([o["id"] for o in self.todas(opciones_url(self.negocio.pk) + "?search=papas-1")], [self.papas.pk])
        self.assertEqual(self.todas(opciones_url(self.negocio.pk) + "?search=descontinuado"), [])
        for query, campo in (("?activo=false", "activo"), (f"?categoria_id={self.bebidas.pk}", "categoria_id")):
            with self.subTest(query=query):
                self.assert_error(self.client.get(opciones_url(self.negocio.pk) + query), 400, "validation_error", [campo])


class AccesoTests(BaseProductos):
    def rutas(self, negocio_id):
        return [
            ("get", lista_url(negocio_id), None), ("post", lista_url(negocio_id), self.datos()),
            ("get", detalle_url(negocio_id, self.agua.pk), None),
            ("patch", detalle_url(negocio_id, self.agua.pk), {"nombre": "X"}),
            ("get", opciones_url(negocio_id), None),
        ]

    def llamar(self, client, metodo, url, datos):
        if metodo == "get":
            return client.get(url)
        return getattr(client, metodo)(url, datos, format="json", HTTP_X_CSRFTOKEN=self.csrf)

    def test_sin_sesion(self):
        anonimo = APIClient(enforce_csrf_checks=True)
        for metodo, url, datos in self.rutas(self.negocio.pk):
            with self.subTest(metodo=metodo, url=url):
                self.assert_error(self.llamar(anonimo, metodo, url, datos), 403, "not_authenticated")

    def test_csrf_en_escrituras(self):
        antes = self.estado()
        self.assert_error(self.post(self.datos(), csrf=False), 403, "csrf_failed")
        self.assert_error(self.patch(self.agua.pk, {"nombre": "X"}, csrf=False), 403, "csrf_failed")
        self.csrf = "token-invalido"
        self.assert_error(self.post(self.datos()), 403, "csrf_failed")
        self.assertEqual(self.estado(), antes)

    def test_sin_permisos_de_productos(self):
        self.login(self.miembro("ajeno_al_catalogo", ["listar_categorias", "consultar_existencias"]))
        for metodo, url, datos in self.rutas(self.negocio.pk):
            with self.subTest(metodo=metodo, url=url):
                self.assert_error(self.llamar(self.client, metodo, url, datos), 403, "permission_denied")

    def test_negocio_o_membresia_inactivos_y_otro_negocio(self):
        antes = self.estado()
        for objeto in (self.tienda.negocio, self.tienda.membresia):
            objeto.activo = False
            objeto.save()
            for metodo, url, datos in self.rutas(self.negocio.pk):
                with self.subTest(objeto=type(objeto).__name__, metodo=metodo):
                    self.assert_error(self.llamar(self.client, metodo, url, datos), 403, "permission_denied")
            objeto.activo = True
            objeto.save()
        for metodo, url, datos in self.rutas(self.ferreteria.negocio.pk):
            with self.subTest(otro_negocio=metodo):
                self.assert_error(self.llamar(self.client, metodo, url, datos), 403, "permission_denied")
        self.assertEqual(self.estado(), antes)

    def test_cuenta_compartida_con_permisos_distintos(self):
        usuario = self.miembro("compartida", ["listar_productos"])
        rol = crear_rol(self.ferreteria.negocio, "Entradas", ["registrar_entrada"])
        Membresia.objects.create(usuario=usuario, negocio=self.ferreteria.negocio, rol=rol)
        self.login(usuario)
        self.assertEqual(self.client.get(lista_url(self.negocio.pk)).status_code, 200)
        self.assert_error(self.client.get(opciones_url(self.negocio.pk)), 403, "permission_denied")
        self.assertEqual([o["id"] for o in self.todas(opciones_url(self.ferreteria.negocio.pk))], [self.ajeno.pk])
        self.assert_error(self.client.get(lista_url(self.ferreteria.negocio.pk)), 403, "permission_denied")


@override_settings(DEBUG=True)
class DocumentacionProductosTests(TestCase):
    def test_esquema_de_productos(self):
        schema = APIClient().get("/api/schema/?format=json").data
        base = "/api/v1/negocios/{negocio_id}/productos/"
        paths = schema["paths"]
        self.assertEqual(set(paths[base]), {"get", "post"})
        self.assertEqual(set(paths[base + "{producto_id}/"]), {"get", "patch"})
        self.assertEqual(set(paths[base + "opciones/"]), {"get"})
        self.assertEqual({p["name"] for p in paths[base]["get"]["parameters"]},
                         {"negocio_id", "page", "search", "categoria_id", "activo"})
        componentes = schema["components"]["schemas"]
        self.assertEqual(set(componentes["Producto"]["properties"]), CAMPOS)
        self.assertEqual(set(componentes["ProductoOpcion"]["properties"]), CAMPOS_OPCION)
        alta = componentes["CrearProductoRequest"]
        self.assertEqual(set(alta["properties"]),
                         {"categoria_id", "sku", "nombre", "descripcion", "unidad", "precio_venta", "stock_minimo"})
        self.assertEqual(set(alta["required"]), {"categoria_id", "sku", "nombre", "unidad", "precio_venta"})
        for campo in ("precio_venta", "stock_minimo"):
            self.assertEqual(alta["properties"][campo]["type"], "string")
            self.assertEqual(componentes["Producto"]["properties"][campo]["type"], "string")
        self.assertIn("activo", componentes["PatchedActualizarProductoRequest"]["properties"])


class ConcurrenciaProductosTests(TransactionTestCase):
    def ejecutar_en_paralelo(self, primero, segundo):
        """Ejecuta `primero` con un bloqueo tomado y comprueba que `segundo` espera a que termine."""
        bloqueado, continuar = Event(), Event()

        def envolver(funcion, *args):
            close_old_connections()
            try:
                return funcion(*args)
            except ValidationError as error:
                return error.detail
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(envolver, primero, bloqueado, continuar)
            self.assertTrue(bloqueado.wait(10))
            b = pool.submit(envolver, segundo)
            time.sleep(0.5)
            self.assertFalse(b.done(), "La segunda operación debe esperar el bloqueo.")
            continuar.set()
            a.result(timeout=15)
            return b.result(timeout=15)

    def test_alta_espera_desactivacion_de_categoria_y_la_rechaza(self):
        ctx = crear_contexto_negocio()
        categoria = Categoria.objects.create(negocio=ctx.negocio, nombre="Compartida")
        contexto = resolver_contexto_negocio(ctx.administrador, ctx.negocio.pk, "crear_producto")

        def desactivar_categoria(bloqueado, continuar):
            # Mismo protocolo que B4: bloquea la categoría, comprueba productos y la desactiva.
            with transaction.atomic():
                fila = Categoria.objects.select_for_update().get(pk=categoria.pk)
                bloqueado.set()
                continuar.wait(10)
                fila.activo = False
                fila.save()

        def crear():
            return services.crear_producto(contexto, categoria_id=categoria.pk, sku="NUEVO", nombre="Nuevo",
                                           unidad="unidad", precio_venta=Decimal("1.00"))

        resultado = self.ejecutar_en_paralelo(desactivar_categoria, crear)
        self.assertIn("categoria_id", resultado)
        self.assertFalse(Producto.objects.filter(sku="NUEVO").exists())
        self.assertFalse(Existencia.objects.exists())

    def test_cambio_de_unidad_espera_movimiento_y_luego_se_protege(self):
        ctx = crear_contexto_negocio()
        producto = crear_producto_prueba(ctx.negocio, unidad="kg")
        contexto = resolver_contexto_negocio(ctx.administrador, ctx.negocio.pk, "editar_producto")

        def registrar_movimiento(bloqueado, continuar):
            # Mismo orden que el servicio B2: bloquea Existencia antes de registrar.
            with transaction.atomic():
                Existencia.objects.select_for_update().get(producto=producto)
                bloqueado.set()
                continuar.wait(10)
                crear_movimiento_prueba(producto, ctx.administrador, tipo="entrada", cantidad=Decimal("2.500"))

        def cambiar_unidad():
            return services.actualizar_producto(contexto, producto.pk, {"unidad": "litro"})

        resultado = self.ejecutar_en_paralelo(registrar_movimiento, cambiar_unidad)
        self.assertIn("unidad", resultado)
        producto.refresh_from_db()
        self.assertEqual(producto.unidad, "kg")
        self.assertEqual(producto.existencias.get().cantidad, Decimal("2.500"))

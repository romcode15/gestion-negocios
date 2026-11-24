from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accesos.models import Membresia
from api.common.access import resolver_contexto_negocio
from api.ventas.opciones.selectors import opciones_para_vender
from api.ventas.serializers import VentaProductoOpcionSerializer
from catalogo.models import Categoria
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import crear_producto_venta_prueba, crear_venta_confirmada_prueba

CAMPOS = {"id", "negocio_id", "sku", "nombre", "unidad", "precio_venta", "disponible"}


def opciones_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/ventas/productos/opciones/"


def detalle_url(negocio_id, producto_id):
    return f"/api/v1/negocios/{negocio_id}/ventas/productos/{producto_id}/"


class BaseOpcionesVenta(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.negocio = cls.tienda.negocio
        admin = cls.tienda.administrador
        cls.bebidas = Categoria.objects.create(negocio=cls.negocio, nombre="Bebidas")
        cls.archivada = Categoria.objects.create(negocio=cls.negocio, nombre="Archivada")
        cls.agua = crear_producto_venta_prueba(cls.negocio, usuario=admin, saldo=Decimal("5.000"), categoria=cls.bebidas,
                                               sku="AGUA-1", nombre="Agua mineral", precio_venta=Decimal("0.50"))
        cls.queso = crear_producto_venta_prueba(cls.negocio, usuario=admin, saldo=Decimal("1.250"), categoria=cls.bebidas,
                                                sku="QUESO-KG", nombre="Queso fresco", unidad="kg",
                                                precio_venta=Decimal("7.90"))
        cls.agotado = crear_producto_venta_prueba(cls.negocio, categoria=cls.bebidas, sku="JUGO-1", nombre="Jugo",
                                                  precio_venta=Decimal("0.00"))
        cls.inactivo = crear_producto_venta_prueba(cls.negocio, categoria=cls.bebidas, sku="VIEJO-1", nombre="Viejo")
        cls.inactivo.activo = False
        cls.inactivo.save()
        cls.en_archivada = crear_producto_venta_prueba(cls.negocio, categoria=cls.archivada, sku="ARCH-1", nombre="Archivado")
        cls.en_archivada.activo = False
        cls.en_archivada.save()
        cls.archivada.activo = False
        cls.archivada.save()
        ajena = Categoria.objects.create(negocio=cls.ferreteria.negocio, nombre="Bebidas")
        cls.ajeno = crear_producto_venta_prueba(cls.ferreteria.negocio, usuario=cls.ferreteria.administrador,
                                                saldo=Decimal("9.000"), categoria=ajena, sku="AGUA-1",
                                                nombre="Agua mineral", precio_venta=Decimal("0.60"))

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.miembro("vendedor", ["registrar_venta"]))

    def login(self, usuario):
        self.client.force_login(usuario)
        self.client.get("/api/v1/auth/csrf/")
        self.csrf = self.client.cookies["csrftoken"].value

    def miembro(self, username, codigos, ctx=None):
        ctx = ctx or self.tienda
        usuario = get_user_model().objects.create_user(username=f"{username}_{ctx.negocio.pk}")
        rol = crear_rol(ctx.negocio, f"Rol {username}", codigos)
        Membresia.objects.create(usuario=usuario, negocio=ctx.negocio, rol=rol)
        return usuario

    def assert_error(self, response, status, code, campos=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)
        if campos is not None:
            self.assertEqual(set(response.data["errors"]), set(campos), response.data)

    def todas(self, url):
        respuesta = self.client.get(url)
        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        self.assertEqual(set(respuesta.data), {"count", "next", "previous", "results"})
        resultados = list(respuesta.data["results"])
        while respuesta.data["next"]:
            respuesta = self.client.get(respuesta.data["next"])
            self.assertEqual(respuesta.status_code, 200)
            resultados += respuesta.data["results"]
        return resultados


class ListadoOpcionesTests(BaseOpcionesVenta):
    def test_registrar_venta_basta_y_campos_exactos_con_ceros_visibles(self):
        primera = self.client.get(opciones_url(self.negocio.pk))
        self.assertEqual(primera.data["count"], 3)
        self.assertEqual(len(primera.data["results"]), 2)
        self.assertIsNotNone(primera.data["next"])
        opciones = self.todas(opciones_url(self.negocio.pk))
        self.assertTrue(all(set(o) == CAMPOS for o in opciones))
        self.assertEqual(opciones, [
            {"id": self.agua.pk, "negocio_id": self.negocio.pk, "sku": "AGUA-1", "nombre": "Agua mineral",
             "unidad": "unidad", "precio_venta": "0.50", "disponible": "5.000"},
            {"id": self.queso.pk, "negocio_id": self.negocio.pk, "sku": "QUESO-KG", "nombre": "Queso fresco",
             "unidad": "kg", "precio_venta": "7.90", "disponible": "1.250"},
            {"id": self.agotado.pk, "negocio_id": self.negocio.pk, "sku": "JUGO-1", "nombre": "Jugo",
             "unidad": "unidad", "precio_venta": "0.00", "disponible": "0.000"},
        ])

    def test_excluye_inactivos_categoria_inactiva_y_otro_negocio(self):
        ids = {o["id"] for o in self.todas(opciones_url(self.negocio.pk))}
        self.assertFalse(ids & {self.inactivo.pk, self.en_archivada.pk, self.ajeno.pk})

    def test_producto_activo_en_categoria_inactiva_no_se_ofrece(self):
        # Estado heredado de datos previos: la categoría inactiva también lo excluye.
        Categoria.objects.filter(pk=self.bebidas.pk).update(activo=False)
        self.assertEqual(self.todas(opciones_url(self.negocio.pk)), [])
        self.assert_error(self.client.get(detalle_url(self.negocio.pk, self.agua.pk)), 404, "not_found")

    def test_sku_repetido_entre_negocios_cada_uno_ve_lo_suyo(self):
        propio = [o for o in self.todas(opciones_url(self.negocio.pk)) if o["sku"] == "AGUA-1"]
        self.assertEqual([(o["id"], o["precio_venta"], o["disponible"]) for o in propio], [(self.agua.pk, "0.50", "5.000")])
        self.login(self.miembro("vendedor", ["registrar_venta"], self.ferreteria))
        ajeno = self.todas(opciones_url(self.ferreteria.negocio.pk))
        self.assertEqual([(o["id"], o["precio_venta"], o["disponible"]) for o in ajeno], [(self.ajeno.pk, "0.60", "9.000")])

    def test_disponible_refleja_saldo_actual_tras_una_venta(self):
        crear_venta_confirmada_prueba(self.negocio, self.tienda.administrador, detalles=[(self.agua, Decimal("2.000"))])
        agua = self.client.get(detalle_url(self.negocio.pk, self.agua.pk)).data
        self.assertEqual(agua["disponible"], "3.000")

    def test_busqueda_en_servidor_por_nombre_o_sku(self):
        for search, esperados in (("agua", [self.agua.pk]), ("queso-", [self.queso.pk]), ("  FRESCO ", [self.queso.pk]),
                                  ("-1", [self.agua.pk, self.agotado.pk]), ("viejo", []), ("zzz", [])):
            with self.subTest(search=search):
                self.assertEqual([o["id"] for o in self.todas(opciones_url(self.negocio.pk) + f"?search={search}")],
                                 esperados)

    def test_busqueda_abarca_todas_las_paginas(self):
        for i in range(4):
            crear_producto_venta_prueba(self.negocio, categoria=self.bebidas, sku=f"AGUA-X{i}", nombre=f"Agua {i}")
        primera = self.client.get(opciones_url(self.negocio.pk) + "?search=agua")
        self.assertEqual(primera.data["count"], 5)
        self.assertEqual(len(self.todas(opciones_url(self.negocio.pk) + "?search=agua")), 5)

    def test_sin_n_mas_uno(self):
        for i in range(6):
            crear_producto_venta_prueba(self.negocio, usuario=self.tienda.administrador, saldo=Decimal(i),
                                        categoria=self.bebidas)
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.negocio.pk)
        with self.assertNumQueries(1):
            datos = VentaProductoOpcionSerializer(opciones_para_vender(contexto), many=True).data
        self.assertEqual(len(datos), 9)

    def test_parametros_invalidos(self):
        casos = {
            "?activo=true": "activo", "?categoria_id=1": "categoria_id", "?orden=id": "orden",
            "?search=a&search=b": "search", f"?search={'x' * 151}": "search", "?page_size=50": "page_size",
        }
        for query, campo in casos.items():
            with self.subTest(query=query):
                self.assert_error(self.client.get(opciones_url(self.negocio.pk) + query), 400, "validation_error", [campo])
        for page in ("0", "-1", "abc", "999"):
            with self.subTest(page=page):
                self.assert_error(self.client.get(opciones_url(self.negocio.pk) + f"?page={page}"), 404, "not_found")


class DetalleOpcionTests(BaseOpcionesVenta):
    def test_detalle_activo_con_campos_exactos(self):
        response = self.client.get(detalle_url(self.negocio.pk, self.agotado.pk))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data, {"id": self.agotado.pk, "negocio_id": self.negocio.pk, "sku": "JUGO-1",
                                         "nombre": "Jugo", "unidad": "unidad", "precio_venta": "0.00",
                                         "disponible": "0.000"})

    def test_inactivo_ajeno_o_inexistente_404(self):
        for producto_id in (self.inactivo.pk, self.en_archivada.pk, self.ajeno.pk, 999999):
            with self.subTest(producto_id=producto_id):
                self.assert_error(self.client.get(detalle_url(self.negocio.pk, producto_id)), 404, "not_found")

    def test_detalle_rechaza_parametros(self):
        self.assert_error(self.client.get(detalle_url(self.negocio.pk, self.agua.pk) + "?search=a"),
                          400, "validation_error", ["search"])


class AccesoOpcionesTests(BaseOpcionesVenta):
    def rutas(self, negocio_id):
        return [opciones_url(negocio_id), detalle_url(negocio_id, self.agua.pk)]

    def test_otros_permisos_no_bastan(self):
        for codigo in ("listar_productos", "consultar_existencias", "listar_ventas", "anular_venta",
                       "registrar_entrada", "registrar_salida", "ajustar_inventario", "crear_producto"):
            with self.subTest(codigo=codigo):
                self.login(self.miembro(f"con_{codigo}", [codigo]))
                for url in self.rutas(self.negocio.pk):
                    self.assert_error(self.client.get(url), 403, "permission_denied")

    def test_sin_sesion(self):
        anonimo = APIClient(enforce_csrf_checks=True)
        for url in self.rutas(self.negocio.pk):
            with self.subTest(url=url):
                self.assert_error(anonimo.get(url), 403, "not_authenticated")

    def test_negocio_membresia_y_cuenta_inactivos(self):
        usuario = self.miembro("temporal", ["registrar_venta"])
        membresia = Membresia.objects.get(usuario=usuario)
        self.login(usuario)
        for objeto in (self.tienda.negocio, membresia):
            objeto.activo = False
            objeto.save()
            for url in self.rutas(self.negocio.pk):
                with self.subTest(objeto=type(objeto).__name__, url=url):
                    self.assert_error(self.client.get(url), 403, "permission_denied")
            objeto.activo = True
            objeto.save()
        usuario.is_active = False
        usuario.save()
        response = self.client.get(opciones_url(self.negocio.pk))
        self.assertEqual(response.status_code, 403)
        self.assertIn(response.data["code"], {"not_authenticated", "permission_denied"})

    def test_otro_negocio_sin_membresia(self):
        for url in self.rutas(self.ferreteria.negocio.pk):
            with self.subTest(url=url):
                self.assert_error(self.client.get(url), 403, "permission_denied")

    def test_cuenta_compartida_con_permisos_distintos(self):
        usuario = self.miembro("compartida", ["registrar_venta"])
        rol = crear_rol(self.ferreteria.negocio, "Solo listar", ["listar_ventas"])
        Membresia.objects.create(usuario=usuario, negocio=self.ferreteria.negocio, rol=rol)
        self.login(usuario)
        self.assertEqual(self.client.get(opciones_url(self.negocio.pk)).status_code, 200)
        self.assert_error(self.client.get(opciones_url(self.ferreteria.negocio.pk)), 403, "permission_denied")

    def test_solo_lectura_405_sin_cambios(self):
        h = {"HTTP_X_CSRFTOKEN": self.csrf}
        for url in self.rutas(self.negocio.pk):
            for metodo in ("post", "put", "patch", "delete"):
                with self.subTest(url=url, metodo=metodo):
                    self.assert_error(getattr(self.client, metodo)(url, {}, format="json", **h), 405, "method_not_allowed")
        self.agua.refresh_from_db()
        self.assertEqual((self.agua.precio_venta, self.agua.existencias.get().cantidad), (Decimal("0.50"), Decimal("5.000")))

    def test_no_modifica_opciones_de_productos_de_fase_2(self):
        self.login(self.miembro("entradas", ["registrar_entrada"]))
        opciones = self.todas(f"/api/v1/negocios/{self.negocio.pk}/productos/opciones/")
        self.assertTrue(all(set(o) == {"id", "negocio_id", "sku", "nombre", "unidad"} for o in opciones))


@override_settings(DEBUG=True)
class DocumentacionOpcionesVentaTests(TestCase):
    def test_esquema_de_opciones_de_venta(self):
        schema = APIClient().get("/api/schema/?format=json").data
        paths = schema["paths"]
        base = "/api/v1/negocios/{negocio_id}/ventas/productos/"
        self.assertEqual(set(paths[base + "opciones/"]), {"get"})
        self.assertEqual(set(paths[base + "{producto_id}/"]), {"get"})
        self.assertEqual({p["name"] for p in paths[base + "opciones/"]["get"]["parameters"]},
                         {"negocio_id", "page", "search"})
        self.assertEqual(set(paths[base + "opciones/"]["get"]["responses"]), {"200", "400", "403", "404"})
        componente = schema["components"]["schemas"]["VentaProductoOpcion"]["properties"]
        self.assertEqual(set(componente), CAMPOS)
        self.assertEqual((componente["precio_venta"]["type"], componente["disponible"]["type"]), ("string", "string"))

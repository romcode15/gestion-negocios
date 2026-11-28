import json
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accesos.models import Membresia
from catalogo.models import Categoria
from inventario.models import Existencia, MovimientoInventario
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase3 import crear_producto_venta_prueba
from ventas.models import DetalleVenta, Venta, VinculoMovimientoVenta

CAMPOS_VENTA = {"id", "negocio_id", "estado", "total", "vendedor", "creado_en", "clave_operacion",
                "observaciones", "detalles", "anulacion"}
CAMPOS_DETALLE = {"id", "producto_id", "sku", "nombre", "unidad", "cantidad", "precio_unitario", "subtotal"}


def ventas_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/ventas/"


class BaseRegistro(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.negocio = cls.tienda.negocio
        admin = cls.tienda.administrador
        cls.categoria = Categoria.objects.create(negocio=cls.negocio, nombre="Abarrotes")
        cls.agua = crear_producto_venta_prueba(cls.negocio, usuario=admin, saldo=Decimal("10.000"), categoria=cls.categoria,
                                               sku="AGUA-1", nombre="Agua", precio_venta=Decimal("0.50"))
        cls.queso = crear_producto_venta_prueba(cls.negocio, usuario=admin, saldo=Decimal("2.000"), categoria=cls.categoria,
                                                sku="QUESO-KG", nombre="Queso", unidad="kg", precio_venta=Decimal("7.90"))
        cls.escaso = crear_producto_venta_prueba(cls.negocio, usuario=admin, saldo=Decimal("1.000"), categoria=cls.categoria,
                                                 sku="ESCASO", nombre="Escaso", precio_venta=Decimal("3.00"))
        cls.inactivo = crear_producto_venta_prueba(cls.negocio, usuario=admin, saldo=Decimal("5.000"),
                                                   categoria=cls.categoria, sku="VIEJO", nombre="Viejo")
        cls.inactivo.activo = False
        cls.inactivo.save()
        ajena = Categoria.objects.create(negocio=cls.ferreteria.negocio, nombre="Abarrotes")
        cls.ajeno = crear_producto_venta_prueba(cls.ferreteria.negocio, usuario=cls.ferreteria.administrador,
                                                saldo=Decimal("9.000"), categoria=ajena, sku="AGUA-1",
                                                precio_venta=Decimal("0.50"))

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.vendedor = self.miembro("vendedor", ["registrar_venta"])
        self.login(self.vendedor)

    def login(self, usuario, client=None):
        client = client or self.client
        client.force_login(usuario)
        client.get("/api/v1/auth/csrf/")
        if client is self.client:
            self.csrf = client.cookies["csrftoken"].value
        return client.cookies["csrftoken"].value

    def miembro(self, username, codigos, ctx=None):
        ctx = ctx or self.tienda
        usuario = get_user_model().objects.create_user(username=f"{username}_{ctx.negocio.pk}")
        rol = crear_rol(ctx.negocio, f"Rol {username}", codigos)
        Membresia.objects.create(usuario=usuario, negocio=ctx.negocio, rol=rol)
        return usuario

    def linea(self, producto, cantidad="1", precio=None):
        return {"producto_id": producto.pk, "cantidad": cantidad,
                "precio_unitario_esperado": precio if precio is not None else f"{producto.precio_venta:.2f}"}

    def cuerpo(self, *lineas, clave=None, **extra):
        datos = {"clave_operacion": clave or str(uuid4()), "detalles": list(lineas) or [self.linea(self.agua)]}
        datos.update(extra)
        return datos

    def post(self, datos, negocio_id=None, csrf=True, client=None, token=None):
        client = client or self.client
        extra = {"HTTP_X_CSRFTOKEN": token or self.csrf} if csrf else {}
        return client.post(ventas_url(negocio_id or self.negocio.pk), datos, format="json", **extra)

    def assert_error(self, response, status, code, campos=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)
        if campos is not None:
            self.assertEqual(set(response.data["errors"]), set(campos), response.data)
            for mensajes in response.data["errors"].values():
                self.assertIsInstance(mensajes, list)

    def estado(self):
        return (
            list(Venta.objects.order_by("id").values_list("id", "estado", "total")),
            DetalleVenta.objects.count(), VinculoMovimientoVenta.objects.count(), MovimientoInventario.objects.count(),
            list(Existencia.objects.order_by("id").values_list("producto_id", "cantidad", "version")),
        )


class RegistroExitosoTests(BaseRegistro):
    def test_venta_con_permiso_minimo_y_respuesta_canonica(self):
        existencia = self.queso.existencias.get()
        response = self.post(self.cuerpo(self.linea(self.queso, "1.250"), self.linea(self.agua, "3"),
                                         observaciones="  Pago en efectivo  "))
        self.assertEqual(response.status_code, 201, response.content)
        datos = response.data
        self.assertEqual(set(datos), CAMPOS_VENTA)
        self.assertNotIn("huella_solicitud", json.dumps(response.json()))
        self.assertEqual((datos["estado"], datos["negocio_id"], datos["observaciones"], datos["anulacion"]),
                         ("confirmada", self.negocio.pk, "Pago en efectivo", None))
        self.assertEqual(datos["vendedor"], {"id": self.vendedor.pk, "username": self.vendedor.username, "is_active": True})
        # 1.250 × 7.90 = 9.875 → 9.88 (HALF_UP por línea); 3 × 0.50 = 1.50; total 11.38.
        self.assertEqual(datos["total"], "11.38")
        detalles = {d["sku"]: d for d in datos["detalles"]}
        self.assertTrue(all(set(d) == CAMPOS_DETALLE for d in datos["detalles"]))
        self.assertEqual(detalles["QUESO-KG"], {
            "id": detalles["QUESO-KG"]["id"], "producto_id": self.queso.pk, "sku": "QUESO-KG", "nombre": "Queso",
            "unidad": "kg", "cantidad": "1.250", "precio_unitario": "7.90", "subtotal": "9.88",
        })
        self.assertEqual((detalles["AGUA-1"]["cantidad"], detalles["AGUA-1"]["subtotal"]), ("3.000", "1.50"))
        existencia.refresh_from_db()
        self.assertEqual((existencia.cantidad, existencia.version), (Decimal("0.750"), 2))
        venta = Venta.objects.get(pk=datos["id"])
        self.assertEqual(VinculoMovimientoVenta.objects.filter(detalle__venta=venta, operacion="venta").count(), 2)
        self.assertTrue(all(v.movimiento.tipo == "salida" for v in VinculoMovimientoVenta.objects.filter(detalle__venta=venta)))

    def test_no_exige_otros_permisos_y_ellos_no_bastan(self):
        sin_venta = self.miembro("inventario", ["listar_ventas", "anular_venta", "listar_productos",
                                                 "consultar_existencias", "registrar_salida", "registrar_entrada"])
        self.login(sin_venta)
        antes = self.estado()
        self.assert_error(self.post(self.cuerpo()), 403, "permission_denied")
        self.assertEqual(self.estado(), antes)

    def test_reintento_identico_o_equivalente_no_duplica(self):
        clave = str(uuid4())
        primera = self.post(self.cuerpo(self.linea(self.agua, "2"), self.linea(self.queso, "1.25"), clave=clave))
        self.assertEqual(primera.status_code, 201, primera.content)
        antes = self.estado()
        # Mismo contenido con líneas reordenadas y cantidades equivalentes.
        segunda = self.post(self.cuerpo(self.linea(self.queso, "1.250"), self.linea(self.agua, "2.000"), clave=clave))
        self.assertEqual(segunda.status_code, 201, segunda.content)
        self.assertEqual(segunda.data, primera.data)
        self.assertEqual(self.estado(), antes)

    def test_misma_clave_con_otro_contenido_u_otro_actor_es_conflicto(self):
        clave = str(uuid4())
        self.assertEqual(self.post(self.cuerpo(self.linea(self.agua, "1"), clave=clave)).status_code, 201)
        antes = self.estado()
        self.assert_error(self.post(self.cuerpo(self.linea(self.agua, "2"), clave=clave)), 409, "conflict", [])
        otro = APIClient(enforce_csrf_checks=True)
        token = self.login(self.miembro("otro_vendedor", ["registrar_venta"]), otro)
        self.assert_error(self.post(self.cuerpo(self.linea(self.agua, "1"), clave=clave), client=otro, token=token),
                          409, "conflict", [])
        self.assertEqual(self.estado(), antes)

    def test_misma_clave_en_otro_negocio_es_otra_venta(self):
        clave = str(uuid4())
        self.assertEqual(self.post(self.cuerpo(clave=clave)).status_code, 201)
        otro = APIClient(enforce_csrf_checks=True)
        token = self.login(self.miembro("vendedor", ["registrar_venta"], self.ferreteria), otro)
        response = self.post(self.cuerpo(self.linea(self.ajeno), clave=clave), self.ferreteria.negocio.pk,
                             client=otro, token=token)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Venta.objects.filter(clave_operacion=clave).count(), 2)

    def test_precio_cobrado_es_el_de_django(self):
        response = self.post(self.cuerpo(self.linea(self.agua, "4", "0.50")))
        self.assertEqual(response.status_code, 201)
        self.assertEqual((response.data["detalles"][0]["precio_unitario"], response.data["total"]), ("0.50", "2.00"))


class RegistroRechazadoTests(BaseRegistro):
    def test_precio_esperado_antiguo_es_409_sin_cambios(self):
        antes = self.estado()
        self.assert_error(self.post(self.cuerpo(self.linea(self.agua, "1", "0.40"))), 409, "conflict", [])
        self.assertEqual(self.estado(), antes)

    def test_stock_insuficiente_en_segunda_linea_no_deja_venta_parcial(self):
        antes = self.estado()
        response = self.post(self.cuerpo(self.linea(self.agua, "2"), self.linea(self.escaso, "2")))
        self.assert_error(response, 400, "validation_error", ["detalles.1.cantidad"])
        self.assertEqual(self.estado(), antes)

    def test_producto_ajeno_inactivo_o_inexistente_por_linea(self):
        antes = self.estado()
        for indice, producto_id in ((1, self.ajeno.pk), (1, self.inactivo.pk), (1, 999999)):
            with self.subTest(producto_id=producto_id):
                linea = {"producto_id": producto_id, "cantidad": "1", "precio_unitario_esperado": "0.50"}
                self.assert_error(self.post(self.cuerpo(self.linea(self.agua), linea)), 400, "validation_error",
                                  [f"detalles.{indice}.producto_id"])
        self.assertEqual(self.estado(), antes)

    def test_objeto_raiz_estricto(self):
        antes = self.estado()
        casos = [
            ({"detalles": [self.linea(self.agua)]}, ["clave_operacion"]),
            ({"clave_operacion": str(uuid4())}, ["detalles"]),
            (self.cuerpo(vendedor=1, estado="anulada", total="0.00", negocio_id=2),
             ["vendedor", "estado", "total", "negocio_id"]),
            (self.cuerpo(creado_en="2026-01-01T00:00:00Z", huella_solicitud="x"), ["creado_en", "huella_solicitud"]),
            (self.cuerpo(clave="no-es-uuid"), ["clave_operacion"]),
            (self.cuerpo(clave="{" + str(uuid4()) + "}"), ["clave_operacion"]),
            (dict(self.cuerpo(), clave_operacion=123), ["clave_operacion"]),
            (dict(self.cuerpo(), clave_operacion=None), ["clave_operacion"]),
            (self.cuerpo(observaciones="x" * 501), ["observaciones"]),
            (self.cuerpo(observaciones=None), ["observaciones"]),
            (self.cuerpo(observaciones=5), ["observaciones"]),
            (dict(self.cuerpo(), detalles={"producto_id": self.agua.pk}), ["detalles"]),
            (dict(self.cuerpo(), detalles="x"), ["detalles"]),
            (dict(self.cuerpo(), detalles=None), ["detalles"]),
            (dict(self.cuerpo(), detalles=[]), ["detalles"]),
        ]
        for datos, campos in casos:
            with self.subTest(datos=datos):
                self.assert_error(self.post(datos), 400, "validation_error", campos)
        for cuerpo in ([self.cuerpo()], "texto", 5):
            with self.subTest(cuerpo=cuerpo):
                self.assert_error(self.post(cuerpo), 400, "validation_error")
        self.assertEqual(self.estado(), antes)

    def test_mas_de_cien_lineas(self):
        lineas = [{"producto_id": i, "cantidad": "1", "precio_unitario_esperado": "1.00"} for i in range(1, 102)]
        self.assert_error(self.post(self.cuerpo(*lineas)), 400, "validation_error", ["detalles"])

    def test_json_mal_formado(self):
        response = self.client.post(ventas_url(self.negocio.pk), data='{"clave_operacion": ',
                                    content_type="application/json", HTTP_X_CSRFTOKEN=self.csrf)
        self.assert_error(response, 400, "validation_error")

    def test_lineas_estrictas_con_errores_planos_por_indice(self):
        antes = self.estado()
        base = self.linea(self.agua)
        casos = [
            ("texto", ["detalles.1"]), (5, ["detalles.1"]), ([base], ["detalles.1"]),
            (dict(base, subtotal="0.50"), ["detalles.1.subtotal"]),
            (dict(base, precio_unitario="0.50"), ["detalles.1.precio_unitario"]),
            ({"producto_id": self.agua.pk}, ["detalles.1.cantidad", "detalles.1.precio_unitario_esperado"]),
            (dict(base, producto_id=str(self.agua.pk)), ["detalles.1.producto_id"]),
            (dict(base, producto_id=True), ["detalles.1.producto_id"]),
            (dict(base, producto_id=float(self.agua.pk)), ["detalles.1.producto_id"]),
            (dict(base, producto_id=0), ["detalles.1.producto_id"]),
            (dict(base, producto_id=2 ** 53), ["detalles.1.producto_id"]),
            (dict(base, producto_id=None), ["detalles.1.producto_id"]),
            (dict(base, cantidad=1), ["detalles.1.cantidad"]),
            (dict(base, cantidad=1.5), ["detalles.1.cantidad"]),
            (dict(base, cantidad="1,5"), ["detalles.1.cantidad"]),
            (dict(base, cantidad="1e2"), ["detalles.1.cantidad"]),
            (dict(base, cantidad="-1"), ["detalles.1.cantidad"]),
            (dict(base, cantidad="0"), ["detalles.1.cantidad"]),
            (dict(base, cantidad="1.2345"), ["detalles.1.cantidad"]),
            (dict(base, cantidad=" 1"), ["detalles.1.cantidad"]),
            (dict(base, precio_unitario_esperado=0.5), ["detalles.1.precio_unitario_esperado"]),
            (dict(base, precio_unitario_esperado="0.500"), ["detalles.1.precio_unitario_esperado"]),
        ]
        primera = self.linea(self.queso, "0.5")
        for linea, campos in casos:
            with self.subTest(linea=linea):
                self.assert_error(self.post(self.cuerpo(primera, linea)), 400, "validation_error", campos)
        self.assertEqual(self.estado(), antes)

    def test_producto_repetido_y_fraccion_en_unidad(self):
        antes = self.estado()
        self.assert_error(self.post(self.cuerpo(self.linea(self.agua), self.linea(self.agua, "2"))), 400,
                          "validation_error", ["detalles.1.producto_id"])
        self.assert_error(self.post(self.cuerpo(self.linea(self.queso, "0.5"), self.linea(self.agua, "1.5"))), 400,
                          "validation_error", ["detalles.1.cantidad"])
        self.assertEqual(self.estado(), antes)


class AccesoRegistroTests(BaseRegistro):
    def test_sin_sesion_y_sin_csrf(self):
        antes = self.estado()
        anonimo = APIClient(enforce_csrf_checks=True)
        self.assert_error(anonimo.post(ventas_url(self.negocio.pk), self.cuerpo(), format="json"), 403, "not_authenticated")
        self.assert_error(self.post(self.cuerpo(), csrf=False), 403, "csrf_failed")
        self.csrf = "token-invalido"
        self.assert_error(self.post(self.cuerpo()), 403, "csrf_failed")
        self.assertEqual(self.estado(), antes)

    def test_negocio_membresia_y_cuenta_inactivos(self):
        antes = self.estado()
        membresia = Membresia.objects.get(usuario=self.vendedor)
        for objeto in (self.tienda.negocio, membresia):
            objeto.activo = False
            objeto.save()
            with self.subTest(objeto=type(objeto).__name__):
                self.assert_error(self.post(self.cuerpo()), 403, "permission_denied")
            objeto.activo = True
            objeto.save()
        self.vendedor.is_active = False
        self.vendedor.save()
        response = self.post(self.cuerpo())
        self.assertEqual(response.status_code, 403)
        self.assertIn(response.data["code"], {"not_authenticated", "permission_denied"})
        self.assertEqual(self.estado(), antes)

    def test_otro_negocio_sin_membresia(self):
        antes = self.estado()
        self.assert_error(self.post(self.cuerpo(self.linea(self.ajeno)), self.ferreteria.negocio.pk),
                          403, "permission_denied")
        self.assertEqual(self.estado(), antes)

    def test_metodos_no_implementados(self):
        h = {"HTTP_X_CSRFTOKEN": self.csrf}
        for metodo in ("put", "patch", "delete"):
            with self.subTest(metodo=metodo):
                self.assert_error(getattr(self.client, metodo)(ventas_url(self.negocio.pk), {}, format="json", **h),
                                  405, "method_not_allowed")

    def test_registrar_venta_no_habilita_el_listado(self):
        response = self.client.get(ventas_url(self.negocio.pk))
        self.assertIn(response.status_code, {403, 405})
        self.assertIn(response.data["code"], {"permission_denied", "method_not_allowed"})


@override_settings(DEBUG=True)
class DocumentacionRegistroTests(TestCase):
    def test_esquema_de_registro(self):
        schema = APIClient().get("/api/schema/?format=json").data
        operacion = schema["paths"]["/api/v1/negocios/{negocio_id}/ventas/"]["post"]
        self.assertEqual(set(operacion["responses"]), {"201", "400", "403", "409"})
        self.assertEqual(operacion["responses"]["201"]["content"]["application/json"]["schema"]["$ref"],
                         "#/components/schemas/VentaDetalle")
        componentes = schema["components"]["schemas"]
        entrada = componentes[operacion["requestBody"]["content"]["application/json"]["schema"]["$ref"].split("/")[-1]]
        self.assertEqual(set(entrada["properties"]), {"clave_operacion", "observaciones", "detalles"})
        self.assertEqual(set(entrada["required"]), {"clave_operacion", "detalles"})
        linea = componentes[entrada["properties"]["detalles"]["items"]["$ref"].split("/")[-1]]
        self.assertEqual(set(linea["properties"]), {"producto_id", "cantidad", "precio_unitario_esperado"})
        self.assertEqual((linea["properties"]["cantidad"]["type"], linea["properties"]["precio_unitario_esperado"]["type"]),
                         ("string", "string"))
        self.assertNotIn("huella_solicitud", json.dumps(componentes["VentaDetalle"]))

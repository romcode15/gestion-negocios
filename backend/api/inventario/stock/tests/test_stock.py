from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accesos.models import Membresia
from api.common.access import resolver_contexto_negocio
from api.inventario.stock.selectors import existencias_del_negocio
from api.inventario.stock.serializers import ExistenciaSerializer
from catalogo.models import Categoria
from inventario.models import Existencia
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase2 import crear_movimiento_prueba, crear_producto_prueba


class ExistenciasTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.otra = crear_dos_negocios()
        cls.categoria = Categoria.objects.create(negocio=cls.tienda.negocio, nombre="Alimentos")
        cls.cero = crear_producto_prueba(cls.tienda.negocio, categoria=cls.categoria, nombre="Arroz cero", sku="ARROZ", stock_minimo=Decimal("0.000"))
        cls.igual = crear_producto_prueba(cls.tienda.negocio, categoria=cls.categoria, sku="CAFE", stock_minimo=Decimal("5.000"))
        crear_movimiento_prueba(cls.igual, cls.tienda.administrador, tipo="entrada", cantidad=Decimal("5.000"))
        cls.bajo = crear_producto_prueba(cls.tienda.negocio, categoria=cls.categoria, sku="LECHE", unidad="litro", stock_minimo=Decimal("2.000"))
        crear_movimiento_prueba(cls.bajo, cls.tienda.administrador, tipo="entrada", cantidad=Decimal("1.250"))
        cls.bajo.activo = False
        cls.bajo.save()
        cls.ajeno = crear_producto_prueba(cls.otra.negocio, sku="ARROZ")
        # La fila de saldo se recrea: su PK ya no coincide con producto_id ni con su orden.
        Existencia.objects.filter(producto=cls.cero).delete()
        Existencia.objects.create(producto=cls.cero, negocio=cls.tienda.negocio)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.tienda.administrador)
        self.path = f"/api/v1/negocios/{self.tienda.negocio.pk}/existencias/"

    def todas(self, query=""):
        response = self.client.get(self.path + query)
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.data["results"][:]
        while response.data["next"]:
            response = self.client.get(response.data["next"])
            self.assertEqual(response.status_code, 200)
            rows.extend(response.data["results"])
        return rows

    def limitado(self, permisos):
        usuario = get_user_model().objects.create_user(username="limitado")
        rol = crear_rol(self.tienda.negocio, "Limitado", permisos)
        Membresia.objects.create(usuario=usuario, negocio=self.tienda.negocio, rol=rol)
        self.client.force_login(usuario)

    def test_campos_exactos_cero_minimos_inactivos_y_orden_por_producto(self):
        rows = self.todas()
        self.assertEqual([r["producto"]["id"] for r in rows], [self.cero.pk, self.igual.pk, self.bajo.pk])
        self.assertTrue(all(set(r) == {"id", "negocio_id", "producto", "cantidad", "stock_minimo", "bajo_minimo", "version"} for r in rows))
        self.assertEqual(set(rows[0]["producto"]), {"id", "negocio_id", "nombre", "sku", "unidad", "activo", "categoria_id", "categoria_nombre"})
        self.assertEqual(rows[0]["cantidad"], "0.000")
        self.assertFalse(rows[0]["bajo_minimo"])
        self.assertFalse(rows[1]["bajo_minimo"])
        self.assertTrue(rows[2]["bajo_minimo"])
        self.assertEqual(rows[2]["cantidad"], "1.250")
        self.assertFalse(rows[2]["producto"]["activo"])

    def test_filtros_y_combinaciones(self):
        self.assertEqual(len(self.todas(f"?categoria_id={self.categoria.pk}")), 3)
        self.assertEqual([r["producto"]["id"] for r in self.todas("?search=arroz")], [self.cero.pk])
        self.assertEqual([r["producto"]["id"] for r in self.todas("?bajo_minimo=true&activo=false")], [self.bajo.pk])
        self.assertEqual(len(self.todas("?bajo_minimo=false&activo=true")), 2)
        self.assertEqual(self.todas("?search=sin-coincidencias"), [])

    def test_filtros_invalidos_y_paginas(self):
        for query, campo in [("activo=1", "activo"), ("bajo_minimo=1", "bajo_minimo"), ("categoria_id=1.0", "categoria_id"),
                              (f"categoria_id={self.ajeno.categoria_id}", "categoria_id"), ("categoria_id=999999", "categoria_id"),
                              ("orden=id", "orden"), ("activo=true&activo=false", "activo"), ("search=" + "x" * 151, "search")]:
            with self.subTest(query=query):
                response = self.client.get(self.path + "?" + query)
                self.assertEqual(response.status_code, 400)
                self.assertIn(campo, response.data["errors"])
        for page in ("0", "-1", "99", "invalida"):
            self.assertEqual(self.client.get(self.path + "?page=" + page).status_code, 404)

    def test_detalle_por_producto_y_aislamiento(self):
        result = self.client.get(self.path + f"{self.cero.pk}/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["producto"]["id"], self.cero.pk)
        self.assertNotEqual(result.data["id"], self.cero.pk)
        self.assertEqual(self.client.get(self.path + f"{self.ajeno.pk}/").status_code, 404)
        self.assertEqual(self.client.get(self.path + "999999/").status_code, 404)
        self.assertEqual(self.client.get(self.path + f"{self.cero.pk}/?search=x").status_code, 400)
        self.assertEqual(self.client.get(f"/api/v1/negocios/{self.otra.negocio.pk}/existencias/").status_code, 403)

    def test_consulta_no_exige_permisos_de_catalogo(self):
        self.limitado(["consultar_existencias"])
        self.assertEqual(len(self.todas()), 3)
        self.assertEqual(self.client.get(self.path + f"{self.cero.pk}/").status_code, 200)
        self.assertEqual(self.client.get(self.path.replace("existencias/", "productos/")).status_code, 403)

    def test_ajustar_solo_concede_detalle_no_lista(self):
        self.limitado(["ajustar_inventario"])
        self.assertEqual(self.client.get(self.path).status_code, 403)
        self.assertEqual(self.client.head(self.path).status_code, 403)
        self.assertEqual(self.client.get(self.path + f"{self.bajo.pk}/").status_code, 200)

    def test_registrar_entrada_no_concede_lectura_de_stock(self):
        self.limitado(["registrar_entrada"])
        self.assertEqual(self.client.get(self.path).status_code, 403)
        self.assertEqual(self.client.get(self.path + f"{self.cero.pk}/").status_code, 403)

    def test_sin_sesion_y_contextos_inactivos(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.path).status_code, 403)
        self.client.force_login(self.tienda.administrador)
        for obj, campo in [(self.tienda.negocio, "activo"), (self.tienda.membresia, "activo"), (self.tienda.administrador, "is_active")]:
            setattr(obj, campo, False)
            obj.save()
            self.assertEqual(self.client.get(self.path).status_code, 403)
            setattr(obj, campo, True)
            obj.save()

    def test_solo_lectura_y_sin_n_mas_uno(self):
        antes = list(Existencia.objects.values_list("id", "cantidad", "version"))
        self.client.get("/api/v1/auth/csrf/")
        token = self.client.cookies["csrftoken"].value
        for method in ("post", "patch", "put", "delete"):
            self.assertEqual(getattr(self.client, method)(self.path, {}, format="json", HTTP_X_CSRFTOKEN=token).status_code, 405)
        self.assertEqual(list(Existencia.objects.values_list("id", "cantidad", "version")), antes)
        contexto = resolver_contexto_negocio(self.tienda.administrador, self.tienda.negocio.pk)
        with self.assertNumQueries(1):
            self.assertEqual(len(ExistenciaSerializer(existencias_del_negocio(contexto), many=True).data), 3)

    @override_settings(DEBUG=True)
    def test_openapi_lecturas_campos_y_permisos(self):
        schema = self.client.get("/api/schema/?format=json").data
        list_path = schema["paths"]["/api/v1/negocios/{negocio_id}/existencias/"]
        self.assertEqual(set(list_path), {"get"})
        self.assertEqual({p["name"] for p in list_path["get"]["parameters"]},
                         {"negocio_id", "page", "search", "categoria_id", "activo", "bajo_minimo"})
        self.assertEqual(set(schema["components"]["schemas"]["Existencia"]["properties"]),
                         {"id", "negocio_id", "producto", "cantidad", "stock_minimo", "bajo_minimo", "version"})

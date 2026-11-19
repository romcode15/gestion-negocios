import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from accesos.models import Membresia
from api.catalogo.categorias import services
from api.common.access import resolver_contexto_negocio
from catalogo.models import Categoria
from tests.support.api import crear_rol
from tests.support.factories import crear_contexto_negocio, crear_dos_negocios
from tests.support.fase2 import crear_producto_prueba

CAMPOS = {"id", "negocio_id", "nombre", "descripcion", "activo"}
CAMPOS_OPCION = {"id", "negocio_id", "nombre"}


def lista_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/categorias/"


def detalle_url(negocio_id, categoria_id):
    return f"/api/v1/negocios/{negocio_id}/categorias/{categoria_id}/"


def opciones_url(negocio_id):
    return f"/api/v1/negocios/{negocio_id}/categorias/opciones/"


class BaseCategorias(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.negocio = cls.tienda.negocio
        cls.bebidas = Categoria.objects.create(negocio=cls.negocio, nombre="Bebidas", descripcion="Frías")
        cls.limpieza = Categoria.objects.create(negocio=cls.negocio, nombre="Limpieza")
        cls.archivada = Categoria.objects.create(negocio=cls.negocio, nombre="Archivada", activo=False)
        cls.ajena = Categoria.objects.create(negocio=cls.ferreteria.negocio, nombre="Bebidas")
        cls.con_producto = Categoria.objects.create(negocio=cls.negocio, nombre="Lácteos")
        crear_producto_prueba(cls.negocio, categoria=cls.con_producto)

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

    def patch(self, categoria_id, datos, negocio_id=None, csrf=True):
        extra = {"HTTP_X_CSRFTOKEN": self.csrf} if csrf else {}
        return self.client.patch(detalle_url(negocio_id or self.negocio.pk, categoria_id), datos,
                                 format="json", **extra)

    def assert_error(self, response, status, code, campos=None):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(set(response.data), {"code", "detail", "errors"})
        self.assertEqual(response.data["code"], code)
        if campos is not None:
            self.assertEqual(set(response.data["errors"]), set(campos), response.data)
            for mensajes in response.data["errors"].values():
                self.assertIsInstance(mensajes, list)

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

    def estado(self):
        return list(Categoria.objects.order_by("id").values_list("id", "nombre", "descripcion", "activo"))


class ListadoTests(BaseCategorias):
    def test_listado_paginado_ordenado_y_solo_del_negocio(self):
        primera = self.client.get(lista_url(self.negocio.pk))
        self.assertEqual(primera.data["count"], 4)
        self.assertEqual(len(primera.data["results"]), 2)
        self.assertIsNone(primera.data["previous"])
        categorias = self.todas(lista_url(self.negocio.pk))
        self.assertEqual([c["id"] for c in categorias],
                         list(Categoria.objects.filter(negocio=self.negocio).order_by("id").values_list("id", flat=True)))
        self.assertTrue(all(set(c) == CAMPOS for c in categorias))
        self.assertTrue(all(c["negocio_id"] == self.negocio.pk for c in categorias))
        self.assertNotIn(self.ajena.pk, {c["id"] for c in categorias})

    def test_pagina_fuera_de_rango_e_invalida(self):
        for page in ("999", "0", "abc"):
            with self.subTest(page=page):
                self.assert_error(self.client.get(lista_url(self.negocio.pk) + f"?page={page}"), 404, "not_found")

    def test_busqueda_parcial_sin_distinguir_mayusculas_y_recortada(self):
        for search in ("beb", "BEBI", "  bebidas  "):
            with self.subTest(search=search):
                resultados = self.todas(lista_url(self.negocio.pk) + f"?search={search}")
                self.assertEqual([c["id"] for c in resultados], [self.bebidas.pk])

    def test_busqueda_sin_coincidencias_devuelve_lista_vacia(self):
        response = self.client.get(lista_url(self.negocio.pk) + "?search=zzz")
        self.assertEqual(response.data, {"count": 0, "next": None, "previous": None, "results": []})

    def test_filtro_activo_y_omitido_incluye_ambos(self):
        activos = {c["id"] for c in self.todas(lista_url(self.negocio.pk) + "?activo=true")}
        inactivos = {c["id"] for c in self.todas(lista_url(self.negocio.pk) + "?activo=false")}
        todos = {c["id"] for c in self.todas(lista_url(self.negocio.pk))}
        self.assertEqual(activos, {self.bebidas.pk, self.limpieza.pk, self.con_producto.pk})
        self.assertEqual(inactivos, {self.archivada.pk})
        self.assertEqual(todos, activos | inactivos)
        combinado = self.todas(lista_url(self.negocio.pk) + "?activo=true&search=limp")
        self.assertEqual([c["id"] for c in combinado], [self.limpieza.pk])

    def test_filtros_invalidos_desconocidos_o_repetidos(self):
        casos = {
            "?activo=1": "activo", "?activo=True": "activo", "?activo=": "activo",
            "?orden=nombre": "orden", "?page_size=50": "page_size", "?categoria_id=1": "categoria_id",
            "?activo=true&activo=false": "activo", "?search=a&search=b": "search",
            f"?search={'x' * 151}": "search",
        }
        for query, campo in casos.items():
            with self.subTest(query=query):
                self.assert_error(self.client.get(lista_url(self.negocio.pk) + query), 400, "validation_error", [campo])


class CreacionTests(BaseCategorias):
    def test_crea_categoria_activa_con_campos_exactos(self):
        response = self.post({"nombre": "  Snacks  ", "descripcion": "  Dulces y salados  "})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(set(response.data), CAMPOS)
        self.assertEqual(response.data["nombre"], "Snacks")
        self.assertEqual(response.data["descripcion"], "Dulces y salados")
        self.assertTrue(response.data["activo"])
        self.assertEqual(response.data["negocio_id"], self.negocio.pk)
        guardada = Categoria.objects.get(pk=response.data["id"])
        self.assertEqual((guardada.negocio_id, guardada.nombre, guardada.activo),
                         (self.negocio.pk, "Snacks", True))

    def test_descripcion_opcional_predeterminada_vacia(self):
        response = self.post({"nombre": "Panadería"})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["descripcion"], "")

    def test_crear_sin_permiso_de_listar(self):
        self.login(self.miembro("solo_crear", ["crear_categoria"]))
        self.assertEqual(self.post({"nombre": "Nueva"}).status_code, 201)
        self.assert_error(self.client.get(lista_url(self.negocio.pk)), 403, "permission_denied")

    def test_validacion_de_campos_sin_guardar(self):
        antes = self.estado()
        casos = [
            ({}, ["nombre"]), ({"nombre": ""}, ["nombre"]), ({"nombre": "   "}, ["nombre"]),
            ({"nombre": "x" * 151}, ["nombre"]), ({"nombre": None}, ["nombre"]), ({"nombre": 123}, ["nombre"]),
            ({"nombre": "Ok", "descripcion": "x" * 501}, ["descripcion"]),
            ({"nombre": "Ok", "descripcion": 5}, ["descripcion"]),
            ({"nombre": "Ok", "activo": False}, ["activo"]),
            ({"nombre": "Ok", "negocio_id": self.ferreteria.negocio.pk, "id": 999}, ["negocio_id", "id"]),
        ]
        for datos, campos in casos:
            with self.subTest(datos=datos):
                self.assert_error(self.post(datos), 400, "validation_error", campos)
        self.assert_error(self.post([{"nombre": "Lista"}]), 400, "validation_error")
        self.assertEqual(self.estado(), antes)

    def test_campos_desconocidos_indican_campo_no_permitido(self):
        response = self.post({"nombre": "Ok", "negocio_id": 1})
        self.assertEqual(response.data["errors"], {"negocio_id": ["Campo no permitido."]})

    def test_nombre_duplicado_en_el_negocio_falla_sin_guardar(self):
        antes = self.estado()
        for nombre in ("Bebidas", "  Bebidas  ", "Archivada"):
            with self.subTest(nombre=nombre):
                self.assert_error(self.post({"nombre": nombre}), 400, "validation_error", ["nombre"])
        self.assertEqual(self.estado(), antes)

    def test_unicidad_distingue_mayusculas_y_es_por_negocio(self):
        self.assertEqual(self.post({"nombre": "bebidas"}).status_code, 201)
        self.login(self.ferreteria.administrador)
        response = self.post({"nombre": "Limpieza"}, self.ferreteria.negocio.pk)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Categoria.objects.filter(nombre="Limpieza").count(), 2)

    def test_choque_de_unicidad_concurrente_responde_400(self):
        respuestas = iter([False, True])
        with patch.object(services, "nombre_en_uso", side_effect=lambda *a, **k: next(respuestas)):
            response = self.post({"nombre": "Bebidas"})
        self.assert_error(response, 400, "validation_error", ["nombre"])
        self.assertEqual(Categoria.objects.filter(negocio=self.negocio, nombre="Bebidas").count(), 1)

    def test_fallo_inesperado_al_guardar_no_deja_registros(self):
        antes = self.estado()
        with patch.object(Categoria, "save", side_effect=RuntimeError("Fallo simulado")):
            with self.assertRaises(RuntimeError):
                self.post({"nombre": "Fallida"})
        self.assertEqual(self.estado(), antes)


class DetalleYEdicionTests(BaseCategorias):
    def test_detalle_del_negocio(self):
        response = self.client.get(detalle_url(self.negocio.pk, self.bebidas.pk))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"id": self.bebidas.pk, "negocio_id": self.negocio.pk, "nombre": "Bebidas",
                                         "descripcion": "Frías", "activo": True})

    def test_detalle_ajeno_o_inexistente_404(self):
        for categoria_id in (self.ajena.pk, 999999):
            with self.subTest(categoria_id=categoria_id):
                self.assert_error(self.client.get(detalle_url(self.negocio.pk, categoria_id)), 404, "not_found")
                self.assert_error(self.patch(categoria_id, {"nombre": "Robada"}), 404, "not_found")
        self.assertEqual(Categoria.objects.get(pk=self.ajena.pk).nombre, "Bebidas")

    def test_editar_con_permiso_propio_no_amplia_el_listado(self):
        self.login(self.miembro("editor", ["editar_categoria"]))
        self.assertEqual(self.client.get(detalle_url(self.negocio.pk, self.bebidas.pk)).status_code, 200)
        self.assertEqual(self.patch(self.bebidas.pk, {"descripcion": "Nueva"}).status_code, 200)
        self.assert_error(self.client.get(lista_url(self.negocio.pk)), 403, "permission_denied")
        self.assert_error(self.post({"nombre": "X"}), 403, "permission_denied")

    def test_listar_permite_detalle_pero_no_editar(self):
        self.login(self.miembro("lector", ["listar_categorias"]))
        self.assertEqual(self.client.get(detalle_url(self.negocio.pk, self.bebidas.pk)).status_code, 200)
        self.assert_error(self.patch(self.bebidas.pk, {"nombre": "X"}), 403, "permission_denied")

    def test_crear_no_concede_detalle(self):
        self.login(self.miembro("creador", ["crear_categoria"]))
        self.assert_error(self.client.get(detalle_url(self.negocio.pk, self.bebidas.pk)), 403, "permission_denied")

    def test_patch_parcial_de_cada_campo(self):
        response = self.patch(self.bebidas.pk, {"nombre": "  Refrescos  "})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.data["nombre"], response.data["descripcion"]), ("Refrescos", "Frías"))
        self.assertEqual(self.patch(self.bebidas.pk, {"descripcion": ""}).data["descripcion"], "")
        self.assertEqual(self.patch(self.bebidas.pk, {"nombre": "Refrescos"}).status_code, 200)
        self.bebidas.refresh_from_db()
        self.assertEqual((self.bebidas.nombre, self.bebidas.descripcion), ("Refrescos", ""))

    def test_desactivar_y_reactivar_sin_borrado_fisico(self):
        response = self.patch(self.limpieza.pk, {"activo": False})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.data["activo"])
        self.assertTrue(Categoria.objects.filter(pk=self.limpieza.pk, activo=False).exists())
        self.assertTrue(self.patch(self.limpieza.pk, {"activo": True}).data["activo"])

    def test_no_desactiva_con_productos_activos(self):
        antes = self.estado()
        response = self.patch(self.con_producto.pk, {"activo": False, "descripcion": "Cambio"})
        self.assert_error(response, 400, "validation_error", ["activo"])
        self.assertEqual(self.estado(), antes)

    def test_desactiva_si_solo_tiene_productos_inactivos(self):
        categoria = Categoria.objects.create(negocio=self.negocio, nombre="Temporada")
        producto = crear_producto_prueba(self.negocio, categoria=categoria)
        producto.activo = False
        producto.save()
        self.assertEqual(self.patch(categoria.pk, {"activo": False}).status_code, 200)

    def test_patch_invalido_sin_cambios(self):
        antes = self.estado()
        casos = [
            ({}, ["non_field_errors"]), ({"activo": "false"}, ["activo"]), ({"activo": 0}, ["activo"]),
            ({"activo": None}, ["activo"]), ({"nombre": ""}, ["nombre"]), ({"nombre": None}, ["nombre"]),
            ({"negocio_id": self.ferreteria.negocio.pk}, ["negocio_id"]), ({"id": 5, "nombre": "X"}, ["id"]),
            ({"nombre": "Limpieza"}, ["nombre"]),
        ]
        for datos, campos in casos:
            with self.subTest(datos=datos):
                self.assert_error(self.patch(self.bebidas.pk, datos), 400, "validation_error", campos)
        self.assertEqual(self.estado(), antes)

    def test_metodos_no_permitidos_405(self):
        detalle = detalle_url(self.negocio.pk, self.bebidas.pk)
        h = {"HTTP_X_CSRFTOKEN": self.csrf}
        for response in (
            self.client.delete(detalle, **h), self.client.put(detalle, {"nombre": "X"}, format="json", **h),
            self.client.delete(lista_url(self.negocio.pk), **h),
            self.client.patch(lista_url(self.negocio.pk), {"nombre": "X"}, format="json", **h),
            self.client.post(opciones_url(self.negocio.pk), {}, format="json", **h),
        ):
            self.assert_error(response, 405, "method_not_allowed")
        self.assertTrue(Categoria.objects.filter(pk=self.bebidas.pk, nombre="Bebidas").exists())


class OpcionesTests(BaseCategorias):
    def test_opciones_con_crear_o_editar_producto_sin_listar_categorias(self):
        for codigo in ("crear_producto", "editar_producto"):
            with self.subTest(codigo=codigo):
                self.login(self.miembro(f"con_{codigo}", [codigo]))
                opciones = self.todas(opciones_url(self.negocio.pk))
                self.assertEqual({o["id"] for o in opciones}, {self.bebidas.pk, self.limpieza.pk, self.con_producto.pk})
                self.assertTrue(all(set(o) == CAMPOS_OPCION for o in opciones))
                self.assertTrue(all(o["negocio_id"] == self.negocio.pk for o in opciones))
                self.assert_error(self.client.get(lista_url(self.negocio.pk)), 403, "permission_denied")

    def test_opciones_requieren_permiso_de_producto(self):
        self.login(self.miembro("solo_listar", ["listar_categorias", "crear_categoria", "editar_categoria"]))
        self.assert_error(self.client.get(opciones_url(self.negocio.pk)), 403, "permission_denied")

    def test_opciones_busqueda_y_parametros(self):
        opciones = self.todas(opciones_url(self.negocio.pk) + "?search=LIMP")
        self.assertEqual([o["id"] for o in opciones], [self.limpieza.pk])
        self.assertEqual(self.client.get(opciones_url(self.negocio.pk) + "?search=archivada").data["count"], 0)
        for query, campo in (("?activo=false", "activo"), ("?categoria_id=1", "categoria_id")):
            with self.subTest(query=query):
                self.assert_error(self.client.get(opciones_url(self.negocio.pk) + query), 400, "validation_error", [campo])


class AccesoTests(BaseCategorias):
    def rutas(self, negocio_id):
        return [
            ("get", lista_url(negocio_id), None), ("post", lista_url(negocio_id), {"nombre": "X"}),
            ("get", detalle_url(negocio_id, self.bebidas.pk), None),
            ("patch", detalle_url(negocio_id, self.bebidas.pk), {"nombre": "X"}),
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

    def test_csrf_ausente_o_invalido_en_escrituras(self):
        antes = self.estado()
        self.assert_error(self.post({"nombre": "X"}, csrf=False), 403, "csrf_failed")
        self.assert_error(self.patch(self.bebidas.pk, {"nombre": "X"}, csrf=False), 403, "csrf_failed")
        self.csrf = "token-invalido"
        self.assert_error(self.post({"nombre": "X"}), 403, "csrf_failed")
        self.assertEqual(self.estado(), antes)

    def test_sin_permiso_alguno_de_categorias(self):
        self.login(self.miembro("sin_permisos", ["listar_roles"]))
        for metodo, url, datos in self.rutas(self.negocio.pk):
            with self.subTest(metodo=metodo, url=url):
                self.assert_error(self.llamar(self.client, metodo, url, datos), 403, "permission_denied")

    def test_negocio_membresia_o_cuenta_inactivos(self):
        antes = self.estado()
        for objeto in (self.tienda.negocio, self.tienda.membresia):
            objeto.activo = False
            objeto.save()
            for metodo, url, datos in self.rutas(self.negocio.pk):
                with self.subTest(objeto=type(objeto).__name__, metodo=metodo, url=url):
                    self.assert_error(self.llamar(self.client, metodo, url, datos), 403, "permission_denied")
            objeto.activo = True
            objeto.save()
        self.tienda.administrador.is_active = False
        self.tienda.administrador.save()
        response = self.client.get(lista_url(self.negocio.pk))
        self.assertEqual(response.status_code, 403)
        self.assertIn(response.data["code"], {"not_authenticated", "permission_denied"})
        self.assertEqual(self.estado(), antes)

    def test_otro_negocio_sin_membresia(self):
        antes = self.estado()
        for metodo, url, datos in self.rutas(self.ferreteria.negocio.pk):
            with self.subTest(metodo=metodo, url=url):
                self.assert_error(self.llamar(self.client, metodo, url, datos), 403, "permission_denied")
        self.assertEqual(self.estado(), antes)

    def test_cuenta_compartida_con_permisos_distintos_por_negocio(self):
        usuario = self.miembro("compartida", ["listar_categorias"])
        rol = crear_rol(self.ferreteria.negocio, "Editor", ["editar_categoria"])
        Membresia.objects.create(usuario=usuario, negocio=self.ferreteria.negocio, rol=rol)
        self.login(usuario)
        self.assertEqual(self.client.get(lista_url(self.negocio.pk)).status_code, 200)
        self.assert_error(self.patch(self.bebidas.pk, {"nombre": "X"}), 403, "permission_denied")
        self.assert_error(self.client.get(lista_url(self.ferreteria.negocio.pk)), 403, "permission_denied")
        response = self.patch(self.ajena.pk, {"descripcion": "Editada"}, self.ferreteria.negocio.pk)
        self.assertEqual(response.status_code, 200, response.content)

    def test_servicio_revalida_permiso_actual(self):
        usuario = self.miembro("revocado", ["editar_categoria"])
        contexto = resolver_contexto_negocio(usuario, self.negocio.pk, "editar_categoria")
        Membresia.objects.filter(usuario=usuario).update(activo=False)
        from rest_framework.exceptions import PermissionDenied
        with self.assertRaises(PermissionDenied):
            services.actualizar_categoria(contexto, self.bebidas.pk, {"nombre": "Tarde"})
        self.assertEqual(Categoria.objects.get(pk=self.bebidas.pk).nombre, "Bebidas")


@override_settings(DEBUG=True)
class DocumentacionCategoriasTests(TestCase):
    def test_esquema_de_categorias(self):
        schema = APIClient().get("/api/schema/?format=json").data
        base = "/api/v1/negocios/{negocio_id}/categorias/"
        paths = schema["paths"]
        self.assertEqual(set(paths[base]), {"get", "post"})
        self.assertEqual(set(paths[base + "{categoria_id}/"]), {"get", "patch"})
        self.assertEqual(set(paths[base + "opciones/"]), {"get"})
        parametros = {p["name"] for p in paths[base]["get"]["parameters"]}
        self.assertEqual(parametros, {"negocio_id", "page", "search", "activo"})
        self.assertEqual({p["name"] for p in paths[base + "opciones/"]["get"]["parameters"]},
                         {"negocio_id", "page", "search"})
        componentes = schema["components"]["schemas"]
        self.assertEqual(set(componentes["Categoria"]["properties"]), CAMPOS)
        self.assertEqual(set(componentes["CategoriaOpcion"]["properties"]), CAMPOS_OPCION)
        self.assertEqual(set(componentes["CrearCategoriaRequest"]["properties"]), {"nombre", "descripcion"})
        self.assertEqual(componentes["CrearCategoriaRequest"]["required"], ["nombre"])
        self.assertEqual(set(componentes["PatchedActualizarCategoriaRequest"]["properties"]),
                         {"nombre", "descripcion", "activo"})
        for metodo, codigos in (("post", {"201", "400", "403"}),):
            self.assertEqual(set(paths[base][metodo]["responses"]), codigos)


class ConcurrenciaCategoriasTests(TransactionTestCase):
    def test_desactivacion_espera_alta_de_producto_y_luego_se_rechaza(self):
        """Simula el protocolo de B5: el alta bloquea la categoría antes de crear el producto."""
        ctx = crear_contexto_negocio()
        categoria = Categoria.objects.create(negocio=ctx.negocio, nombre="Compartida")
        contexto = resolver_contexto_negocio(ctx.administrador, ctx.negocio.pk, "editar_categoria")
        bloqueada, continuar = Event(), Event()

        def alta_de_producto():
            close_old_connections()
            try:
                with transaction.atomic():
                    Categoria.objects.select_for_update().get(pk=categoria.pk)
                    bloqueada.set()
                    continuar.wait(10)
                    crear_producto_prueba(ctx.negocio, categoria=categoria)
            finally:
                connections.close_all()

        def desactivar():
            close_old_connections()
            try:
                services.actualizar_categoria(contexto, categoria.pk, {"activo": False})
                return "desactivada"
            except ValidationError as error:
                return error.detail
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            alta = pool.submit(alta_de_producto)
            self.assertTrue(bloqueada.wait(10))
            desactivacion = pool.submit(desactivar)
            time.sleep(0.5)
            self.assertFalse(desactivacion.done(), "La desactivación debe esperar el bloqueo de la categoría.")
            continuar.set()
            alta.result(timeout=15)
            resultado = desactivacion.result(timeout=15)

        self.assertIn("activo", resultado)
        categoria.refresh_from_db()
        self.assertTrue(categoria.activo)
        self.assertTrue(categoria.productos.filter(activo=True).exists())

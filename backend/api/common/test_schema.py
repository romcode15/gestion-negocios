from io import StringIO

from django.contrib.auth import get_user_model
from django.contrib.staticfiles import finders
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from accesos.services import asignar_superadministrador


@override_settings(DEBUG=True)
class DocumentacionTests(SimpleTestCase):
    def test_swagger_usa_recursos_locales_y_cookie_csrf(self):
        response = self.client.get("/api/docs/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "/static/drf_spectacular_sidecar/swagger-ui-dist/swagger-ui-bundle.js")
        self.assertContains(response, "document.cookie")
        self.assertIn("csrftoken", response.cookies)
        self.assertTrue(finders.find("drf_spectacular_sidecar/swagger-ui-dist/swagger-ui-bundle.js"))

    @override_settings(DEBUG=False)
    def test_documentacion_no_disponible_sin_debug(self):
        for url in ("/api/docs/", "/api/schema/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_esquema_documenta_contrato_actual_sin_endpoints_ficticios(self):
        response = APIClient().get("/api/schema/?format=json")
        self.assertEqual(response.status_code, 200)
        schema = response.data
        paths = schema["paths"]
        self.assertEqual(set(paths), {
            "/api/v1/auth/csrf/", "/api/v1/auth/login/", "/api/v1/auth/me/", "/api/v1/auth/logout/",
            "/api/v1/plataforma/usuarios/", "/api/v1/plataforma/negocios/",
            "/api/v1/negocios/{negocio_id}/membresias/",
            "/api/v1/negocios/{negocio_id}/membresias/{membresia_id}/",
            "/api/v1/negocios/{negocio_id}/permisos/",
            "/api/v1/negocios/{negocio_id}/roles/",
            "/api/v1/negocios/{negocio_id}/roles/asignables/",
            "/api/v1/negocios/{negocio_id}/categorias/",
            "/api/v1/negocios/{negocio_id}/categorias/{categoria_id}/",
            "/api/v1/negocios/{negocio_id}/categorias/opciones/",
            "/api/v1/negocios/{negocio_id}/movimientos/",
            "/api/v1/negocios/{negocio_id}/ajustes/",
            "/api/v1/negocios/{negocio_id}/productos/",
            "/api/v1/negocios/{negocio_id}/productos/{producto_id}/",
            "/api/v1/negocios/{negocio_id}/productos/opciones/",
            "/api/v1/negocios/{negocio_id}/existencias/",
            "/api/v1/negocios/{negocio_id}/existencias/{producto_id}/",
            "/api/v1/negocios/{negocio_id}/ventas/productos/opciones/",
            "/api/v1/negocios/{negocio_id}/ventas/productos/{producto_id}/",
            "/api/v1/negocios/{negocio_id}/ventas/{venta_id}/anulacion/",
        })
        components = schema["components"]["schemas"]
        request = components["CrearUsuarioRequest"]["properties"]
        self.assertEqual(set(request), {"username", "password"})
        self.assertTrue(request["password"]["writeOnly"])
        self.assertEqual(set(components["Usuario"]["properties"]), {"id", "username", "is_active"})
        negocio = components["CrearNegocioRequest"]["properties"]
        self.assertEqual(set(negocio), {"nombre", "tipo", "administrador_id"})
        alta = paths["/api/v1/negocios/{negocio_id}/membresias/"]["post"]
        self.assertEqual(alta["requestBody"]["content"]["application/json"]["schema"]["$ref"],
                         "#/components/schemas/CrearMembresiaRequest")
        entrada = components["CrearMembresiaRequest"]
        self.assertEqual(set(entrada["properties"]), {"username", "password", "rol_id"})
        self.assertEqual(set(entrada["required"]), {"username", "rol_id"})
        self.assertTrue(entrada["properties"]["password"]["writeOnly"])
        self.assertEqual(alta["responses"]["201"]["content"]["application/json"]["schema"]["$ref"],
                         "#/components/schemas/Membresia")
        self.assertEqual(set(components["Membresia"]["properties"]),
                         {"id", "usuario", "negocio_id", "rol_id", "activo"})
        self.assertEqual(paths["/api/v1/auth/login/"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
                         "#/components/schemas/Sesion")
        for url, method in (("/api/v1/auth/csrf/", "get"), ("/api/v1/auth/logout/", "post")):
            self.assertNotIn("content", paths[url][method]["responses"]["204"])
        self.assertNotIn("requestBody", paths["/api/v1/auth/logout/"]["post"])
        self.assertEqual(schema["components"]["securitySchemes"]["cookieAuth"],
                         {"type": "apiKey", "in": "cookie", "name": "sessionid"})
        self.assertIn({"cookieAuth": []}, paths["/api/v1/auth/me/"]["get"]["security"])

    def test_esquema_valido_sin_advertencias(self):
        call_command("spectacular", validate=True, fail_on_warn=True, stdout=StringIO(), stderr=StringIO())

    def test_contrato_completo_fase2_solicitudes_respuestas_y_opciones(self):
        schema = APIClient().get("/api/schema/?format=json").data
        paths = schema["paths"]
        components = schema["components"]["schemas"]
        prefix = "/api/v1/negocios/{negocio_id}/"

        def resolver(value):
            while "$ref" in value:
                value = components[value["$ref"].split("/")[-1]]
            return value

        # (tipo de salida, operaciones); nombres de componentes PATCH pueden variar,
        # pero los campos públicos de cada entrada deben seguir este contrato.
        casos = {
            "categorias/": {"get": ("Categoria", None), "post": ("Categoria", {"nombre", "descripcion"})},
            "categorias/{categoria_id}/": {
                "get": ("Categoria", None), "patch": ("Categoria", {"nombre", "descripcion", "activo"}),
            },
            "categorias/opciones/": {"get": ("CategoriaOpcion", None)},
            "productos/": {"get": ("Producto", None), "post": ("Producto", {
                "categoria_id", "sku", "nombre", "descripcion", "unidad", "precio_venta", "stock_minimo",
            })},
            "productos/{producto_id}/": {"get": ("Producto", None), "patch": ("Producto", {
                "categoria_id", "sku", "nombre", "descripcion", "unidad", "precio_venta", "stock_minimo", "activo",
            })},
            "productos/opciones/": {"get": ("ProductoOpcion", None)},
            "existencias/": {"get": ("Existencia", None)},
            "existencias/{producto_id}/": {"get": ("Existencia", None)},
            "movimientos/": {"get": ("Movimiento", None), "post": ("Movimiento", {
                "producto_id", "tipo", "cantidad", "motivo", "clave_operacion",
            })},
            "ajustes/": {"post": ("Movimiento", {
                "producto_id", "stock_objetivo", "version_esperada", "motivo", "clave_operacion",
            })},
        }
        for ruta, metodos in casos.items():
            path = schema["paths"][prefix + ruta]
            self.assertEqual(set(path), set(metodos), ruta)
            for metodo, (salida, entrada) in metodos.items():
                with self.subTest(ruta=ruta, metodo=metodo):
                    operation = path[metodo]
                    self.assertIn({"cookieAuth": []}, operation["security"])
                    self.assertIn("403", operation["responses"])
                    status = "201" if metodo == "post" else "200"
                    response = resolver(operation["responses"][status]["content"]["application/json"]["schema"])
                    if metodo == "get" and "{" not in ruta:
                        self.assertEqual(set(response["properties"]), {"count", "next", "previous", "results"})
                        response = resolver(response["properties"]["results"]["items"])
                    self.assertEqual(response, components[salida])
                    if entrada is not None:
                        body = resolver(operation["requestBody"]["content"]["application/json"]["schema"])
                        self.assertEqual(set(body["properties"]), entrada)
                        requeridos = entrada - {"descripcion", "stock_minimo"} if metodo == "post" else set()
                        self.assertEqual(set(body.get("required", [])), requeridos)
                        self.assertFalse({"negocio_id", "usuario_id", "saldo_anterior", "saldo_posterior"} & entrada)
                        for campo in {"cantidad", "stock_objetivo", "precio_venta", "stock_minimo"} & entrada:
                            self.assertEqual(resolver(body["properties"][campo])["type"], "string")
                    else:
                        self.assertNotIn("requestBody", operation)

        anulacion = paths[prefix + "ventas/{venta_id}/anulacion/"]["post"]
        self.assertIn({"cookieAuth": []}, anulacion["security"])
        self.assertEqual(
            resolver(anulacion["responses"]["200"]["content"]["application/json"]["schema"]),
            components["VentaDetalle"],
        )
        body = resolver(anulacion["requestBody"]["content"]["application/json"]["schema"])
        self.assertEqual(set(body["properties"]), {"clave_operacion", "motivo"})
        self.assertEqual(set(body["required"]), {"clave_operacion", "motivo"})
        self.assertEqual(
            set(resolver(anulacion["responses"]["409"]["content"]["application/json"]["schema"])["properties"]),
            {"code", "detail", "errors"},
        )

        for component, campos in {
            "CategoriaOpcion": {"id", "negocio_id", "nombre"},
            "ProductoOpcion": {"id", "negocio_id", "sku", "nombre", "unidad"},
            "Existencia": {"id", "negocio_id", "producto", "cantidad", "stock_minimo", "bajo_minimo", "version"},
            "Movimiento": {"id", "negocio_id", "producto", "usuario", "tipo", "cantidad", "saldo_anterior", "saldo_posterior", "motivo", "clave_operacion", "creado_en"},
        }.items():
            self.assertEqual(set(components[component]["properties"]), campos)
        for ruta in ("movimientos/", "ajustes/"):
            conflict = schema["paths"][prefix + ruta]["post"]["responses"]["409"]
            self.assertEqual(set(resolver(conflict["content"]["application/json"]["schema"])["properties"]),
                             {"code", "detail", "errors"})


@override_settings(DEBUG=True)
class FlujoDocumentacionTests(TestCase):
    def test_docs_login_creacion_listados_y_logout_con_csrf_rotado(self):
        usuario = get_user_model().objects.create_user(username="plataforma", password="Pruebas-Swagger-123!")
        asignar_superadministrador(usuario)
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.get("/api/docs/").status_code, 200)
        anterior = client.cookies["csrftoken"].value
        login = client.post("/api/v1/auth/login/", {"username": "plataforma", "password": "Pruebas-Swagger-123!"},
                            format="json", HTTP_X_CSRFTOKEN=anterior)
        self.assertEqual(login.status_code, 200)
        actual = client.cookies["csrftoken"].value
        self.assertNotEqual(anterior, actual)
        nueva = client.post("/api/v1/plataforma/usuarios/", {"username": "administrador", "password": "Cuenta-Swagger-456!"},
                            format="json", HTTP_X_CSRFTOKEN=actual)
        self.assertEqual(nueva.status_code, 201)
        negocio = client.post("/api/v1/plataforma/negocios/", {
            "nombre": "Tienda", "tipo": "tienda", "administrador_id": nueva.data["id"],
        }, format="json", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
        self.assertEqual(negocio.status_code, 201)
        self.assertEqual(client.get("/api/v1/plataforma/negocios/").data["count"], 1)
        self.assertEqual(client.get("/api/v1/plataforma/usuarios/").data["count"], 2)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 200)
        self.assertEqual(client.post("/api/v1/auth/logout/", HTTP_X_CSRFTOKEN=actual).status_code, 204)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 403)

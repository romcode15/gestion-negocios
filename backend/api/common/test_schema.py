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
            "/api/v1/negocios/{negocio_id}/productos/",
            "/api/v1/negocios/{negocio_id}/productos/{producto_id}/",
            "/api/v1/negocios/{negocio_id}/productos/opciones/",
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

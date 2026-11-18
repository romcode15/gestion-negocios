from django.conf import settings
from django.middleware.csrf import get_token
from drf_spectacular.utils import extend_schema
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission


class SoloDesarrollo(BasePermission):
    def has_permission(self, request, view):
        if not settings.DEBUG:
            raise NotFound()
        return True


class SchemaView(SpectacularAPIView):
    authentication_classes = []
    permission_classes = [SoloDesarrollo]


class SwaggerView(SpectacularSwaggerView):
    authentication_classes = []
    permission_classes = [SoloDesarrollo]
    url_name = "api-schema"
    template_name_js = "api/swagger_ui.js"

    @extend_schema(exclude=True)
    def get(self, request, *args, **kwargs):
        get_token(request)
        response = super().get(request, *args, **kwargs)
        response.data["csrf_cookie_name"] = settings.CSRF_COOKIE_NAME
        return response

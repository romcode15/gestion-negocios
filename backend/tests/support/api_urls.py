"""URLs exclusivas de tests; nunca se incluyen en config.urls."""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import JsonResponse
from django.urls import include, path
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers
from rest_framework.generics import GenericAPIView, ListAPIView
from rest_framework.response import Response

from accesos.models import Rol
from api.common.access import obtener_recurso_negocio
from api.common.permissions import TienePermisoGlobal, TienePermisoNegocio
from api.common.serializers import UsuarioSerializer
from django.contrib.auth import get_user_model


class GlobalView(GenericAPIView):
    serializer_class = UsuarioSerializer
    permission_classes = [TienePermisoGlobal]
    permisos_por_metodo = {"GET": "listar_negocios", "POST": "crear_negocio"}

    def get(self, request):
        return Response({"ok": True})

    def post(self, request):
        return Response({"ok": True})


class TenantView(GenericAPIView):
    serializer_class = UsuarioSerializer
    permission_classes = [TienePermisoNegocio]
    permisos_por_metodo = {"GET": "listar_roles", "POST": "crear_rol", "PATCH": "asignar_rol"}

    def get(self, request, negocio_id):
        return Response({"negocio_id": self.contexto_negocio.negocio.pk})

    def post(self, request, negocio_id):
        return Response({"ok": True})

    def patch(self, request, negocio_id):
        return Response({"ok": True})


class RecursoView(TenantView):
    def get(self, request, negocio_id, pk):
        rol = obtener_recurso_negocio(self.contexto_negocio, Rol.objects.all(), pk=pk)
        return Response({"id": rol.pk})


class ListaView(ListAPIView):
    permission_classes = [TienePermisoGlobal]
    permiso_requerido = "listar_usuarios"
    serializer_class = UsuarioSerializer
    queryset = get_user_model().objects.all()

    def get_queryset(self):
        return self.queryset.none() if self.request.query_params.get("empty") else self.queryset.all()


class DatosSerializer(serializers.Serializer):
    nombre = serializers.CharField()


class ErroresView(GenericAPIView):
    serializer_class = DatosSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.data)

    def get(self, request):
        raise DjangoValidationError({"rol_id": ["Rol inválido."]})

    def patch(self, request):
        raise ValueError("Excepción inesperada de prueba")


@csrf_protect
def django_csrf_view(request):
    return JsonResponse({"ok": True})


urlpatterns = [
    path("api/v1/", include("api.urls")),
    path("api/v1/pruebas/global/", GlobalView.as_view()),
    path("api/v1/pruebas/negocios/<int:negocio_id>/", TenantView.as_view()),
    path("api/v1/pruebas/negocios/<int:negocio_id>/roles/<int:pk>/", RecursoView.as_view()),
    path("api/v1/pruebas/lista/", ListaView.as_view()),
    path("api/v1/pruebas/errores/", ErroresView.as_view()),
    path("api/v1/pruebas/django-csrf/", django_csrf_view),
]

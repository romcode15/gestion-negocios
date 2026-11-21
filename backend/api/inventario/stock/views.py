from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema, extend_schema_view
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination

from api.common.pagination import PaginacionPagina
from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from inventario.models import Existencia

from .selectors import existencias_del_negocio
from .serializers import ExistenciaSerializer, FiltrosExistenciasSerializer

ERRORES = {400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer}


class PaginacionExistencias(PaginacionPagina):
    def paginate_queryset(self, queryset, request, view=None):
        # El contrato ordena por producto_id; la base de fase 1 fuerza el id de la existencia.
        return PageNumberPagination.paginate_queryset(self, queryset, request, view)


class ContextoExistenciasMixin:
    permission_classes = [TienePermisoNegocio]
    serializer_class = ExistenciaSerializer
    http_method_names = ["get", "head", "options"]

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["contexto_negocio"] = getattr(self, "contexto_negocio", None)
        return context


@extend_schema_view(get=extend_schema(
    tags=["Existencias"], summary="Consultar existencias del negocio",
    description="Requiere consultar_existencias; incluye saldos de productos inactivos y resúmenes sin exigir permisos de catálogo.",
    parameters=[
        OpenApiParameter("search", OpenApiTypes.STR), OpenApiParameter("categoria_id", OpenApiTypes.INT),
        OpenApiParameter("activo", OpenApiTypes.STR, enum=["true", "false"]),
        OpenApiParameter("bajo_minimo", OpenApiTypes.STR, enum=["true", "false"]),
    ],
    responses={200: ExistenciaSerializer(many=True), **ERRORES},
))
class ExistenciasView(ContextoExistenciasMixin, generics.ListAPIView):
    permiso_requerido = "consultar_existencias"
    pagination_class = PaginacionExistencias

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Existencia.objects.none()
        filtros = FiltrosExistenciasSerializer(
            data=self.request.query_params.dict(), query_params=self.request.query_params,
            context=self.get_serializer_context(),
        )
        filtros.is_valid(raise_exception=True)
        return existencias_del_negocio(self.contexto_negocio, **filtros.validated_data)


@extend_schema_view(get=extend_schema(
    tags=["Existencias"], summary="Consultar saldo y versión de un producto",
    description="Requiere consultar_existencias o ajustar_inventario. El ID de la ruta es producto_id; no habilita el listado con solo ajustar.",
    responses={200: ExistenciaSerializer, **ERRORES},
))
class ExistenciaDetalleView(ContextoExistenciasMixin, generics.RetrieveAPIView):
    permisos_por_metodo = {"GET": ("consultar_existencias", "ajustar_inventario")}
    lookup_field = "producto_id"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Existencia.objects.none()
        return existencias_del_negocio(self.contexto_negocio)

    def get_object(self):
        if self.request.query_params:
            raise ValidationError({key: ["Parámetro no permitido."] for key in self.request.query_params})
        return super().get_object()

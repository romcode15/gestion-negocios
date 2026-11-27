from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination

from api.common.pagination import PaginacionPagina
from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from ventas.models import VinculoMovimientoVenta

from .selectors import movimientos_de_venta
from .serializers import FiltrosTrazabilidadSerializer, MovimientoVentaSerializer


class PaginacionTrazabilidad(PaginacionPagina):
    def paginate_queryset(self, queryset, request, view=None):
        return PageNumberPagination.paginate_queryset(self, queryset, request, view)


class TrazabilidadVentaView(generics.ListAPIView):
    permission_classes = [TienePermisoNegocio]
    permisos_por_metodo = {
        "GET": ("registrar_venta", "listar_ventas", "anular_venta"),
    }
    serializer_class = MovimientoVentaSerializer
    pagination_class = PaginacionTrazabilidad
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return VinculoMovimientoVenta.objects.none()
        filtros = FiltrosTrazabilidadSerializer(
            data=self.request.query_params.dict(),
            query_params=self.request.query_params,
        )
        filtros.is_valid(raise_exception=True)
        return movimientos_de_venta(self.contexto_negocio, self.kwargs["venta_id"])

    @extend_schema(
        tags=["Ventas"],
        summary="Consultar movimientos vinculados a una venta",
        description=(
            "Requiere registrar_venta, listar_ventas o anular_venta. Devuelve las "
            "salidas y, si existe, las reposiciones de cada detalle en orden histórico."
        ),
        parameters=[OpenApiParameter("page", OpenApiTypes.INT)],
        responses={
            200: MovimientoVentaSerializer(many=True),
            400: ErrorSerializer,
            403: ErrorSerializer,
            404: ErrorSerializer,
        },
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

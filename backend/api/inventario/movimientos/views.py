from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema

from api.common.access import exigir_usuario_activo, resolver_contexto_negocio
from api.common.schema import ErrorSerializer
from api.common.pagination import PaginacionPagina
from inventario.models import MovimientoInventario

from .selectors import movimientos_del_negocio
from .serializers import (
    FiltrosMovimientoSerializer,
    MovimientoSerializer,
    RegistrarAjusteSerializer,
    RegistrarMovimientoSerializer,
)


_PERMISOS = {
    "entrada": "registrar_entrada",
    "salida": "registrar_salida",
}


class PaginacionMovimientos(PaginacionPagina):
    def paginate_queryset(self, queryset, request, view=None):
        return PageNumberPagination.paginate_queryset(self, queryset, request, view)


class TienePermisoMovimiento(BasePermission):
    """Resuelve el permiso de escritura después de conocer el tipo solicitado."""

    def has_permission(self, request, view):
        exigir_usuario_activo(request.user)
        if request.method == "GET":
            view.contexto_negocio = resolver_contexto_negocio(
                request.user, view.kwargs["negocio_id"], "listar_movimientos",
            )
            return True
        tipo = request.data.get("tipo") if isinstance(request.data, dict) else None
        permiso = _PERMISOS.get(tipo)
        view.contexto_negocio = resolver_contexto_negocio(
            request.user, view.kwargs["negocio_id"], permiso,
        )
        return True


class RegistrarMovimientoView(generics.ListCreateAPIView):
    permission_classes = [TienePermisoMovimiento]
    serializer_class = RegistrarMovimientoSerializer
    pagination_class = PaginacionMovimientos
    http_method_names = ["get", "post", "head", "options"]

    def get_serializer_class(self):
        return MovimientoSerializer if self.request.method in ("GET", "HEAD") else RegistrarMovimientoSerializer

    def filtros(self):
        serializer = FiltrosMovimientoSerializer(
            data=self.request.query_params.dict(), query_params=self.request.query_params,
        )
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return MovimientoInventario.objects.none()
        return movimientos_del_negocio(self.contexto_negocio, **self.filtros())

    def get_serializer_context(self):
        contexto = super().get_serializer_context()
        contexto["contexto_negocio"] = self.contexto_negocio
        return contexto

    @extend_schema(
        tags=["Movimientos"],
        summary="Consultar historial de movimientos",
        description=(
            "Requiere listar_movimientos. Filtra por producto, tipo, texto y rango "
            "temporal; devuelve el historial inmutable del negocio en orden descendente."
        ),
        parameters=[
            OpenApiParameter("producto_id", OpenApiTypes.INT),
            OpenApiParameter("tipo", OpenApiTypes.STR, enum=["entrada", "salida", "ajuste"]),
            OpenApiParameter("search", OpenApiTypes.STR),
            OpenApiParameter("desde", OpenApiTypes.DATETIME),
            OpenApiParameter("hasta", OpenApiTypes.DATETIME),
            OpenApiParameter("page", OpenApiTypes.INT),
        ],
        responses={200: MovimientoSerializer(many=True), 400: ErrorSerializer, 403: ErrorSerializer},
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    @extend_schema(
        tags=["Movimientos"],
        summary="Registrar una entrada o salida",
        description=(
            "Requiere sesión, CSRF y registrar_entrada para entradas o registrar_salida "
            "para salidas. La cantidad se envía positiva y el saldo se modifica únicamente "
            "mediante el servicio transaccional común."
        ),
        request=RegistrarMovimientoSerializer,
        responses={201: MovimientoSerializer, 400: ErrorSerializer, 403: ErrorSerializer,
                   409: ErrorSerializer},
    )
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        movimiento = serializer.save()
        return Response(MovimientoSerializer(movimiento, context=self.get_serializer_context()).data, status=201)


class TienePermisoAjuste(BasePermission):
    def has_permission(self, request, view):
        exigir_usuario_activo(request.user)
        view.contexto_negocio = resolver_contexto_negocio(
            request.user, view.kwargs["negocio_id"], "ajustar_inventario",
        )
        return True


class RegistrarAjusteView(generics.CreateAPIView):
    permission_classes = [TienePermisoAjuste]
    serializer_class = RegistrarAjusteSerializer
    http_method_names = ["post", "options"]

    def get_serializer_context(self):
        contexto = super().get_serializer_context()
        contexto["contexto_negocio"] = self.contexto_negocio
        return contexto

    @extend_schema(
        tags=["Movimientos"],
        summary="Fijar el stock mediante un ajuste",
        description=(
            "Requiere sesión, CSRF y ajustar_inventario. Recibe el stock objetivo "
            "y la versión leída; el servicio transaccional común valida el saldo "
            "y evita sobrescribir una versión desactualizada."
        ),
        request=RegistrarAjusteSerializer,
        responses={201: MovimientoSerializer, 400: ErrorSerializer, 403: ErrorSerializer,
                   409: ErrorSerializer},
    )
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        movimiento = serializer.save()
        return Response(MovimientoSerializer(movimiento, context=self.get_serializer_context()).data, status=201)

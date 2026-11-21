from rest_framework import generics
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

from api.common.access import exigir_usuario_activo, resolver_contexto_negocio
from api.common.schema import ErrorSerializer

from .serializers import MovimientoSerializer, RegistrarMovimientoSerializer


_PERMISOS = {
    "entrada": "registrar_entrada",
    "salida": "registrar_salida",
}


class TienePermisoMovimiento(BasePermission):
    """Resuelve el permiso de escritura después de conocer el tipo solicitado."""

    def has_permission(self, request, view):
        exigir_usuario_activo(request.user)
        tipo = request.data.get("tipo") if isinstance(request.data, dict) else None
        permiso = _PERMISOS.get(tipo)
        view.contexto_negocio = resolver_contexto_negocio(
            request.user, view.kwargs["negocio_id"], permiso,
        )
        return True


class RegistrarMovimientoView(generics.CreateAPIView):
    permission_classes = [TienePermisoMovimiento]
    serializer_class = RegistrarMovimientoSerializer
    http_method_names = ["post", "options"]

    def get_serializer_context(self):
        contexto = super().get_serializer_context()
        contexto["contexto_negocio"] = self.contexto_negocio
        return contexto

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

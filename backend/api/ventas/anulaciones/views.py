from drf_spectacular.utils import extend_schema
from rest_framework import generics
from rest_framework.response import Response

from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from api.ventas.serializers import VentaDetalleSerializer
from ventas.models import Venta

from .serializers import AnularVentaSerializer


class AnularVentaView(generics.CreateAPIView):
    permission_classes = [TienePermisoNegocio]
    permiso_requerido = "anular_venta"
    serializer_class = AnularVentaSerializer
    http_method_names = ["post", "options"]

    def get_serializer_context(self):
        contexto = super().get_serializer_context()
        contexto["contexto_negocio"] = self.contexto_negocio
        contexto["venta_id"] = self.kwargs["venta_id"]
        return contexto

    def get_queryset(self):
        return Venta.objects.filter(negocio_id=self.contexto_negocio.negocio.pk)

    @extend_schema(
        tags=["Ventas"],
        summary="Anular una venta y reponer existencias",
        description=(
            "Requiere anular_venta y CSRF. La anulación es total, crea una entrada "
            "compensatoria por detalle y conserva la venta y sus salidas originales."
        ),
        request=AnularVentaSerializer,
        responses={
            200: VentaDetalleSerializer,
            400: ErrorSerializer,
            403: ErrorSerializer,
            404: ErrorSerializer,
            409: ErrorSerializer,
        },
    )
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        venta = serializer.save()
        return Response(serializer.to_representation(venta), status=200)

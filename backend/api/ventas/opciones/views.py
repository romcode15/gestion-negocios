from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema, extend_schema_view
from rest_framework import generics
from rest_framework.exceptions import ValidationError

from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from catalogo.models import Producto

from .selectors import opciones_para_vender
from .serializers import FiltrosOpcionesVentaSerializer, VentaProductoOpcionSerializer

TAG = "Ventas"
ERRORES = {400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer}


class OpcionesVentaMixin:
    permission_classes = [TienePermisoNegocio]
    # Solo lectura: POST/PUT/PATCH/DELETE responden 405 con el envoltorio común.
    http_method_names = ["get", "head", "options"]
    permiso_requerido = "registrar_venta"
    serializer_class = VentaProductoOpcionSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Producto.objects.none()
        return opciones_para_vender(self.contexto_negocio)


@extend_schema_view(get=extend_schema(
    tags=[TAG], summary="Opciones de productos para vender",
    description=(
        "Requiere registrar_venta; no exige listar_productos, consultar_existencias ni listar_ventas. "
        "Solo productos y categorías activos del negocio, incluidos los de saldo cero. "
        "`disponible` es informativo y no reserva stock. Orden por id ascendente."
    ),
    parameters=[OpenApiParameter("search", OpenApiTypes.STR, description="Texto parcial de nombre o SKU; máximo 150.")],
    responses={200: VentaProductoOpcionSerializer(many=True), **ERRORES},
))
class OpcionesVentaView(OpcionesVentaMixin, generics.ListAPIView):
    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Producto.objects.none()
        filtros = FiltrosOpcionesVentaSerializer(
            data=self.request.query_params.dict(), query_params=self.request.query_params,
        )
        filtros.is_valid(raise_exception=True)
        return opciones_para_vender(self.contexto_negocio, **filtros.validated_data)


@extend_schema_view(get=extend_schema(
    tags=[TAG], summary="Producto para vender",
    description=(
        "Requiere registrar_venta. 404 si el producto o su categoría están inactivos, "
        "si no existe o si pertenece a otro negocio."
    ),
    responses={200: VentaProductoOpcionSerializer, **ERRORES},
))
class OpcionVentaDetalleView(OpcionesVentaMixin, generics.RetrieveAPIView):
    lookup_url_kwarg = "producto_id"

    def get_object(self):
        # El detalle no declara parámetros de consulta.
        if self.request.query_params:
            raise ValidationError({clave: ["Parámetro no permitido."] for clave in self.request.query_params})
        return super().get_object()

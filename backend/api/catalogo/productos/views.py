from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema, extend_schema_view
from rest_framework import generics
from rest_framework.exceptions import ValidationError

from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from catalogo.models import Producto

from .selectors import opciones_de_producto, productos_del_negocio
from .serializers import (
    ActualizarProductoSerializer,
    CrearProductoSerializer,
    FiltrosProductosSerializer,
    ProductoOpcionSerializer,
    ProductoSerializer,
)
from api.catalogo.categorias.serializers import FiltrosSerializer

TAG = "Productos"
SEARCH = OpenApiParameter("search", OpenApiTypes.STR, description="Texto parcial de nombre o SKU; máximo 150.")
CATEGORIA = OpenApiParameter("categoria_id", OpenApiTypes.INT, description="Categoría del negocio activo.")
ACTIVO = OpenApiParameter(
    "activo", OpenApiTypes.STR, enum=["true", "false"], description="Omitido incluye ambos estados.",
)
ERRORES_LISTA = {400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer}


class ContextoProductosMixin:
    permission_classes = [TienePermisoNegocio]

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["contexto_negocio"] = getattr(self, "contexto_negocio", None)
        return context

    def filtros(self, serializer_class):
        serializer = serializer_class(
            data=self.request.query_params.dict(), query_params=self.request.query_params,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


@extend_schema_view(
    get=extend_schema(
        tags=[TAG], summary="Listar productos",
        description="Requiere listar_productos. Incluye categoria_nombre; orden por id ascendente.",
        parameters=[SEARCH, CATEGORIA, ACTIVO],
        responses={200: ProductoSerializer(many=True), **ERRORES_LISTA},
    ),
    post=extend_schema(
        tags=[TAG], summary="Crear producto",
        description=(
            "Requiere crear_producto y CSRF; no exige listar_productos. Crea el producto activo y su "
            "existencia en cero en una transacción. Precios y mínimos son cadenas decimales."
        ),
        request=CrearProductoSerializer,
        responses={201: ProductoSerializer, 400: ErrorSerializer, 403: ErrorSerializer},
    ),
)
class ProductosView(ContextoProductosMixin, generics.ListCreateAPIView):
    permisos_por_metodo = {"GET": "listar_productos", "POST": "crear_producto"}

    def get_serializer_class(self):
        return CrearProductoSerializer if self.request.method == "POST" else ProductoSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Producto.objects.none()
        return productos_del_negocio(self.contexto_negocio, **self.filtros(FiltrosProductosSerializer))


@extend_schema_view(
    get=extend_schema(
        tags=[TAG], summary="Opciones de producto para movimientos",
        description=(
            "Requiere registrar_entrada, registrar_salida o ajustar_inventario; no exige listar_productos. "
            "Devuelve solo productos activos del negocio."
        ),
        parameters=[SEARCH],
        responses={200: ProductoOpcionSerializer(many=True), **ERRORES_LISTA},
    ),
)
class ProductoOpcionesView(ContextoProductosMixin, generics.ListAPIView):
    permisos_por_metodo = {"GET": ("registrar_entrada", "registrar_salida", "ajustar_inventario")}
    serializer_class = ProductoOpcionSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Producto.objects.none()
        return opciones_de_producto(self.contexto_negocio, **self.filtros(FiltrosSerializer))


@extend_schema_view(
    get=extend_schema(
        tags=[TAG], summary="Detalle de producto",
        description="Requiere listar_productos o editar_producto. 404 si no pertenece al negocio.",
        responses={200: ProductoSerializer, 400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer},
    ),
    patch=extend_schema(
        tags=[TAG], summary="Editar o desactivar producto",
        description=(
            "Requiere editar_producto y CSRF. Al menos un campo editable; nunca cambia el saldo. "
            "La unidad no cambia después del primer movimiento; mover o reactivar exige categoría activa."
        ),
        request=ActualizarProductoSerializer,
        responses={200: ProductoSerializer, 400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer},
    ),
)
class ProductoDetalleView(ContextoProductosMixin, generics.RetrieveUpdateAPIView):
    # Sin PUT ni DELETE: responden 405 con el envoltorio común.
    http_method_names = ["get", "patch", "head", "options"]
    permisos_por_metodo = {"GET": ("listar_productos", "editar_producto"), "PATCH": "editar_producto"}
    lookup_url_kwarg = "producto_id"

    def get_serializer_class(self):
        return ActualizarProductoSerializer if self.request.method == "PATCH" else ProductoSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Producto.objects.none()
        return Producto.objects.filter(negocio_id=self.contexto_negocio.negocio.pk).select_related("categoria")

    def get_object(self):
        # El detalle no declara parámetros de consulta.
        if self.request.query_params:
            raise ValidationError({clave: ["Parámetro no permitido."] for clave in self.request.query_params})
        return super().get_object()

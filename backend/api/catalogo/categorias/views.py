from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema, extend_schema_view
from rest_framework import generics

from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from catalogo.models import Categoria

from .selectors import categorias_del_negocio, opciones_de_categoria
from .serializers import (
    ActualizarCategoriaSerializer,
    CategoriaOpcionSerializer,
    CategoriaSerializer,
    CrearCategoriaSerializer,
    FiltrosCategoriasSerializer,
    FiltrosSerializer,
)

TAG = "Categorías"
SEARCH = OpenApiParameter("search", OpenApiTypes.STR, description="Texto parcial del nombre; máximo 150.")
ACTIVO = OpenApiParameter(
    "activo", OpenApiTypes.STR, enum=["true", "false"], description="Omitido incluye ambos estados.",
)
ERRORES_LISTA = {400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer}


class ContextoCategoriasMixin:
    permission_classes = [TienePermisoNegocio]

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["contexto_negocio"] = getattr(self, "contexto_negocio", None)
        return context

    def filtros(self, serializer_class):
        serializer = serializer_class(
            data=self.request.query_params.dict(), query_params=self.request.query_params,
        )
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


@extend_schema_view(
    get=extend_schema(
        tags=[TAG], summary="Listar categorías",
        description="Requiere listar_categorias. Orden por id ascendente.",
        parameters=[SEARCH, ACTIVO],
        responses={200: CategoriaSerializer(many=True), **ERRORES_LISTA},
    ),
    post=extend_schema(
        tags=[TAG], summary="Crear categoría",
        description="Requiere crear_categoria y CSRF. No exige listar_categorias. La categoría nace activa.",
        request=CrearCategoriaSerializer,
        responses={201: CategoriaSerializer, 400: ErrorSerializer, 403: ErrorSerializer},
    ),
)
class CategoriasView(ContextoCategoriasMixin, generics.ListCreateAPIView):
    permisos_por_metodo = {"GET": "listar_categorias", "POST": "crear_categoria"}

    def get_serializer_class(self):
        return CrearCategoriaSerializer if self.request.method == "POST" else CategoriaSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Categoria.objects.none()
        return categorias_del_negocio(self.contexto_negocio, **self.filtros(FiltrosCategoriasSerializer))


@extend_schema_view(
    get=extend_schema(
        tags=[TAG], summary="Opciones de categoría para productos",
        description=(
            "Requiere crear_producto o editar_producto; no exige listar_categorias. "
            "Devuelve solo categorías activas del negocio."
        ),
        parameters=[SEARCH],
        responses={200: CategoriaOpcionSerializer(many=True), **ERRORES_LISTA},
    ),
)
class CategoriaOpcionesView(ContextoCategoriasMixin, generics.ListAPIView):
    permisos_por_metodo = {"GET": ("crear_producto", "editar_producto")}
    serializer_class = CategoriaOpcionSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Categoria.objects.none()
        return opciones_de_categoria(self.contexto_negocio, **self.filtros(FiltrosSerializer))


@extend_schema_view(
    get=extend_schema(
        tags=[TAG], summary="Detalle de categoría",
        description="Requiere listar_categorias o editar_categoria. 404 si no pertenece al negocio.",
        responses={200: CategoriaSerializer, 403: ErrorSerializer, 404: ErrorSerializer},
    ),
    patch=extend_schema(
        tags=[TAG], summary="Editar o desactivar categoría",
        description=(
            "Requiere editar_categoria y CSRF. Al menos un campo. No se puede desactivar "
            "mientras tenga productos activos."
        ),
        request=ActualizarCategoriaSerializer,
        responses={200: CategoriaSerializer, 400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer},
    ),
)
class CategoriaDetalleView(ContextoCategoriasMixin, generics.RetrieveUpdateAPIView):
    # Sin PUT ni DELETE: responden 405 con el envoltorio común.
    http_method_names = ["get", "patch", "head", "options"]
    permisos_por_metodo = {"GET": ("listar_categorias", "editar_categoria"), "PATCH": "editar_categoria"}
    lookup_url_kwarg = "categoria_id"

    def get_serializer_class(self):
        return ActualizarCategoriaSerializer if self.request.method == "PATCH" else CategoriaSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Categoria.objects.none()
        return Categoria.objects.filter(negocio_id=self.contexto_negocio.negocio.pk)

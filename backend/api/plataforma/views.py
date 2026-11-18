from django.contrib.auth import get_user_model
from rest_framework.generics import ListCreateAPIView
from drf_spectacular.utils import extend_schema, extend_schema_view

from api.common.permissions import TienePermisoGlobal
from api.common.serializers import UsuarioSerializer
from api.common.schema import ErrorSerializer
from negocios.models import Negocio

from .serializers import CrearNegocioSerializer, CrearUsuarioSerializer, NegocioSerializer


@extend_schema_view(
    get=extend_schema(tags=["Plataforma"], summary="Listar usuarios", description="Requiere listar_usuarios.",
                      responses={200: UsuarioSerializer(many=True), 403: ErrorSerializer, 404: ErrorSerializer}),
    post=extend_schema(tags=["Plataforma"], summary="Crear cuenta", description="Requiere crear_usuario y CSRF.",
                       request=CrearUsuarioSerializer,
                       responses={201: UsuarioSerializer, 400: ErrorSerializer, 403: ErrorSerializer}),
)
class UsuariosView(ListCreateAPIView):
    permission_classes = [TienePermisoGlobal]
    permisos_por_metodo = {"GET": "listar_usuarios", "POST": "crear_usuario"}
    queryset = get_user_model().objects.all()

    def get_serializer_class(self):
        return CrearUsuarioSerializer if self.request.method == "POST" else UsuarioSerializer


@extend_schema_view(
    get=extend_schema(tags=["Plataforma"], summary="Listar negocios", description="Requiere listar_negocios.",
                      responses={200: NegocioSerializer(many=True), 403: ErrorSerializer, 404: ErrorSerializer}),
    post=extend_schema(tags=["Plataforma"], summary="Crear negocio con administrador",
                       description="Requiere crear_negocio y CSRF. Crea negocio, rol y membresía en una transacción.",
                       request=CrearNegocioSerializer,
                       responses={201: NegocioSerializer, 400: ErrorSerializer, 403: ErrorSerializer}),
)
class NegociosView(ListCreateAPIView):
    permission_classes = [TienePermisoGlobal]
    permisos_por_metodo = {"GET": "listar_negocios", "POST": "crear_negocio"}
    queryset = Negocio.objects.all()

    def get_serializer_class(self):
        return CrearNegocioSerializer if self.request.method == "POST" else NegocioSerializer

from django.contrib.auth import get_user_model
from rest_framework.generics import ListCreateAPIView

from api.common.permissions import TienePermisoGlobal
from api.common.serializers import UsuarioSerializer
from negocios.models import Negocio

from .serializers import CrearNegocioSerializer, CrearUsuarioSerializer, NegocioSerializer


class UsuariosView(ListCreateAPIView):
    permission_classes = [TienePermisoGlobal]
    permisos_por_metodo = {"GET": "listar_usuarios", "POST": "crear_usuario"}
    queryset = get_user_model().objects.all()

    def get_serializer_class(self):
        return CrearUsuarioSerializer if self.request.method == "POST" else UsuarioSerializer


class NegociosView(ListCreateAPIView):
    permission_classes = [TienePermisoGlobal]
    permisos_por_metodo = {"GET": "listar_negocios", "POST": "crear_negocio"}
    queryset = Negocio.objects.all()

    def get_serializer_class(self):
        return CrearNegocioSerializer if self.request.method == "POST" else NegocioSerializer

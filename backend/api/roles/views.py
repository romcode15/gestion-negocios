from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework.generics import ListAPIView

from accesos.models import Permiso, Rol
from api.common.access import permisos_delegables
from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer

from .selectors import roles_del_negocio
from .serializers import PermisoSerializer, RolSerializer


@extend_schema_view(
    get=extend_schema(
        tags=["Roles"], summary="Listar permisos delegables",
        description=(
            "Requiere crear_rol. Devuelve solo permisos de ámbito negocio que el actor posee "
            "en este negocio; nunca el catálogo completo ni permisos de plataforma."
        ),
        responses={200: PermisoSerializer(many=True), 403: ErrorSerializer, 404: ErrorSerializer},
    ),
)
class PermisosDelegablesView(ListAPIView):
    permission_classes = [TienePermisoNegocio]
    permisos_por_metodo = {"GET": "crear_rol"}
    serializer_class = PermisoSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Permiso.objects.none()
        return permisos_delegables(self.contexto_negocio)


@extend_schema_view(
    get=extend_schema(
        tags=["Roles"], summary="Listar roles del negocio",
        description=(
            "Requiere listar_roles. Incluye el Administrador de negocio predefinido; "
            "excluye roles globales y de otros negocios."
        ),
        responses={200: RolSerializer(many=True), 403: ErrorSerializer, 404: ErrorSerializer},
    ),
)
class RolesView(ListAPIView):
    permission_classes = [TienePermisoNegocio]
    permisos_por_metodo = {"GET": "listar_roles"}
    serializer_class = RolSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Rol.objects.none()
        return roles_del_negocio(self.contexto_negocio)

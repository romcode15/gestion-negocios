from rest_framework import generics
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, extend_schema_view

from accesos.models import Membresia
from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from api.membresias.serializers import (
    CambiarRolSerializer,
    CrearMembresiaSerializer,
    MembresiaSerializer,
)


@extend_schema_view(
    get=extend_schema(
        tags=["membresías"], summary="Listar membresías del negocio",
        description="Requiere listar_membresias en el negocio activo.",
        responses={200: MembresiaSerializer(many=True), 403: ErrorSerializer, 404: ErrorSerializer},
    ),
    post=extend_schema(
        tags=["membresías"], summary="Incorporar miembro al negocio",
        description=(
            "Requiere crear_membresia y CSRF. Con password crea una cuenta nueva; "
            "sin password incorpora una cuenta activa existente. El rol debe ser delegable."
        ),
        request=CrearMembresiaSerializer,
        responses={201: MembresiaSerializer, 400: ErrorSerializer, 403: ErrorSerializer},
    ),
)
class MembresiasView(generics.ListCreateAPIView):
    permission_classes = [TienePermisoNegocio]
    permisos_por_metodo = {
        "GET": "listar_membresias",
        "POST": "crear_membresia",
    }

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Membresia.objects.none()
        negocio = self.contexto_negocio.negocio

        return (
            Membresia.objects
            .filter(negocio_id=negocio.pk)
            .select_related("usuario")
            .order_by("id")
        )

    def get_serializer_class(self):
        if self.request.method == "POST":
            return CrearMembresiaSerializer
        return MembresiaSerializer

    def get_serializer_context(self):
        contexto = super().get_serializer_context()
        contexto["contexto_negocio"] = getattr(self, "contexto_negocio", None)
        return contexto


class CambioRolMembresiaView(generics.GenericAPIView):
    permission_classes = [TienePermisoNegocio]
    permiso_requerido = "asignar_rol"
    serializer_class = CambiarRolSerializer
    lookup_url_kwarg = "membresia_id"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Membresia.objects.none()
        return Membresia.objects.filter(
            negocio_id=self.contexto_negocio.negocio.pk,
        ).select_related("usuario", "rol")

    def get_serializer_context(self):
        contexto = super().get_serializer_context()
        contexto["contexto_negocio"] = getattr(self, "contexto_negocio", None)
        return contexto

    @extend_schema(
        summary="Cambiar el rol de una membresía",
        description="Requiere sesión, CSRF y el permiso asignar_rol en el negocio activo.",
        request=CambiarRolSerializer,
        responses={200: MembresiaSerializer, 400: ErrorSerializer, 403: ErrorSerializer, 404: ErrorSerializer},
        tags=["membresías"],
    )
    def patch(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object(), data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

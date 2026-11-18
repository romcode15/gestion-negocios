from rest_framework import generics
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

from accesos.models import Membresia
from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from api.membresias.serializers import (
    CambiarRolSerializer,
    CrearMembresiaSerializer,
    MembresiaSerializer,
)


class MembresiasView(generics.ListCreateAPIView):
    permission_classes = [TienePermisoNegocio]
    permisos_por_metodo = {
        "GET": "listar_membresias",
        "POST": "crear_membresia",
    }

    def get_queryset(self):
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
        contexto["contexto_negocio"] = self.contexto_negocio
        return contexto


class CambioRolMembresiaView(generics.GenericAPIView):
    permission_classes = [TienePermisoNegocio]
    permiso_requerido = "asignar_rol"
    serializer_class = CambiarRolSerializer
    lookup_url_kwarg = "membresia_id"

    def get_queryset(self):
        return Membresia.objects.filter(
            negocio_id=self.contexto_negocio.negocio.pk,
        ).select_related("usuario", "rol")

    def get_serializer_context(self):
        contexto = super().get_serializer_context()
        contexto["contexto_negocio"] = self.contexto_negocio
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

from rest_framework import generics

from accesos.models import Membresia
from api.common.permissions import TienePermisoNegocio
from api.membresias.serializers import (
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
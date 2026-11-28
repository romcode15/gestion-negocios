from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.response import Response

from api.common.permissions import TienePermisoNegocio
from api.common.schema import ErrorSerializer
from api.ventas.consultas.mixins import ListadoVentasMixin
from api.ventas.serializers import VentaDetalleSerializer
from ventas.models import Venta

from .serializers import RegistrarVentaSerializer


class VentasView(ListadoVentasMixin, generics.GenericAPIView):
    """Colección `ventas/`: POST (B5) y GET de listado (B6, en ListadoVentasMixin).

    Mientras B6 no implemente get(), un GET responde 405 con el envoltorio común.
    PUT/PATCH/DELETE no existen en esta fase.
    """

    permission_classes = [TienePermisoNegocio]
    http_method_names = ["get", "head", "post", "options"]
    # El listado exige su propio permiso; registrar_venta nunca habilita el GET.
    permisos_por_metodo = {"GET": "listar_ventas", "POST": "registrar_venta"}
    serializer_class = RegistrarVentaSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Venta.objects.none()
        return Venta.objects.filter(negocio_id=self.contexto_negocio.negocio.pk)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["contexto_negocio"] = getattr(self, "contexto_negocio", None)
        return context

    @extend_schema(
        tags=["Ventas"], summary="Registrar venta de contado",
        description=(
            "Requiere registrar_venta y CSRF; no exige listar_ventas, listar_productos, consultar_existencias "
            "ni registrar_salida. Confirma toda la venta y sus salidas de inventario en una transacción. "
            "Precio, subtotales, total, vendedor y fecha los calcula Django. Repetir la misma clave, actor y "
            "contenido devuelve 201 con la misma venta sin nuevas escrituras; otra entrada o actor con la misma "
            "clave, o un precio esperado distinto del actual, responde 409. Errores por línea con claves planas "
            "como `detalles.0.cantidad`."
        ),
        request=RegistrarVentaSerializer,
        responses={201: VentaDetalleSerializer, 400: ErrorSerializer, 403: ErrorSerializer, 409: ErrorSerializer},
    )
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        venta = serializer.save()
        return Response(serializer.to_representation(venta), status=status.HTTP_201_CREATED)

"""Entrada estricta de POST ventas/.

El serializer valida la forma del objeto raíz y conserva los tipos JSON originales de
cada línea. La validación por línea (tipos, decimales exactos, repetidos, límites) y
toda la persistencia pertenecen al servicio B2, que devuelve errores planos con el
índice original (`detalles.0.cantidad`). Así no se duplica la lógica ni se pierde el
tipo JSON por una coerción previa a Decimal.
"""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import ValidationError as ApiValidationError

from api.catalogo.categorias.serializers import EntradaEstrictaSerializer, TextoField
from api.ventas.serializers import VentaDetalleSerializer
from ventas.services.common import normalizar_uuid
from ventas.services.confirmacion import confirmar_venta


class LineaVentaDocSerializer(serializers.Serializer):
    """Solo documentación OpenAPI de cada línea; la validación real está en B2."""

    producto_id = serializers.IntegerField(min_value=1, help_text="ID entero JSON del producto del negocio.")
    cantidad = serializers.CharField(help_text="Cadena decimal positiva, hasta 3 decimales; entera para `unidad`.")
    precio_unitario_esperado = serializers.CharField(
        help_text="Cadena decimal leída de las opciones de venta, hasta 2 decimales. Solo detecta cambios de precio.",
    )


@extend_schema_field(OpenApiTypes.UUID)
class ClaveOperacionField(serializers.Field):
    """UUID canónico en texto; reutiliza la normalización del servicio."""

    def to_internal_value(self, data):
        try:
            return normalizar_uuid(data)
        except ApiValidationError as error:
            raise serializers.ValidationError("Envía un UUID válido.") from error

    def to_representation(self, value):
        return str(value)


@extend_schema_field(LineaVentaDocSerializer(many=True))
class DetallesField(serializers.Field):
    """Exige una lista y entrega las líneas sin convertir para que B2 valide su tipo JSON."""

    def to_internal_value(self, data):
        if not isinstance(data, list):
            raise serializers.ValidationError("Envía una lista de 1 a 100 productos.")
        return data

    def to_representation(self, value):
        return value


class RegistrarVentaSerializer(EntradaEstrictaSerializer):
    clave_operacion = ClaveOperacionField(help_text="UUID de la operación; reutilízalo solo para reintentar el mismo envío.")
    observaciones = TextoField(max_length=500, required=False, allow_blank=True, default="")
    detalles = DetallesField()

    def create(self, validated_data):
        return confirmar_venta(self.context["contexto_negocio"], **validated_data)

    def to_representation(self, instance):
        return VentaDetalleSerializer(instance, context=self.context).data

from rest_framework import serializers

from api.catalogo.categorias.serializers import EntradaEstrictaSerializer, TextoField
from api.ventas.serializers import VentaDetalleSerializer
from ventas.services import anular_venta


class AnularVentaSerializer(EntradaEstrictaSerializer):
    clave_operacion = serializers.UUIDField()
    motivo = TextoField(max_length=255)

    def create(self, validated_data):
        return anular_venta(
            self.context["contexto_negocio"],
            self.context["venta_id"],
            **validated_data,
        )

    def to_representation(self, instance):
        return VentaDetalleSerializer(instance, context=self.context).data

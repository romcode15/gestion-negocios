import re
from collections.abc import Mapping
from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.common.serializers import UsuarioSerializer
from api.catalogo.categorias.serializers import TextoField
from inventario.models import MovimientoInventario

from api.inventario.services import registrar_movimiento


CAMPO_NO_PERMITIDO = "Campo no permitido."
_PATRON_DECIMAL = re.compile(r"-?[0-9]+(?:\.[0-9]+)?\Z")


class EntradaEstrictaSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            desconocidos = [campo for campo in data if campo not in self.fields]
            if desconocidos:
                raise serializers.ValidationError({campo: [CAMPO_NO_PERMITIDO] for campo in desconocidos})
        return super().to_internal_value(data)


@extend_schema_field(serializers.CharField)
class CantidadSerializerField(serializers.Field):
    default_error_messages = {
        "invalid": "Envía una cadena decimal sin coma ni exponentes.",
        "precision": "La cantidad admite como máximo tres decimales.",
        "positive": "La cantidad debe ser positiva.",
    }

    def to_internal_value(self, data):
        if not isinstance(data, str) or not _PATRON_DECIMAL.fullmatch(data):
            self.fail("invalid")
        try:
            valor = Decimal(data)
        except Exception:
            self.fail("invalid")
        if not valor.is_finite() or -valor.as_tuple().exponent > 3:
            self.fail("precision")
        if valor <= 0:
            self.fail("positive")
        return valor

    def to_representation(self, value):
        return format(value, ".3f")


@extend_schema_field(serializers.CharField)
class StockObjetivoSerializerField(serializers.Field):
    default_error_messages = {
        "invalid": "Envía una cadena decimal sin coma ni exponentes.",
        "precision": "El stock objetivo admite como máximo tres decimales.",
        "negative": "El stock objetivo debe ser mayor o igual a cero.",
    }

    def to_internal_value(self, data):
        if not isinstance(data, str) or not _PATRON_DECIMAL.fullmatch(data):
            self.fail("invalid")
        try:
            valor = Decimal(data)
        except Exception:
            self.fail("invalid")
        if not valor.is_finite() or -valor.as_tuple().exponent > 3:
            self.fail("precision")
        if valor < 0:
            self.fail("negative")
        return valor

    def to_representation(self, value):
        return format(value, ".3f")


class ProductoOpcionSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    negocio_id = serializers.IntegerField(read_only=True)
    sku = serializers.CharField(read_only=True)
    nombre = serializers.CharField(read_only=True)
    unidad = serializers.CharField(read_only=True)


class MovimientoSerializer(serializers.ModelSerializer):
    producto = ProductoOpcionSerializer(read_only=True)
    usuario = UsuarioSerializer(read_only=True)
    cantidad = serializers.DecimalField(max_digits=14, decimal_places=3, coerce_to_string=True)
    saldo_anterior = serializers.DecimalField(max_digits=14, decimal_places=3, coerce_to_string=True)
    saldo_posterior = serializers.DecimalField(max_digits=14, decimal_places=3, coerce_to_string=True)

    class Meta:
        model = MovimientoInventario
        fields = [
            "id", "negocio_id", "producto", "usuario", "tipo", "cantidad",
            "saldo_anterior", "saldo_posterior", "motivo", "clave_operacion", "creado_en",
        ]
        read_only_fields = fields


class RegistrarMovimientoSerializer(EntradaEstrictaSerializer):
    producto_id = serializers.IntegerField(min_value=1)
    tipo = serializers.ChoiceField(choices=["entrada", "salida"])
    cantidad = CantidadSerializerField()
    motivo = TextoField(max_length=255)
    clave_operacion = serializers.UUIDField()

    def create(self, validated_data):
        return registrar_movimiento(
            self.context["contexto_negocio"],
            **validated_data,
        )

    def to_representation(self, instance):
        return MovimientoSerializer(instance, context=self.context).data


class RegistrarAjusteSerializer(EntradaEstrictaSerializer):
    producto_id = serializers.IntegerField(min_value=1)
    stock_objetivo = StockObjetivoSerializerField()
    version_esperada = serializers.IntegerField(min_value=0)
    motivo = TextoField(max_length=255)
    clave_operacion = serializers.UUIDField()

    def create(self, validated_data):
        return registrar_movimiento(
            self.context["contexto_negocio"], tipo="ajuste", **validated_data,
        )

    def to_representation(self, instance):
        return MovimientoSerializer(instance, context=self.context).data

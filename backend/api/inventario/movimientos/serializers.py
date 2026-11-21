import re
from collections.abc import Mapping
from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_aware
from catalogo.models import Producto

from api.common.serializers import ProductoOpcionSerializer, UsuarioSerializer
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


class EnteroJsonField(serializers.IntegerField):
    def to_internal_value(self, data):
        if type(data) is not int:
            raise serializers.ValidationError("Envía un entero JSON.")
        return super().to_internal_value(data)


class RegistrarMovimientoSerializer(EntradaEstrictaSerializer):
    producto_id = EnteroJsonField(min_value=1)
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
    producto_id = EnteroJsonField(min_value=1)
    stock_objetivo = StockObjetivoSerializerField()
    version_esperada = EnteroJsonField(min_value=0)
    motivo = TextoField(max_length=255)
    clave_operacion = serializers.UUIDField()

    def create(self, validated_data):
        return registrar_movimiento(
            self.context["contexto_negocio"], tipo="ajuste", **validated_data,
        )

    def to_representation(self, instance):
        return MovimientoSerializer(instance, context=self.context).data


class FechaConZonaField(serializers.DateTimeField):
    def to_internal_value(self, data):
        try:
            fecha = parse_datetime(data) if isinstance(data, str) and "T" in data.upper() else None
        except ValueError:
            fecha = None
        if fecha is None or not is_aware(fecha):
            raise serializers.ValidationError("Envía una fecha ISO 8601 con hora y zona horaria.")
        return super().to_internal_value(data)


class FiltrosMovimientoSerializer(serializers.Serializer):
    producto_id = serializers.RegexField(r"^[1-9][0-9]{0,15}$", required=False)
    tipo = serializers.ChoiceField(choices=["entrada", "salida", "ajuste"], required=False)
    search = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    desde = FechaConZonaField(required=False)
    hasta = FechaConZonaField(required=False)

    def __init__(self, *args, query_params=None, **kwargs):
        self.query_params = query_params
        super().__init__(*args, **kwargs)

    def to_internal_value(self, data):
        permitidos = set(self.fields) | {"page"}
        errores = {}
        for clave in self.query_params.keys():
            if clave not in permitidos:
                errores[clave] = ["Parámetro no permitido."]
            elif len(self.query_params.getlist(clave)) > 1:
                errores[clave] = ["Parámetro repetido."]
        if errores:
            raise serializers.ValidationError(errores)
        return super().to_internal_value(data)

    def validate(self, attrs):
        desde = attrs.get("desde")
        hasta = attrs.get("hasta")
        if desde is not None and hasta is not None and desde >= hasta:
            raise serializers.ValidationError({"hasta": ["Debe ser posterior a desde."]})
        if "search" in attrs:
            attrs["search"] = attrs["search"].strip()
        return attrs

    def validate_producto_id(self, value):
        negocio_id = self.context["contexto_negocio"].negocio.pk
        producto_id = int(value)
        if not Producto.objects.filter(pk=producto_id, negocio_id=negocio_id).exists():
            raise serializers.ValidationError("Producto no disponible en el negocio.")
        return producto_id

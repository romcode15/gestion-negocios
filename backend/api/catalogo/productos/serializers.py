import re
from decimal import Decimal

from rest_framework import serializers

from api.catalogo.categorias.serializers import (
    BooleanoField,
    EntradaEstrictaSerializer,
    FiltrosSerializer,
    TextoField,
)
from catalogo.models import PATRON_SKU, Categoria, Producto

from .services import actualizar_producto, crear_producto

_PATRON_DECIMAL = re.compile(r"-?[0-9]+(?:\.[0-9]+)?")
_PATRON_SKU = re.compile(PATRON_SKU)


class IdField(serializers.IntegerField):
    """ID entero JSON positivo; no acepta cadenas, booleanos ni decimales."""

    def __init__(self, **kwargs):
        kwargs.setdefault("min_value", 1)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        if type(data) is not int:
            raise serializers.ValidationError("Usa un ID entero positivo.")
        return super().to_internal_value(data)


class DecimalTextoField(serializers.CharField):
    """Cadena decimal exacta: sin números JSON, coma, exponentes ni redondeo silencioso."""

    def __init__(self, *, escala, precision, **kwargs):
        self.escala, self.precision = escala, precision
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str) or not _PATRON_DECIMAL.fullmatch(data):
            raise serializers.ValidationError("Usa una cadena decimal sin coma ni exponentes.")
        valor = Decimal(data)
        if -valor.as_tuple().exponent > self.escala:
            raise serializers.ValidationError("Se excedió la precisión decimal permitida.")
        if valor < 0:
            raise serializers.ValidationError("El valor no puede ser negativo.")
        cuantizado = valor.quantize(Decimal(1).scaleb(-self.escala))
        if cuantizado >= Decimal(10) ** (self.precision - self.escala):
            raise serializers.ValidationError("El valor está fuera de rango.")
        return cuantizado

    def to_representation(self, value):
        return f"{value:.{self.escala}f}"


class SkuField(TextoField):
    def __init__(self, **kwargs):
        super().__init__(max_length=50, **kwargs)

    def to_internal_value(self, data):
        sku = super().to_internal_value(data).upper()
        if not _PATRON_SKU.fullmatch(sku):
            raise serializers.ValidationError("Usa letras, números, punto, guion o guion bajo, iniciando con letra o número.")
        return sku


class UnidadField(serializers.ChoiceField):
    def __init__(self, **kwargs):
        super().__init__(choices=Producto.Unidad.choices, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str):
            raise serializers.ValidationError("Selecciona unidad, kg o litro.")
        return super().to_internal_value(data)


def _precio(**kwargs):
    return DecimalTextoField(escala=2, precision=12, help_text="Cadena decimal con hasta 2 decimales.", **kwargs)


def _minimo(**kwargs):
    return DecimalTextoField(escala=3, precision=14, help_text="Cadena decimal con hasta 3 decimales.", **kwargs)


class ProductoSerializer(serializers.ModelSerializer):
    negocio_id = serializers.IntegerField(read_only=True)
    categoria_id = serializers.IntegerField(read_only=True)
    categoria_nombre = serializers.CharField(source="categoria.nombre", read_only=True)
    precio_venta = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    stock_minimo = serializers.DecimalField(max_digits=14, decimal_places=3, read_only=True)

    class Meta:
        model = Producto
        fields = [
            "id", "negocio_id", "categoria_id", "categoria_nombre", "sku", "nombre", "descripcion",
            "unidad", "precio_venta", "stock_minimo", "activo",
        ]
        read_only_fields = fields


class ProductoOpcionSerializer(serializers.ModelSerializer):
    negocio_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Producto
        fields = ["id", "negocio_id", "sku", "nombre", "unidad"]
        read_only_fields = fields


class EntradaProductoSerializer(EntradaEstrictaSerializer):
    def validate(self, attrs):
        unidad = attrs.get("unidad", getattr(self.instance, "unidad", None))
        minimo = attrs.get("stock_minimo")
        if unidad == Producto.Unidad.UNIDAD and minimo is not None and minimo != minimo.to_integral_value():
            raise serializers.ValidationError({"stock_minimo": ["Esta unidad requiere cantidades enteras."]})
        return attrs

    def to_representation(self, instance):
        return ProductoSerializer(instance, context=self.context).data


class CrearProductoSerializer(EntradaProductoSerializer):
    categoria_id = IdField()
    sku = SkuField()
    nombre = TextoField(max_length=150)
    descripcion = TextoField(max_length=500, required=False, allow_blank=True, default="")
    unidad = UnidadField()
    precio_venta = _precio()
    stock_minimo = _minimo(required=False)

    def create(self, validated_data):
        return crear_producto(self.context["contexto_negocio"], **validated_data)


class ActualizarProductoSerializer(EntradaProductoSerializer):
    categoria_id = IdField(required=False)
    sku = SkuField(required=False)
    nombre = TextoField(max_length=150, required=False)
    descripcion = TextoField(max_length=500, required=False, allow_blank=True)
    unidad = UnidadField(required=False)
    precio_venta = _precio(required=False)
    stock_minimo = _minimo(required=False)
    activo = BooleanoField(required=False)

    def update(self, instance, validated_data):
        return actualizar_producto(self.context["contexto_negocio"], instance.pk, validated_data)


class FiltrosProductosSerializer(FiltrosSerializer):
    categoria_id = serializers.RegexField(
        r"^[1-9][0-9]{0,15}$", required=False, error_messages={"invalid": "Usa un ID positivo."},
    )
    activo = serializers.ChoiceField(
        choices=["true", "false"], required=False, error_messages={"invalid_choice": "Usa true o false."},
    )

    def validate_activo(self, valor):
        return valor == "true"

    def validate_categoria_id(self, valor):
        contexto = self.context["contexto_negocio"]
        categoria_id = int(valor)
        # Una categoría ajena o inexistente se rechaza en el filtro sin revelar si existe.
        if not Categoria.objects.filter(negocio_id=contexto.negocio.pk, pk=categoria_id).exists():
            raise serializers.ValidationError("Categoría no disponible.")
        return categoria_id

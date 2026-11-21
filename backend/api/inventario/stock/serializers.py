from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.catalogo.productos.serializers import FiltrosProductosSerializer
from catalogo.models import Producto
from inventario.models import Existencia


class ProductoResumenSerializer(serializers.ModelSerializer):
    negocio_id = serializers.IntegerField(read_only=True)
    categoria_id = serializers.IntegerField(read_only=True)
    categoria_nombre = serializers.CharField(source="categoria.nombre", read_only=True)

    class Meta:
        model = Producto
        fields = ["id", "negocio_id", "sku", "nombre", "unidad", "activo", "categoria_id", "categoria_nombre"]
        read_only_fields = fields


class ExistenciaSerializer(serializers.ModelSerializer):
    negocio_id = serializers.IntegerField(read_only=True)
    producto = ProductoResumenSerializer(read_only=True)
    cantidad = serializers.DecimalField(max_digits=14, decimal_places=3, read_only=True)
    stock_minimo = serializers.DecimalField(source="producto.stock_minimo", max_digits=14, decimal_places=3, read_only=True)
    bajo_minimo = serializers.SerializerMethodField()

    class Meta:
        model = Existencia
        fields = ["id", "negocio_id", "producto", "cantidad", "stock_minimo", "bajo_minimo", "version"]
        read_only_fields = fields

    @extend_schema_field(serializers.BooleanField)
    def get_bajo_minimo(self, obj):
        return obj.cantidad < obj.producto.stock_minimo


class FiltrosExistenciasSerializer(FiltrosProductosSerializer):
    bajo_minimo = serializers.ChoiceField(choices=["true", "false"], required=False)

    def validate_bajo_minimo(self, value):
        return value == "true"

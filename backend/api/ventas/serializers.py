"""Salidas compartidas del contrato. B1 no publica todavía endpoints de ventas."""
from rest_framework import serializers

from api.common.serializers import UsuarioSerializer
from api.inventario.movimientos.serializers import MovimientoSerializer
from ventas.models import AnulacionVenta, DetalleVenta, Venta, VinculoMovimientoVenta


class VentaProductoOpcionSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    negocio_id = serializers.IntegerField(read_only=True)
    sku = serializers.CharField(read_only=True)
    nombre = serializers.CharField(read_only=True)
    unidad = serializers.CharField(read_only=True)
    precio_venta = serializers.DecimalField(max_digits=12, decimal_places=2, coerce_to_string=True, read_only=True)
    disponible = serializers.DecimalField(max_digits=14, decimal_places=3, coerce_to_string=True, read_only=True)


class DetalleVentaSerializer(serializers.ModelSerializer):
    cantidad = serializers.DecimalField(max_digits=14, decimal_places=3, coerce_to_string=True, read_only=True)
    precio_unitario = serializers.DecimalField(max_digits=12, decimal_places=2, coerce_to_string=True, read_only=True)
    subtotal = serializers.DecimalField(max_digits=14, decimal_places=2, coerce_to_string=True, read_only=True)

    class Meta:
        model = DetalleVenta
        fields = ["id", "producto_id", "sku", "nombre", "unidad", "cantidad", "precio_unitario", "subtotal"]
        read_only_fields = fields


class AnulacionVentaSerializer(serializers.ModelSerializer):
    usuario = UsuarioSerializer(read_only=True)

    class Meta:
        model = AnulacionVenta
        fields = ["id", "usuario", "motivo", "clave_operacion", "creado_en"]
        read_only_fields = fields


class VentaResumenSerializer(serializers.ModelSerializer):
    vendedor = UsuarioSerializer(read_only=True)
    total = serializers.DecimalField(max_digits=14, decimal_places=2, coerce_to_string=True, read_only=True)

    class Meta:
        model = Venta
        fields = ["id", "negocio_id", "estado", "total", "vendedor", "creado_en"]
        read_only_fields = fields


class VentaDetalleSerializer(VentaResumenSerializer):
    detalles = DetalleVentaSerializer(many=True, read_only=True)
    anulacion = AnulacionVentaSerializer(read_only=True, allow_null=True)

    class Meta(VentaResumenSerializer.Meta):
        fields = VentaResumenSerializer.Meta.fields + ["clave_operacion", "observaciones", "detalles", "anulacion"]
        read_only_fields = fields


class MovimientoVentaSerializer(serializers.ModelSerializer):
    movimiento = MovimientoSerializer(read_only=True)

    class Meta:
        model = VinculoMovimientoVenta
        fields = ["detalle_id", "operacion", "movimiento"]
        read_only_fields = fields

from django.contrib.auth import get_user_model
from rest_framework import serializers


class UsuarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ["id", "username", "is_active"]
        read_only_fields = fields


class ProductoOpcionSerializer(serializers.Serializer):
    """Resumen público compartido por catálogo y movimientos de inventario."""
    id = serializers.IntegerField(read_only=True)
    negocio_id = serializers.IntegerField(read_only=True)
    sku = serializers.CharField(read_only=True)
    nombre = serializers.CharField(read_only=True)
    unidad = serializers.CharField(read_only=True)

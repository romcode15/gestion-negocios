from django.contrib.auth import get_user_model
from rest_framework import serializers

from api.common.serializers import UsuarioSerializer
from negocios.models import Negocio

from .services import crear_negocio, crear_usuario


class CrearUsuarioSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def create(self, validated_data):
        return crear_usuario(**validated_data)

    def to_representation(self, instance):
        return UsuarioSerializer(instance, context=self.context).data


class NegocioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Negocio
        fields = ["id", "nombre", "tipo", "activo"]
        read_only_fields = fields


class CrearNegocioSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=150)
    tipo = serializers.CharField(max_length=100)
    administrador_id = serializers.IntegerField(min_value=1)

    def validate_administrador_id(self, value):
        if not get_user_model().objects.filter(pk=value, is_active=True).exists():
            raise serializers.ValidationError("Selecciona una cuenta activa existente.")
        return value

    def create(self, validated_data):
        return crear_negocio(**validated_data)

    def to_representation(self, instance):
        return NegocioSerializer(instance, context=self.context).data

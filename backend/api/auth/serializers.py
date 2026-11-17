from rest_framework import serializers

from api.common.serializers import UsuarioSerializer


class VacioSerializer(serializers.Serializer):
    pass


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class NegocioSesionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    nombre = serializers.CharField()
    rol_id = serializers.IntegerField()
    permisos = serializers.ListField(child=serializers.CharField())


class SesionSerializer(serializers.Serializer):
    usuario = UsuarioSerializer()
    permisos_globales = serializers.ListField(child=serializers.CharField())
    negocios = NegocioSesionSerializer(many=True)

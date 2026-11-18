"""Representaciones de documentación; no sustituyen validadores ni permisos."""

from drf_spectacular.authentication import SessionScheme
from rest_framework import serializers


class AutenticacionSesionScheme(SessionScheme):
    target_class = "api.common.authentication.AutenticacionSesion"
    priority = 1


class ErrorSerializer(serializers.Serializer):
    code = serializers.CharField()
    detail = serializers.CharField()
    errors = serializers.DictField(child=serializers.ListField(child=serializers.CharField()))

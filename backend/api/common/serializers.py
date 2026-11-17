from django.contrib.auth import get_user_model
from rest_framework import serializers


class UsuarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ["id", "username", "is_active"]
        read_only_fields = fields

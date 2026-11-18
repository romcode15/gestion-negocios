from rest_framework import serializers


from accesos.models import Membresia
from api.common.serializers import UsuarioSerializer
from api.membresias.services import crear_membresia


class MembresiaSerializer(serializers.ModelSerializer):
    usuario = UsuarioSerializer(read_only=True)
    negocio_id = serializers.IntegerField(read_only=True)
    rol_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Membresia
        fields = [
            "id",
            "usuario",
            "negocio_id",
            "rol_id",
            "activo",
        ]
        read_only_fields = fields


class CrearMembresiaSerializer(serializers.Serializer):
    username = serializers.CharField(
        max_length=150,
        trim_whitespace=False,
    )
    password = serializers.CharField(
        required=False,
        write_only=True,
        trim_whitespace=False,
    )
    rol_id = serializers.IntegerField(min_value=1)

    def create(self, validated_data):
        return crear_membresia(
            contexto=self.context["contexto_negocio"],
            **validated_data,
        )

    def to_representation(self, instance):
        return MembresiaSerializer(
            instance,
            context=self.context,
        ).data
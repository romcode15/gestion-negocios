from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from accesos.models import Permiso, Rol
from api.common.access import validar_permisos_delegables

from .services import NOMBRE_EN_USO, crear_rol, nombre_en_uso


class PermisoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permiso
        fields = ["id", "codigo", "ambito"]
        read_only_fields = fields


class RolSerializer(serializers.ModelSerializer):
    negocio_id = serializers.IntegerField(read_only=True, allow_null=True)
    permiso_ids = serializers.SerializerMethodField()

    class Meta:
        model = Rol
        fields = ["id", "nombre", "negocio_id", "predefinido", "permiso_ids"]
        read_only_fields = fields

    @extend_schema_field(serializers.ListField(child=serializers.IntegerField()))
    def get_permiso_ids(self, rol):
        # Usa la precarga del selector; no consulta la base por cada rol.
        return sorted(asignado.permiso_id for asignado in rol.permisos_asignados.all())


class ListaIdsField(serializers.ListField):
    """Lista de IDs numéricos con el error en el propio campo, sin índices anidados."""

    def to_internal_value(self, data):
        try:
            return super().to_internal_value(data)
        except serializers.ValidationError as error:
            raise serializers.ValidationError("Envía una lista de IDs numéricos.") from error


class CrearRolSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=150)
    permiso_ids = ListaIdsField(
        child=serializers.IntegerField(min_value=1), allow_empty=True,
        help_text="IDs de permisos delegables, sin repetir. Una lista vacía crea un rol sin permisos.",
    )

    def validate(self, attrs):
        contexto = self.context["contexto_negocio"]
        # Repetidos, inexistentes, de plataforma o no delegables se rechazan en permiso_ids.
        validar_permisos_delegables(contexto, attrs["permiso_ids"])
        if nombre_en_uso(contexto.negocio.pk, attrs["nombre"]):
            raise serializers.ValidationError({"nombre": [NOMBRE_EN_USO]})
        return attrs

    def create(self, validated_data):
        return crear_rol(self.context["contexto_negocio"], **validated_data)

    def to_representation(self, instance):
        return RolSerializer(instance, context=self.context).data

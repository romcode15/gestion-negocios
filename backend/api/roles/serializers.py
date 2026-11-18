from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from accesos.models import Permiso, Rol


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
        return [asignado.permiso_id for asignado in rol.permisos_asignados.all()]

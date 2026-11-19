from collections.abc import Mapping

from rest_framework import serializers

from catalogo.models import Categoria

from .services import actualizar_categoria, crear_categoria

CAMPO_NO_PERMITIDO = "Campo no permitido."


class TextoField(serializers.CharField):
    """Solo acepta cadenas JSON; no convierte números ni booleanos en texto."""

    def to_internal_value(self, data):
        if not isinstance(data, str):
            raise serializers.ValidationError("Envía un texto.")
        return super().to_internal_value(data)


class BooleanoField(serializers.BooleanField):
    """Solo acepta true/false JSON, sin cadenas ni números equivalentes."""

    def to_internal_value(self, data):
        if not isinstance(data, bool):
            raise serializers.ValidationError("Envía un booleano.")
        return data


class EntradaEstrictaSerializer(serializers.Serializer):
    """Rechaza campos no declarados y, en PATCH, un cuerpo sin campos."""

    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            desconocidos = [campo for campo in data if campo not in self.fields]
            if desconocidos:
                raise serializers.ValidationError({campo: [CAMPO_NO_PERMITIDO] for campo in desconocidos})
            if self.partial and not data:
                raise serializers.ValidationError({"non_field_errors": ["Envía al menos un campo editable."]})
        return super().to_internal_value(data)


class CategoriaSerializer(serializers.ModelSerializer):
    negocio_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Categoria
        fields = ["id", "negocio_id", "nombre", "descripcion", "activo"]
        read_only_fields = fields


class CategoriaOpcionSerializer(serializers.ModelSerializer):
    negocio_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Categoria
        fields = ["id", "negocio_id", "nombre"]
        read_only_fields = fields


class CrearCategoriaSerializer(EntradaEstrictaSerializer):
    nombre = TextoField(max_length=150)
    descripcion = TextoField(max_length=500, required=False, allow_blank=True, default="")

    def create(self, validated_data):
        return crear_categoria(self.context["contexto_negocio"], **validated_data)

    def to_representation(self, instance):
        return CategoriaSerializer(instance, context=self.context).data


class ActualizarCategoriaSerializer(EntradaEstrictaSerializer):
    nombre = TextoField(max_length=150, required=False)
    descripcion = TextoField(max_length=500, required=False, allow_blank=True)
    activo = BooleanoField(required=False)

    def update(self, instance, validated_data):
        return actualizar_categoria(self.context["contexto_negocio"], instance.pk, validated_data)

    def to_representation(self, instance):
        return CategoriaSerializer(instance, context=self.context).data


class FiltrosSerializer(serializers.Serializer):
    """Valida los parámetros de consulta: solo los declarados y sin repetir."""

    search = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")

    def __init__(self, *args, query_params=None, **kwargs):
        self.query_params = query_params
        super().__init__(*args, **kwargs)

    def to_internal_value(self, data):
        permitidos = set(self.fields) | {"page"}
        errores = {}
        for clave in self.query_params.keys():
            if clave not in permitidos:
                errores[clave] = ["Parámetro no permitido."]
            elif len(self.query_params.getlist(clave)) > 1:
                errores[clave] = ["Parámetro repetido."]
        if errores:
            raise serializers.ValidationError(errores)
        return super().to_internal_value(data)


class FiltrosCategoriasSerializer(FiltrosSerializer):
    activo = serializers.ChoiceField(
        choices=["true", "false"], required=False, error_messages={"invalid_choice": "Usa true o false."},
    )

    def validate_activo(self, valor):
        return valor == "true"

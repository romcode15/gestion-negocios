from collections.abc import Mapping

from rest_framework import serializers

from api.ventas.serializers import MovimientoVentaSerializer


class FiltrosTrazabilidadSerializer(serializers.Serializer):
    """La trazabilidad solo admite la paginación estándar."""

    def __init__(self, *args, query_params=None, **kwargs):
        self.query_params = query_params
        super().__init__(*args, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            return super().to_internal_value(data)
        errores = {}
        for clave in self.query_params.keys():
            if clave != "page":
                errores[clave] = ["Parámetro no permitido."]
            elif len(self.query_params.getlist(clave)) > 1:
                errores[clave] = ["Parámetro repetido."]
        if errores:
            raise serializers.ValidationError(errores)
        return super().to_internal_value(data)


__all__ = ["FiltrosTrazabilidadSerializer", "MovimientoVentaSerializer"]

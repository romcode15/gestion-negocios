"""B4 reutiliza la salida compartida de B1; solo define la validación de consulta."""
from api.catalogo.categorias.serializers import FiltrosSerializer
from api.ventas.serializers import VentaProductoOpcionSerializer

__all__ = ["FiltrosOpcionesVentaSerializer", "VentaProductoOpcionSerializer"]


class FiltrosOpcionesVentaSerializer(FiltrosSerializer):
    """Solo `search` (recortado, máximo 150) y `page`; desconocidos o repetidos dan 400."""

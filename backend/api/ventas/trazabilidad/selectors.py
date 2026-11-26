from django.shortcuts import get_object_or_404

from ventas.models import Venta, VinculoMovimientoVenta


def movimientos_de_venta(contexto, venta_id):
    """Devuelve los vínculos históricos de una venta dentro del negocio."""
    get_object_or_404(Venta, pk=venta_id, negocio_id=contexto.negocio.pk)
    return (
        VinculoMovimientoVenta.objects.filter(
            negocio_id=contexto.negocio.pk,
            detalle__venta_id=venta_id,
            detalle__venta__negocio_id=contexto.negocio.pk,
        )
        .select_related("movimiento__producto", "movimiento__usuario")
        .order_by("movimiento__creado_en", "movimiento_id")
    )

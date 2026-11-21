from django.db.models import Q

from inventario.models import MovimientoInventario


def movimientos_del_negocio(
    contexto, *, producto_id=None, tipo=None, search="", desde=None, hasta=None,
):
    queryset = MovimientoInventario.objects.filter(
        negocio_id=contexto.negocio.pk,
    ).select_related("producto", "usuario")
    if producto_id is not None:
        queryset = queryset.filter(producto_id=producto_id)
    if tipo is not None:
        queryset = queryset.filter(tipo=tipo)
    if search:
        queryset = queryset.filter(
            Q(producto__sku__icontains=search)
            | Q(producto__nombre__icontains=search)
        )
    if desde is not None:
        queryset = queryset.filter(creado_en__gte=desde)
    if hasta is not None:
        queryset = queryset.filter(creado_en__lt=hasta)
    return queryset.order_by("-creado_en", "-id")

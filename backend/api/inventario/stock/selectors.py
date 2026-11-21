from django.db.models import F, Q

from inventario.models import Existencia


def existencias_del_negocio(contexto, *, search="", categoria_id=None, activo=None, bajo_minimo=None):
    queryset = Existencia.objects.filter(negocio_id=contexto.negocio.pk).select_related("producto__categoria")
    if search:
        queryset = queryset.filter(Q(producto__nombre__icontains=search) | Q(producto__sku__icontains=search))
    if categoria_id is not None:
        queryset = queryset.filter(producto__categoria_id=categoria_id)
    if activo is not None:
        queryset = queryset.filter(producto__activo=activo)
    if bajo_minimo is not None:
        lookup = "cantidad__lt" if bajo_minimo else "cantidad__gte"
        queryset = queryset.filter(**{lookup: F("producto__stock_minimo")})
    return queryset.order_by("producto_id")

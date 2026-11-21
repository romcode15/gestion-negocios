from django.db.models import Q

from catalogo.models import Producto


def productos_del_negocio(contexto, *, search="", categoria_id=None, activo=None):
    """Productos del negocio autorizado con su categoría precargada (sin N+1)."""
    queryset = Producto.objects.filter(negocio_id=contexto.negocio.pk).select_related("categoria")
    if search:
        queryset = queryset.filter(Q(nombre__icontains=search) | Q(sku__icontains=search))
    if categoria_id is not None:
        queryset = queryset.filter(categoria_id=categoria_id)
    if activo is not None:
        queryset = queryset.filter(activo=activo)
    return queryset.order_by("id")


def opciones_de_producto(contexto, *, search=""):
    """Solo productos activos del negocio, con los campos de ProductoOpcion."""
    return (
        productos_del_negocio(contexto, search=search, activo=True)
        .select_related(None)
        .only("id", "negocio_id", "sku", "nombre", "unidad")
    )

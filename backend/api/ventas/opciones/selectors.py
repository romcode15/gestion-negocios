from decimal import Decimal

from django.db.models import DecimalField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce

from catalogo.models import Producto
from inventario.models import Existencia


def opciones_para_vender(contexto, *, search=""):
    """Productos y categorías activos del negocio con precio y saldo disponible.

    El saldo se resuelve con una subconsulta filtrada por el mismo negocio, en la misma
    consulta del listado (sin N+1). Incluye productos con saldo cero: el stock es informativo.
    """
    negocio_id = contexto.negocio.pk
    saldo = Existencia.objects.filter(negocio_id=negocio_id, producto_id=OuterRef("pk")).values("cantidad")[:1]
    queryset = (
        Producto.objects.filter(negocio_id=negocio_id, activo=True, categoria__activo=True)
        .annotate(disponible=Coalesce(
            Subquery(saldo), Value(Decimal("0.000")),
            output_field=DecimalField(max_digits=14, decimal_places=3),
        ))
        .only("id", "negocio_id", "sku", "nombre", "unidad", "precio_venta")
    )
    if search:
        queryset = queryset.filter(Q(nombre__icontains=search) | Q(sku__icontains=search))
    return queryset.order_by("id")

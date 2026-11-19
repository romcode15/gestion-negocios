from catalogo.models import Categoria


def categorias_del_negocio(contexto, *, search="", activo=None):
    """Categorías del negocio autorizado; búsqueda parcial sin distinguir mayúsculas."""
    queryset = Categoria.objects.filter(negocio_id=contexto.negocio.pk)
    if search:
        queryset = queryset.filter(nombre__icontains=search)
    if activo is not None:
        queryset = queryset.filter(activo=activo)
    return queryset.order_by("id")


def opciones_de_categoria(contexto, *, search=""):
    """Solo categorías activas, con los campos mínimos para formularios de productos."""
    return categorias_del_negocio(contexto, search=search, activo=True).only("id", "negocio_id", "nombre")

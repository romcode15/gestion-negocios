from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework.exceptions import NotFound, ValidationError

from api.common.access import resolver_contexto_negocio
from catalogo.models import Categoria, Producto, tiene_fraccion
from inventario.models import Existencia

SKU_EN_USO = "Ya existe un producto con ese SKU en este negocio."
CATEGORIA_INVALIDA = "Selecciona una categoría activa del negocio."
UNIDAD_CONGELADA = "La unidad no se puede cambiar después del primer movimiento."
MINIMO_ENTERO = "El stock mínimo debe ser entero para productos por unidad."
CAMPOS_EDITABLES = ("categoria_id", "sku", "nombre", "descripcion", "unidad", "precio_venta", "stock_minimo", "activo")
# El modelo informa algunos errores con el nombre de la relación; la API usa el del campo enviado.
_CAMPO_API = {"categoria": "categoria_id"}


def sku_en_uso(negocio_id, sku, *, excluir_id=None):
    queryset = Producto.objects.filter(negocio_id=negocio_id, sku=sku)
    if excluir_id is not None:
        queryset = queryset.exclude(pk=excluir_id)
    return queryset.exists()


def _bloquear_categoria(negocio_id, categoria_id):
    """Bloquea la categoría del negocio; coordina con su desactivación en B4."""
    return Categoria.objects.select_for_update().filter(negocio_id=negocio_id, pk=categoria_id).first()


def _validar_minimo(unidad, stock_minimo):
    if unidad == Producto.Unidad.UNIDAD and tiene_fraccion(stock_minimo):
        raise ValidationError({"stock_minimo": [MINIMO_ENTERO]})


def _guardar(producto, **kwargs):
    """Guarda en un savepoint; traduce el choque de SKU y los errores del modelo a campos de la API."""
    try:
        with transaction.atomic():
            producto.save(**kwargs)
    except (IntegrityError, DjangoValidationError) as error:
        if sku_en_uso(producto.negocio_id, producto.sku, excluir_id=producto.pk):
            raise ValidationError({"sku": [SKU_EN_USO]}) from error
        if isinstance(error, DjangoValidationError) and hasattr(error, "message_dict"):
            raise ValidationError({
                _CAMPO_API.get(campo, campo): mensajes for campo, mensajes in error.message_dict.items()
            }) from error
        raise
    return producto


@transaction.atomic
def crear_producto(contexto, *, categoria_id, sku, nombre, unidad, precio_venta,
                   descripcion="", stock_minimo=None):
    """Crea Producto y su Existencia en cero en una sola transacción."""
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, contexto.negocio.pk, "crear_producto")
    negocio_id = contexto.negocio.pk
    categoria = _bloquear_categoria(negocio_id, categoria_id)
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, negocio_id, "crear_producto")
    if categoria is None or not categoria.activo:
        raise ValidationError({"categoria_id": [CATEGORIA_INVALIDA]})
    if stock_minimo is not None:
        _validar_minimo(unidad, stock_minimo)
    if sku_en_uso(negocio_id, sku):
        raise ValidationError({"sku": [SKU_EN_USO]})

    producto = Producto(
        negocio=contexto.negocio, categoria=categoria, sku=sku, nombre=nombre, descripcion=descripcion,
        unidad=unidad, precio_venta=precio_venta, activo=True,
    )
    if stock_minimo is not None:
        producto.stock_minimo = stock_minimo
    _guardar(producto)
    # El saldo inicial siempre es cero; el stock solo cambia con movimientos de inventario.
    Existencia.objects.create(negocio=contexto.negocio, producto=producto)
    return producto


@transaction.atomic
def actualizar_producto(contexto, producto_id, datos):
    """Edita el catálogo bajo el bloqueo de Existencia; nunca modifica saldo ni versión."""
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, contexto.negocio.pk, "editar_producto")
    negocio_id = contexto.negocio.pk
    # Orden de bloqueo compartido con el servicio de inventario: Existencia → (Categoría).
    if not Existencia.objects.select_for_update().filter(negocio_id=negocio_id, producto_id=producto_id).exists():
        raise NotFound()
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, negocio_id, "editar_producto")
    producto = Producto.objects.select_related("categoria").get(negocio_id=negocio_id, pk=producto_id)

    datos = {campo: valor for campo, valor in datos.items() if campo in CAMPOS_EDITABLES}
    nueva_categoria_id = datos.get("categoria_id", producto.categoria_id)
    cambia_categoria = nueva_categoria_id != producto.categoria_id
    activo_final = datos.get("activo", producto.activo)
    if cambia_categoria or activo_final:
        categoria = _bloquear_categoria(negocio_id, nueva_categoria_id)
        contexto = resolver_contexto_negocio(contexto.membresia.usuario, negocio_id, "editar_producto")
        # Un producto inactivo puede conservar su categoría inactiva; moverlo o reactivarlo exige una activa.
        if categoria is None or not categoria.activo:
            raise ValidationError({"categoria_id": [CATEGORIA_INVALIDA]})
        producto.categoria = categoria

    unidad_final = datos.get("unidad", producto.unidad)
    if unidad_final != producto.unidad and producto.movimientos.exists():
        raise ValidationError({"unidad": [UNIDAD_CONGELADA]})
    _validar_minimo(unidad_final, datos.get("stock_minimo", producto.stock_minimo))
    if "sku" in datos and sku_en_uso(negocio_id, datos["sku"], excluir_id=producto.pk):
        raise ValidationError({"sku": [SKU_EN_USO]})

    for campo in ("sku", "nombre", "descripcion", "unidad", "precio_venta", "stock_minimo", "activo"):
        if campo in datos:
            setattr(producto, campo, datos[campo])
    return _guardar(producto)

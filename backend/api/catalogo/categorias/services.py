from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework.exceptions import NotFound, ValidationError

from api.common.access import resolver_contexto_negocio
from catalogo.models import Categoria

NOMBRE_EN_USO = "Ya existe una categoría con ese nombre en este negocio."
CON_PRODUCTOS_ACTIVOS = "Desactiva los productos activos antes de desactivar la categoría."


def nombre_en_uso(negocio_id, nombre, *, excluir_id=None):
    # La comparación distingue mayúsculas, igual que la restricción única del modelo.
    queryset = Categoria.objects.filter(negocio_id=negocio_id, nombre=nombre)
    if excluir_id is not None:
        queryset = queryset.exclude(pk=excluir_id)
    return queryset.exists()


def _guardar(categoria, **kwargs):
    """Guarda en un savepoint y traduce solo el choque esperado de nombre a un 400 de campo."""
    try:
        with transaction.atomic():
            categoria.save(**kwargs)
    except (IntegrityError, DjangoValidationError) as error:
        if nombre_en_uso(categoria.negocio_id, categoria.nombre, excluir_id=categoria.pk):
            raise ValidationError({"nombre": [NOMBRE_EN_USO]}) from error
        raise
    return categoria


@transaction.atomic
def crear_categoria(contexto, *, nombre, descripcion=""):
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, contexto.negocio.pk, "crear_categoria")
    if nombre_en_uso(contexto.negocio.pk, nombre):
        raise ValidationError({"nombre": [NOMBRE_EN_USO]})
    # activo no es configurable en el alta: toda categoría nueva nace activa.
    return _guardar(Categoria(negocio=contexto.negocio, nombre=nombre, descripcion=descripcion, activo=True))


@transaction.atomic
def actualizar_categoria(contexto, categoria_id, datos):
    """Edita nombre, descripción o estado bajo bloqueo de la fila de categoría.

    El bloqueo serializa la desactivación con las altas y reactivaciones de producto (B5),
    que deben bloquear la misma categoría antes de validar que está activa.
    """
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, contexto.negocio.pk, "editar_categoria")
    categoria = Categoria.objects.select_for_update().filter(
        negocio_id=contexto.negocio.pk, pk=categoria_id,
    ).first()
    if categoria is None:
        raise NotFound()
    # El acceso puede cambiar mientras esperamos el bloqueo de la categoría.
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, contexto.negocio.pk, "editar_categoria")

    if "nombre" in datos and nombre_en_uso(contexto.negocio.pk, datos["nombre"], excluir_id=categoria.pk):
        raise ValidationError({"nombre": [NOMBRE_EN_USO]})
    if datos.get("activo") is False and categoria.productos.filter(activo=True).exists():
        raise ValidationError({"activo": [CON_PRODUCTOS_ACTIVOS]})

    for campo in ("nombre", "descripcion", "activo"):
        if campo in datos:
            setattr(categoria, campo, datos[campo])
    return _guardar(categoria)

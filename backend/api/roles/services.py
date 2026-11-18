from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from accesos.models import Rol, RolPermiso
from api.common.access import resolver_contexto_negocio, validar_permisos_delegables

NOMBRE_EN_USO = "Ya existe un rol con ese nombre en este negocio."


def nombre_en_uso(negocio_id, nombre):
    # Incluye el rol predefinido Administrador de negocio.
    return Rol.objects.filter(negocio_id=negocio_id, nombre=nombre).exists()


@transaction.atomic
def crear_rol(contexto, nombre, permiso_ids):
    """Crea un rol no predefinido del negocio autorizado con sus permisos, todo o nada."""
    # Revalida el permiso actual del actor dentro de la transacción de guardado.
    contexto = resolver_contexto_negocio(contexto.membresia.usuario, contexto.negocio.pk, "crear_rol")
    ids = validar_permisos_delegables(contexto, permiso_ids)
    if nombre_en_uso(contexto.negocio.pk, nombre):
        raise ValidationError({"nombre": [NOMBRE_EN_USO]})
    try:
        with transaction.atomic():
            rol = Rol.objects.create(negocio=contexto.negocio, nombre=nombre, predefinido=False)
    except (IntegrityError, DjangoValidationError) as error:
        # Dos altas simultáneas con el mismo nombre: la restricción de PostgreSQL decide.
        if nombre_en_uso(contexto.negocio.pk, nombre):
            raise ValidationError({"nombre": [NOMBRE_EN_USO]}) from error
        raise
    for permiso_id in ids:
        RolPermiso.objects.create(rol=rol, permiso_id=permiso_id)
    return rol

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction

from .catalogo import (
    ADMINISTRADOR_NEGOCIO, PERMISOS_NEGOCIO, PERMISOS_PLATAFORMA, SUPERADMINISTRADOR,
)
from .models import Permiso, Rol, RolPermiso, UsuarioRolGlobal


def _preparar_permisos(codigos, ambito):
    permisos = []
    for codigo in codigos:
        permiso, _ = Permiso.objects.get_or_create(codigo=codigo, defaults={"ambito": ambito})
        if permiso.ambito != ambito:
            raise ValidationError({"ambito": f"El permiso {codigo} tiene un ámbito incompatible."})
        permisos.append(permiso)
    return permisos


def _preparar_rol(nombre, negocio, permisos):
    rol, _ = Rol.objects.get_or_create(
        nombre=nombre, negocio=negocio, defaults={"predefinido": True},
    )
    if not rol.predefinido:
        raise ValidationError({"nombre": "Ya existe un rol personalizado con el nombre reservado."})
    for permiso in permisos:
        RolPermiso.objects.get_or_create(rol=rol, permiso=permiso)
    return rol


@transaction.atomic
def preparar_catalogo():
    """Crea los nueve permisos y el rol global. Puede repetirse sin duplicados."""
    plataforma = _preparar_permisos(PERMISOS_PLATAFORMA, Permiso.Ambito.PLATAFORMA)
    _preparar_permisos(PERMISOS_NEGOCIO, Permiso.Ambito.NEGOCIO)
    return _preparar_rol(SUPERADMINISTRADOR, None, plataforma)


@transaction.atomic
def preparar_administrador_negocio(negocio):
    """El servicio de alta de #6 llamará este helper dentro de su transacción."""
    if negocio.pk is None or negocio._state.adding:
        raise ValidationError({"negocio": "El negocio debe estar guardado."})
    permisos = _preparar_permisos(PERMISOS_NEGOCIO, Permiso.Ambito.NEGOCIO)
    return _preparar_rol(ADMINISTRADOR_NEGOCIO, negocio, permisos)


@transaction.atomic
def asignar_superadministrador(usuario):
    if usuario.pk is None or usuario._state.adding or not usuario.is_active:
        raise ValidationError({"usuario": "Selecciona una cuenta activa existente."})
    # Revalidar el estado persistido y mantenerlo estable durante la asignación.
    usuario = get_user_model().objects.select_for_update().filter(pk=usuario.pk, is_active=True).first()
    if usuario is None:
        raise ValidationError({"usuario": "Selecciona una cuenta activa existente."})
    rol = preparar_catalogo()
    asignacion, _ = UsuarioRolGlobal.objects.get_or_create(usuario=usuario, rol=rol)
    return asignacion

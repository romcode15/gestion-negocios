from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction

from accesos.models import Membresia, Rol
from api.common.access import validar_asignacion_rol
from api.plataforma.services import crear_usuario


PASSWORD_NO_ENVIADO = object()


@transaction.atomic
def crear_membresia(
    contexto,
    username,
    rol_id,
    password=PASSWORD_NO_ENVIADO,
):
    rol = Rol.objects.filter(pk=rol_id).first()

    if rol is None:
        raise ValidationError({
            "rol_id": ["Selecciona un rol existente del negocio."]
        })

    validar_asignacion_rol(contexto, rol)

    if password is not PASSWORD_NO_ENVIADO:
        usuario = crear_usuario(
            username=username,
            password=password,
        )
    else:
        modelo = get_user_model()

        try:
            modelo._meta.get_field("username").clean(username, None)
        except ValidationError as error:
            raise ValidationError({
                "username": error.messages,
            }) from error

        usuario = (
            modelo.objects
            .select_for_update()
            .filter(username=username, is_active=True)
            .first()
        )

        if usuario is None:
            raise ValidationError({
                "username": ["Selecciona una cuenta activa existente."]
            })

    if Membresia.objects.filter(
        usuario=usuario,
        negocio=contexto.negocio,
    ).exists():
        raise ValidationError({
            "username": ["La cuenta ya tiene una membresía en este negocio."]
        })

    return Membresia.objects.create(
        usuario=usuario,
        negocio=contexto.negocio,
        rol=rol,
        activo=True,
    )
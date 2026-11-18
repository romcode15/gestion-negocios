from django.core.exceptions import ImproperlyConfigured
from django.db import connection
from rest_framework.exceptions import ValidationError

from accesos.catalogo import ADMINISTRADOR_NEGOCIO
from accesos.models import Membresia, Rol
from negocios.models import Negocio

from .access import obtener_recurso_negocio, resolver_contexto_negocio, validar_asignacion_rol


def validar_cambio_rol(contexto, membresia, nuevo_rol):
    """Valida bajo bloqueo; el llamador guarda el resultado en la misma transacción."""
    if not connection.in_atomic_block:
        raise ImproperlyConfigured("El cambio de rol requiere transaction.atomic().")
    # Serializa los cambios de rol de este negocio, incluso a miembros distintos.
    Negocio.objects.select_for_update().get(pk=contexto.negocio.pk)
    contexto = resolver_contexto_negocio(
        contexto.membresia.usuario, contexto.negocio.pk, "asignar_rol",
    )
    actual = obtener_recurso_negocio(
        contexto, Membresia.objects.select_related("rol", "usuario"), pk=membresia.pk,
    )
    # Consultar el estado actual, sin confiar en objetos que vienen de otro momento.
    rol = Rol.objects.filter(pk=nuevo_rol.pk, negocio_id=contexto.negocio.pk).first()
    if rol is None:
        raise ValidationError({"rol_id": ["Selecciona un rol del negocio activo."]})
    validar_asignacion_rol(contexto, rol)
    es_admin_actual = (
        actual.activo and actual.usuario.is_active and actual.rol.predefinido
        and actual.rol.nombre == ADMINISTRADOR_NEGOCIO
    )
    conserva_admin = rol.predefinido and rol.nombre == ADMINISTRADOR_NEGOCIO
    if es_admin_actual and not conserva_admin:
        otros = Membresia.objects.filter(
            negocio_id=contexto.negocio.pk, activo=True, usuario__is_active=True,
            rol__predefinido=True, rol__nombre=ADMINISTRADOR_NEGOCIO,
        ).exclude(pk=actual.pk)
        if not otros.exists():
            raise ValidationError({"rol_id": ["El negocio debe conservar un administrador activo."]})
    return actual

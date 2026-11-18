from dataclasses import dataclass

from django.db.models import F
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotAuthenticated, PermissionDenied, ValidationError

from accesos.models import Membresia, Permiso, RolPermiso, UsuarioRolGlobal
from negocios.models import Negocio


@dataclass(frozen=True)
class ContextoNegocio:
    negocio: Negocio
    membresia: Membresia
    permisos: frozenset[str]


def exigir_usuario_activo(usuario):
    if not usuario or not usuario.is_authenticated or not usuario.is_active:
        raise NotAuthenticated()


def permisos_globales(usuario):
    exigir_usuario_activo(usuario)
    return set(UsuarioRolGlobal.objects.filter(
        usuario=usuario, usuario__is_active=True, rol__negocio__isnull=True,
        rol__permisos_asignados__permiso__ambito=Permiso.Ambito.PLATAFORMA,
    ).values_list("rol__permisos_asignados__permiso__codigo", flat=True))


def permisos_del_rol(rol_id):
    return set(RolPermiso.objects.filter(
        rol_id=rol_id, permiso__ambito=Permiso.Ambito.NEGOCIO,
    ).values_list("permiso__codigo", flat=True))


def resolver_contexto_negocio(usuario, negocio_id, permiso=None):
    exigir_usuario_activo(usuario)
    membresia = Membresia.objects.select_related("negocio", "rol", "usuario").filter(
        usuario=usuario, usuario__is_active=True, negocio_id=negocio_id,
        negocio__activo=True, activo=True, rol__negocio_id=F("negocio_id"),
    ).first()
    if membresia is None:
        raise PermissionDenied()
    codigos = frozenset(permisos_del_rol(membresia.rol_id))
    if permiso is not None and permiso not in codigos:
        raise PermissionDenied()
    return ContextoNegocio(membresia.negocio, membresia, codigos)


def obtener_recurso_negocio(contexto, queryset, **lookup):
    return get_object_or_404(queryset.filter(negocio_id=contexto.negocio.pk), **lookup)


def permisos_delegables(contexto):
    return Permiso.objects.filter(ambito=Permiso.Ambito.NEGOCIO, codigo__in=contexto.permisos).order_by("id")


def validar_permisos_delegables(contexto, permiso_ids):
    ids = list(permiso_ids)
    if len(ids) != len(set(ids)) or set(ids) - set(permisos_delegables(contexto).values_list("id", flat=True)):
        raise ValidationError({"permiso_ids": ["Selecciona permisos delegables válidos y sin repetir."]})
    return ids


def validar_asignacion_rol(contexto, rol):
    if rol.pk is None or rol._state.adding or rol.negocio_id != contexto.negocio.pk:
        raise ValidationError({"rol_id": ["Selecciona un rol del negocio activo."]})
    if not permisos_del_rol(rol.pk).issubset(contexto.permisos):
        raise ValidationError({"rol_id": ["No puedes asignar un rol con permisos que no posees."]})
    return rol

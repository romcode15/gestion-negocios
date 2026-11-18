from django.core.exceptions import ImproperlyConfigured
from rest_framework.permissions import BasePermission
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied

from .access import exigir_usuario_activo, permisos_globales, resolver_contexto_negocio


def _permiso_requerido(view, method):
    method = "GET" if method == "HEAD" else method
    if method == "OPTIONS":
        method = next((m for m in ("GET", "POST", "PATCH", "PUT", "DELETE") if m in view.allowed_methods), method)
    if method not in view.allowed_methods:
        raise MethodNotAllowed(method)
    codigo = getattr(view, "permisos_por_metodo", {}).get(method) or getattr(view, "permiso_requerido", None)
    if not codigo:
        raise ImproperlyConfigured("La vista debe declarar el permiso requerido para este método.")
    return codigo


class UsuarioActivo(BasePermission):
    def has_permission(self, request, view):
        exigir_usuario_activo(request.user)
        return True


class TienePermisoGlobal(BasePermission):
    def has_permission(self, request, view):
        exigir_usuario_activo(request.user)
        if _permiso_requerido(view, request.method) not in permisos_globales(request.user):
            raise PermissionDenied()
        return True


class TienePermisoNegocio(BasePermission):
    def has_permission(self, request, view):
        exigir_usuario_activo(request.user)
        view.contexto_negocio = resolver_contexto_negocio(
            request.user, view.kwargs["negocio_id"], _permiso_requerido(view, request.method),
        )
        return True

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import JsonResponse
from django.views.csrf import csrf_failure as django_csrf_failure
from rest_framework import exceptions
from rest_framework.views import exception_handler

from .exceptions import CsrfFailed


def _errores_por_campo(detail):
    """Convierte también validaciones anidadas en listas de mensajes por campo."""
    result = {}

    def walk(value, path):
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, f"{path}.{key}" if path else str(key))
        elif isinstance(value, (list, tuple)):
            for child in value:
                walk(child, path)
        else:
            result.setdefault(path or "non_field_errors", []).append(str(value))

    walk(detail, "")
    return result


def manejar_excepcion(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(
            exc.message_dict if hasattr(exc, "message_dict") else exc.messages,
        )
    response = exception_handler(exc, context)
    if response is None:
        # Las excepciones inesperadas conservan el comportamiento de error 500.
        return None
    errors = {}
    if isinstance(exc, exceptions.ValidationError):
        code, detail = "validation_error", "Revisa los campos indicados."
        errors = _errores_por_campo(exc.detail)
    elif isinstance(exc, exceptions.ParseError):
        code, detail = "validation_error", "El cuerpo de la solicitud no es válido."
    elif isinstance(exc, (exceptions.NotAuthenticated, exceptions.AuthenticationFailed)):
        response.status_code = 403
        code, detail = "not_authenticated", "Inicia sesión para continuar."
    elif response.status_code == 404:
        code, detail = "not_found", "El recurso solicitado no está disponible en este contexto."
    elif isinstance(exc, CsrfFailed):
        code, detail = "csrf_failed", str(exc.detail)
    elif response.status_code == 403:
        code, detail = "permission_denied", "No tienes permiso para realizar esta acción."
    else:
        code = getattr(exc, "default_code", "api_error")
        detail = str(getattr(exc, "detail", "No se pudo completar la solicitud."))
    response.data = {"code": code, "detail": detail, "errors": errors}
    return response


def csrf_failure(request, reason=""):
    if request.path.startswith("/api/v1/"):
        return JsonResponse({
            "code": "csrf_failed", "detail": str(CsrfFailed.default_detail), "errors": {},
        }, status=403)
    return django_csrf_failure(request, reason=reason)

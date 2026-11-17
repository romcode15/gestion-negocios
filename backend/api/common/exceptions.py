from rest_framework.exceptions import APIException


class CsrfFailed(APIException):
    status_code = 403
    default_code = "csrf_failed"
    default_detail = "Obtén un token CSRF válido y vuelve a enviar la solicitud."


class InvalidCredentials(APIException):
    status_code = 400
    default_code = "invalid_credentials"
    default_detail = "Nombre de usuario o contraseña incorrectos."

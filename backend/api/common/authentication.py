from rest_framework.authentication import CSRFCheck, SessionAuthentication

from .exceptions import CsrfFailed


class AutenticacionSesion(SessionAuthentication):
    def enforce_csrf(self, request):
        # Misma comprobación de Django/DRF, con un código estable para el cliente.
        check = CSRFCheck(lambda request: None)
        check.process_request(request)
        if check.process_view(request, None, (), {}):
            raise CsrfFailed()

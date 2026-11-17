from django.contrib.auth import authenticate, login, logout

from api.common.exceptions import InvalidCredentials


def iniciar_sesion(request, username, password):
    usuario = authenticate(request=request, username=username, password=password)
    if usuario is None or not usuario.is_active:
        raise InvalidCredentials()
    login(request, usuario)
    return usuario


def cerrar_sesion(request):
    logout(request)

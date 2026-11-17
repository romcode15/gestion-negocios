from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.cache import never_cache
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .selectors import datos_sesion
from .serializers import LoginSerializer, SesionSerializer, VacioSerializer
from .services import cerrar_sesion, iniciar_sesion


@method_decorator(never_cache, name="dispatch")
class CsrfView(GenericAPIView):
    serializer_class = VacioSerializer
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        get_token(request)
        return Response(status=204)


@method_decorator(never_cache, name="dispatch")
@method_decorator(csrf_protect, name="dispatch")
class LoginView(GenericAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = LoginSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        usuario = iniciar_sesion(request, **serializer.validated_data)
        return Response(SesionSerializer(datos_sesion(usuario)).data)


@method_decorator(never_cache, name="dispatch")
class MeView(GenericAPIView):
    serializer_class = SesionSerializer

    def get(self, request):
        return Response(self.get_serializer(datos_sesion(request.user)).data)


@method_decorator(never_cache, name="dispatch")
class LogoutView(GenericAPIView):
    serializer_class = VacioSerializer
    def post(self, request):
        cerrar_sesion(request)
        return Response(status=204)

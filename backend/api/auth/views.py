from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.cache import never_cache
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from api.common.schema import ErrorSerializer

from .selectors import datos_sesion
from .serializers import LoginSerializer, SesionSerializer, VacioSerializer
from .services import cerrar_sesion, iniciar_sesion


@method_decorator(never_cache, name="dispatch")
class CsrfView(GenericAPIView):
    serializer_class = VacioSerializer
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(tags=["Autenticación"], summary="Obtener cookie CSRF", responses={204: None})
    def get(self, request):
        get_token(request)
        return Response(status=204)


@method_decorator(never_cache, name="dispatch")
@method_decorator(csrf_protect, name="dispatch")
class LoginView(GenericAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = LoginSerializer

    @extend_schema(
        tags=["Autenticación"], summary="Iniciar sesión",
        description="Obtener CSRF primero. Swagger envía X-CSRFToken automáticamente; la cookie rota al iniciar sesión.",
        request=LoginSerializer, responses={200: SesionSerializer, 400: ErrorSerializer, 403: ErrorSerializer},
    )
    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        usuario = iniciar_sesion(request, **serializer.validated_data)
        return Response(SesionSerializer(datos_sesion(usuario)).data)


@method_decorator(never_cache, name="dispatch")
class MeView(GenericAPIView):
    serializer_class = SesionSerializer

    @extend_schema(tags=["Autenticación"], summary="Consultar sesión actual",
                   responses={200: SesionSerializer, 403: ErrorSerializer})
    def get(self, request):
        return Response(self.get_serializer(datos_sesion(request.user)).data)


@method_decorator(never_cache, name="dispatch")
class LogoutView(GenericAPIView):
    serializer_class = VacioSerializer
    @extend_schema(tags=["Autenticación"], summary="Cerrar sesión", request=None,
                   responses={204: None, 403: ErrorSerializer})
    def post(self, request):
        cerrar_sesion(request)
        return Response(status=204)

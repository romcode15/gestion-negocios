from django.urls import path

from .views import NegociosView, UsuariosView

app_name = "plataforma"
urlpatterns = [
    path("usuarios/", UsuariosView.as_view(), name="usuarios"),
    path("negocios/", NegociosView.as_view(), name="negocios"),
]

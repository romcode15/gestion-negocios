from django.urls import path

from .views import RegistrarMovimientoView


urlpatterns = [
    path("movimientos/", RegistrarMovimientoView.as_view(), name="movimientos-registrar"),
]

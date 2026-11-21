from django.urls import path

from .views import RegistrarAjusteView, RegistrarMovimientoView


urlpatterns = [
    path("movimientos/", RegistrarMovimientoView.as_view(), name="movimientos-registrar"),
    path("ajustes/", RegistrarAjusteView.as_view(), name="movimientos-ajuste"),
]

from django.urls import path

from .views import VentasView

# Una única ruta de colección para POST (B5) y GET de listado (B6).
urlpatterns = [
    path("", VentasView.as_view(), name="ventas"),
]

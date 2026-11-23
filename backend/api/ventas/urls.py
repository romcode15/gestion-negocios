"""Composición preparada por B1; cada módulo publica sus rutas al implementarlas."""
from django.urls import include, path


urlpatterns = [
    path("ventas/", include("api.ventas.opciones.urls")),
    path("ventas/", include("api.ventas.registro.urls")),
    path("ventas/", include("api.ventas.consultas.urls")),
    path("ventas/", include("api.ventas.anulaciones.urls")),
    path("ventas/", include("api.ventas.trazabilidad.urls")),
]

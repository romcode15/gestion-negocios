from django.urls import path

from .views import ProductoDetalleView, ProductoOpcionesView, ProductosView

app_name = "productos"
urlpatterns = [
    path("", ProductosView.as_view(), name="lista"),
    path("opciones/", ProductoOpcionesView.as_view(), name="opciones"),
    path("<int:producto_id>/", ProductoDetalleView.as_view(), name="detalle"),
]

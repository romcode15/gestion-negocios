from django.urls import path

from .views import OpcionesVentaView, OpcionVentaDetalleView

app_name = "ventas_opciones"
urlpatterns = [
    path("productos/opciones/", OpcionesVentaView.as_view(), name="opciones"),
    path("productos/<int:producto_id>/", OpcionVentaDetalleView.as_view(), name="detalle"),
]

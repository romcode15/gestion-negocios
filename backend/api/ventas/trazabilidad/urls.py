from django.urls import path

from .views import TrazabilidadVentaView


urlpatterns = [
    path("<int:venta_id>/movimientos/", TrazabilidadVentaView.as_view(), name="venta-movimientos"),
]

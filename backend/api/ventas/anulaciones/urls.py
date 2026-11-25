from django.urls import path

from .views import AnularVentaView


urlpatterns = [
    path("<int:venta_id>/anulacion/", AnularVentaView.as_view(), name="venta-anulacion"),
]

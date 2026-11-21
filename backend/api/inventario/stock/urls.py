from django.urls import path

from .views import ExistenciaDetalleView, ExistenciasView

app_name = "stock"
urlpatterns = [
    path("", ExistenciasView.as_view(), name="lista"),
    path("<int:producto_id>/", ExistenciaDetalleView.as_view(), name="detalle"),
]

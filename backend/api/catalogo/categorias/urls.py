from django.urls import path

from .views import CategoriaDetalleView, CategoriaOpcionesView, CategoriasView

app_name = "categorias"
urlpatterns = [
    path("", CategoriasView.as_view(), name="lista"),
    path("opciones/", CategoriaOpcionesView.as_view(), name="opciones"),
    path("<int:categoria_id>/", CategoriaDetalleView.as_view(), name="detalle"),
]

from django.urls import include, path


urlpatterns = [
    path("categorias/", include("api.catalogo.categorias.urls")),
    path("productos/", include("api.catalogo.productos.urls")),
]

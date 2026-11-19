from django.urls import include, path


urlpatterns = [
    path("existencias/", include("api.inventario.stock.urls")),
    path("", include("api.inventario.movimientos.urls")),
]

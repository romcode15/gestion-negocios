from django.urls import path

from api.membresias.views import CambioRolMembresiaView, MembresiasView


urlpatterns = [
    path("membresias/", MembresiasView.as_view(), name="membresias-lista"),
    path("membresias/<int:membresia_id>/", CambioRolMembresiaView.as_view(), name="membresias-cambiar-rol"),
]

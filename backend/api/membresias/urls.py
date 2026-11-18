from django.urls import path

from api.membresias.views import MembresiasView


urlpatterns = [
    path("membresias/", MembresiasView.as_view(), name="membresias-lista"),
]
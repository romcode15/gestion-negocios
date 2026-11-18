from django.urls import path

from .views import PermisosDelegablesView, RolesView

app_name = "roles"
urlpatterns = [
    path("permisos/", PermisosDelegablesView.as_view(), name="permisos"),
    path("roles/", RolesView.as_view(), name="roles"),
]

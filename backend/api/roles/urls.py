from django.urls import path

from .views import PermisosDelegablesView, RolesAsignablesView, RolesView

app_name = "roles"
urlpatterns = [
    path("permisos/", PermisosDelegablesView.as_view(), name="permisos"),
    path("roles/", RolesView.as_view(), name="roles"),
    path("roles/asignables/", RolesAsignablesView.as_view(), name="roles-asignables"),
]

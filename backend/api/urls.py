from django.urls import include, path

urlpatterns = [
    path("auth/", include("api.auth.urls")),
    path("plataforma/", include("api.plataforma.urls")),
    path("negocios/<int:negocio_id>/", include("api.roles.urls")),
    path("negocios/<int:negocio_id>/", include("api.membresias.urls")),
]

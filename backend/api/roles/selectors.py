from django.db.models import Prefetch

from accesos.models import Rol, RolPermiso


def roles_del_negocio(contexto):
    """Roles del negocio autorizado, sin roles globales ni de otros negocios.

    Los permisos se precargan en una sola consulta para evitar N+1 por rol.
    """
    return (
        Rol.objects.filter(negocio_id=contexto.negocio.pk)
        .prefetch_related(Prefetch(
            "permisos_asignados",
            queryset=RolPermiso.objects.only("id", "rol_id", "permiso_id").order_by("permiso_id"),
        ))
        .order_by("id")
    )

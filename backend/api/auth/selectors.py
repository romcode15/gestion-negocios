from django.db.models import F

from accesos.models import Membresia
from api.common.access import permisos_globales


def datos_sesion(usuario):
    negocios = []
    membresias = Membresia.objects.select_related("negocio", "rol").prefetch_related(
        "rol__permisos_asignados__permiso",
    ).filter(usuario=usuario, usuario__is_active=True, activo=True, negocio__activo=True,
             rol__negocio_id=F("negocio_id")).order_by("negocio_id")
    for membresia in membresias:
        codigos = sorted({
            relacion.permiso.codigo for relacion in membresia.rol.permisos_asignados.all()
            if relacion.permiso.ambito == "negocio"
        })
        negocios.append({"id": membresia.negocio_id, "nombre": membresia.negocio.nombre,
                         "rol_id": membresia.rol_id, "permisos": codigos})
    return {"usuario": usuario, "permisos_globales": sorted(permisos_globales(usuario)), "negocios": negocios}

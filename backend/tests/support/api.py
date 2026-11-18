"""Preparación de roles para probar seguridad sin endpoints de otros módulos."""

from accesos.models import Rol, RolPermiso, Permiso


def crear_rol(negocio, nombre, codigos=()):
    rol = Rol.objects.create(negocio=negocio, nombre=nombre)
    for codigo in codigos:
        RolPermiso.objects.create(rol=rol, permiso=Permiso.objects.get(codigo=codigo))
    return rol

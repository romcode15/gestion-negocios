"""Datos de prueba sin passwords utilizables ni dependencias entre endpoints."""

from dataclasses import dataclass

from django.contrib.auth import get_user_model

from accesos.models import Membresia, Rol
from accesos.services import preparar_administrador_negocio
from negocios.models import Negocio


@dataclass
class ContextoNegocio:
    negocio: Negocio
    administrador: object
    rol: Rol
    membresia: Membresia


def crear_contexto_negocio(nombre="Tienda", tipo="tienda", username="admin_tienda"):
    negocio = Negocio.objects.create(nombre=nombre, tipo=tipo)
    administrador = get_user_model().objects.create_user(username=username)
    rol = preparar_administrador_negocio(negocio)
    membresia = Membresia.objects.create(usuario=administrador, negocio=negocio, rol=rol)
    return ContextoNegocio(negocio, administrador, rol, membresia)


def crear_dos_negocios():
    return (
        crear_contexto_negocio(),
        crear_contexto_negocio("Ferretería", "ferreteria", "admin_ferreteria"),
    )

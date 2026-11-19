"""Fábricas de catálogo e inventario para pruebas, independientes de la API."""

from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import transaction

from accesos.models import Membresia
from catalogo.models import Categoria, Producto
from inventario.models import Existencia, MovimientoInventario
from tests.support.api import crear_rol
from tests.support.factories import ContextoNegocio, crear_dos_negocios


@dataclass
class CatalogoPrueba:
    contexto: ContextoNegocio
    membresia_compartida: Membresia
    categoria: Categoria
    categoria_inactiva: Categoria
    producto: Producto
    producto_inactivo: Producto
    producto_fraccionario: Producto


@transaction.atomic
def crear_producto_prueba(negocio, **datos):
    """Devuelve un Producto con Existencia en cero y versión inicial cero."""
    if "categoria" not in datos and "categoria_id" not in datos:
        datos["categoria"], _ = Categoria.objects.get_or_create(negocio=negocio, nombre="General")
    datos.setdefault("sku", uuid4().hex)
    datos.setdefault("nombre", "Producto de prueba")
    datos.setdefault("unidad", Producto.Unidad.UNIDAD)
    datos.setdefault("precio_venta", Decimal("0.00"))
    producto = Producto.objects.create(negocio=negocio, **datos)
    Existencia.objects.create(negocio=negocio, producto=producto)
    return producto


@transaction.atomic
def crear_movimiento_prueba(producto, usuario, *, tipo, cantidad: Decimal, motivo="Inventario de prueba",
                           clave_operacion=None):
    """Recibe un delta con signo y deja saldo, versión e historial coherentes para lecturas."""
    existencia = producto.existencias.get(negocio_id=producto.negocio_id)
    saldo_anterior = existencia.cantidad
    existencia.cantidad += cantidad
    existencia.version += 1
    existencia.save(update_fields=["cantidad", "version"])

    clave_operacion = clave_operacion or uuid4()
    return MovimientoInventario.objects.create(
        negocio_id=producto.negocio_id, producto=producto, usuario=usuario, tipo=tipo,
        cantidad=cantidad, saldo_anterior=saldo_anterior, saldo_posterior=existencia.cantidad,
        motivo=motivo, clave_operacion=clave_operacion, huella_solicitud=sha256(clave_operacion.bytes).hexdigest(),
    )


@transaction.atomic
def crear_dos_catalogos_prueba():
    """Devuelve dos catálogos con una cuenta compartida y permisos diferentes."""
    tienda, ferreteria = crear_dos_negocios()
    usuario = get_user_model().objects.create_user(username="operador_compartido")

    def crear_catalogo(contexto, unidad, permiso):
        negocio = contexto.negocio
        rol = crear_rol(negocio, "Operador", [permiso])
        membresia = Membresia.objects.create(negocio=negocio, usuario=usuario, rol=rol)
        categoria = Categoria.objects.create(negocio=negocio, nombre="Insumos")
        producto = crear_producto_prueba(negocio, categoria=categoria, sku="INS-01", nombre="Insumo básico")
        archivada = Categoria.objects.create(negocio=negocio, nombre="Archivados")
        inactivo = crear_producto_prueba(negocio, categoria=archivada)
        crear_movimiento_prueba(inactivo, contexto.administrador, tipo="entrada", cantidad=Decimal("1.000"))
        inactivo.activo = False
        inactivo.save(update_fields=["activo"])
        archivada.activo = False
        archivada.save(update_fields=["activo"])

        fraccionario = crear_producto_prueba(
            negocio, categoria=categoria, unidad=unidad, stock_minimo=Decimal("2.500"),
        )
        crear_movimiento_prueba(fraccionario, contexto.administrador, tipo="entrada", cantidad=Decimal("3.250"))
        crear_movimiento_prueba(fraccionario, contexto.administrador, tipo="salida", cantidad=Decimal("-1.125"))
        return CatalogoPrueba(contexto, membresia, categoria, archivada, producto, inactivo, fraccionario)

    return (
        crear_catalogo(tienda, Producto.Unidad.KG, "listar_productos"),
        crear_catalogo(ferreteria, Producto.Unidad.LITRO, "registrar_entrada"),
    )

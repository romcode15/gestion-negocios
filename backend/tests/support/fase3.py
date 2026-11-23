"""Fixtures exclusivas de tests; no reemplazan confirmar/anular en producción."""
from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction

from accesos.models import Membresia
from api.common.access import ContextoNegocio
from inventario.operaciones import aplicar_delta_bloqueado, bloquear_existencias
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios
from tests.support.fase2 import crear_producto_prueba
from ventas.decimales import calcular_subtotal, validar_decimal
from ventas.models import AnulacionVenta, DetalleVenta, Venta, VinculoMovimientoVenta
from ventas.services.common import huella_anulacion, huella_venta


def _contexto(negocio, usuario):
    return ContextoNegocio(negocio, Membresia.objects.get(negocio=negocio, usuario=usuario), frozenset())


@transaction.atomic
def crear_producto_venta_prueba(negocio, *, saldo=Decimal("0.000"), usuario=None, **datos):
    validar_decimal(saldo, campo="saldo", digitos=14, escala=3)
    producto = crear_producto_prueba(negocio, **datos)
    if saldo:
        if usuario is None:
            raise ValueError("Indica el actor del movimiento de preparación de saldo.")
        clave = uuid4()
        aplicar_delta_bloqueado(
            _contexto(negocio, usuario), bloquear_existencias(negocio.pk, [producto.pk])[producto.pk],
            tipo="entrada", delta=saldo, motivo="Saldo de prueba fase 3", clave_operacion=clave,
            huella_solicitud=sha256(clave.bytes).hexdigest(),
        )
    return producto


@transaction.atomic
def crear_venta_confirmada_prueba(negocio, vendedor, *, detalles=None, clave_operacion=None, observaciones=""):
    """detalles: lista de (Producto, Decimal cantidad); stock suficiente previo."""
    if detalles is None:
        producto = crear_producto_venta_prueba(negocio, saldo=Decimal("2.000"), usuario=vendedor)
        detalles = [(producto, Decimal("1.000"))]
    detalles = list(detalles)
    if not 1 <= len(detalles) <= 100 or len({p.pk for p, _ in detalles}) != len(detalles):
        raise ValueError("Prepara de 1 a 100 productos distintos.")
    if any(p.negocio_id != negocio.pk for p, _ in detalles):
        raise ValidationError({"producto": "Los productos de prueba deben pertenecer al negocio."})
    contexto = _contexto(negocio, vendedor)
    existencias = bloquear_existencias(negocio.pk, [p.pk for p, _ in detalles])
    lineas = []
    for producto, cantidad in sorted(detalles, key=lambda fila: fila[0].pk):
        producto.refresh_from_db()
        lineas.append((producto, cantidad, calcular_subtotal(cantidad, producto.precio_venta)))
    total = sum((subtotal for _, _, subtotal in lineas), Decimal("0.00"))
    validar_decimal(total, campo="total", digitos=14, escala=2)
    normalizadas = [{"producto_id": p.pk, "cantidad": c, "precio_unitario_esperado": p.precio_venta} for p, c, _ in lineas]
    venta = Venta.objects.create(
        negocio=negocio, vendedor=vendedor, observaciones=observaciones, total=total,
        clave_operacion=clave_operacion or uuid4(), huella_solicitud=huella_venta(vendedor.pk, normalizadas, observaciones),
    )
    for producto, cantidad, subtotal in lineas:
        detalle = DetalleVenta.objects.create(
            venta=venta, negocio=negocio, producto=producto, sku=producto.sku, nombre=producto.nombre,
            unidad=producto.unidad, cantidad=cantidad, precio_unitario=producto.precio_venta, subtotal=subtotal,
        )
        clave = uuid4()
        movimiento = aplicar_delta_bloqueado(
            contexto, existencias[producto.pk], tipo="salida", delta=-cantidad,
            motivo=f"Venta de prueba {venta.pk}, detalle {detalle.pk}", clave_operacion=clave,
            huella_solicitud=sha256(clave.bytes).hexdigest(),
        )
        VinculoMovimientoVenta.objects.create(negocio=negocio, detalle=detalle, movimiento=movimiento, operacion="venta")
    return venta


@transaction.atomic
def anular_venta_prueba(venta, usuario, *, motivo="Anulación de prueba", clave_operacion=None):
    """Exclusivo de fixtures de lectura; no es la implementación de B7."""
    venta = Venta.objects.select_for_update().get(pk=venta.pk)
    auditoria = AnulacionVenta.objects.create(
        negocio=venta.negocio, venta=venta, usuario=usuario, motivo=motivo,
        clave_operacion=clave_operacion or uuid4(), huella_solicitud=huella_anulacion(usuario.pk, venta.pk, motivo),
    )
    detalles = list(venta.detalles.order_by("producto_id"))
    existencias = bloquear_existencias(venta.negocio_id, [d.producto_id for d in detalles])
    contexto = _contexto(venta.negocio, usuario)
    for detalle in detalles:
        clave = uuid4()
        movimiento = aplicar_delta_bloqueado(
            contexto, existencias[detalle.producto_id], tipo="entrada", delta=detalle.cantidad,
            motivo=f"Anulación de prueba {auditoria.pk}, detalle {detalle.pk}", clave_operacion=clave,
            huella_solicitud=sha256(clave.bytes).hexdigest(),
        )
        VinculoMovimientoVenta.objects.create(negocio=venta.negocio, detalle=detalle, movimiento=movimiento, operacion="anulacion")
    venta.estado = Venta.Estado.ANULADA
    venta.save(update_fields=["estado"])
    return venta


@dataclass
class EscenarioVentas:
    contexto: object
    membresia_compartida: Membresia
    producto: object
    producto_fraccionario: object
    producto_inactivo: object
    venta: Venta
    venta_anulada: Venta


@transaction.atomic
def crear_dos_escenarios_ventas():
    tienda, ferreteria = crear_dos_negocios()
    usuario = get_user_model().objects.create_user(username="compartido_ventas")
    escenarios = []
    for contexto, permisos, unidad in [
        (tienda, ["registrar_venta"], "kg"),
        (ferreteria, ["listar_ventas", "anular_venta"], "litro"),
    ]:
        negocio, actor = contexto.negocio, contexto.administrador
        rol = crear_rol(negocio, "Ventas limitadas", permisos)
        membresia = Membresia.objects.create(negocio=negocio, usuario=usuario, rol=rol)
        producto = crear_producto_venta_prueba(negocio, usuario=actor, saldo=Decimal("10.000"), sku="COMUN-V3", nombre="Producto común", precio_venta=Decimal("2.50"))
        fraccionario = crear_producto_venta_prueba(negocio, usuario=actor, saldo=Decimal("5.000"), unidad=unidad, precio_venta=Decimal("1.00"))
        venta = crear_venta_confirmada_prueba(negocio, actor, detalles=[(producto, Decimal("2.000")), (fraccionario, Decimal("0.005"))])
        anulada = anular_venta_prueba(crear_venta_confirmada_prueba(negocio, actor, detalles=[(producto, Decimal("1.000"))]), actor)
        inactivo = crear_producto_venta_prueba(negocio, usuario=actor, saldo=Decimal("1.000"), activo=False)
        escenarios.append(EscenarioVentas(contexto, membresia, producto, fraccionario, inactivo, venta, anulada))
    return tuple(escenarios)

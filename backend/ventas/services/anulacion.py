"""Anula una venta confirmada y repone sus existencias de forma atomica."""
from uuid import uuid4

from django.db import IntegrityError, transaction
from rest_framework.exceptions import NotFound, ValidationError

from inventario.operaciones import bloquear_existencias, aplicar_delta_bloqueado
from ventas.models import AnulacionVenta, DetalleVenta, Venta, VinculoMovimientoVenta

from .common import (
    ConflictoVenta,
    es_colision_clave,
    huella_anulacion,
    huella_movimiento_venta,
    normalizar_texto,
    normalizar_uuid,
    revalidar_contexto_ventas,
)


def _anulacion_por_clave(negocio_id, clave):
    return AnulacionVenta.objects.filter(negocio_id=negocio_id, clave_operacion=clave).first()


def _comprobar_repeticion(anulacion, *, usuario_id, huella, venta_id):
    if anulacion is None:
        return None
    if (
        anulacion.usuario_id == usuario_id
        and anulacion.huella_solicitud == huella
        and anulacion.venta_id == venta_id
    ):
        return anulacion.venta
    raise ConflictoVenta("La clave de operacion ya esta asociada a otra solicitud.")


@transaction.atomic
def anular_venta(contexto, venta_id, *, clave_operacion, motivo):
    """Anula una venta y crea una entrada compensatoria por cada detalle."""
    contexto = revalidar_contexto_ventas(contexto, "anular_venta")
    if type(venta_id) is not int or venta_id <= 0:
        raise NotFound("La venta no existe en el negocio autorizado.")
    clave = normalizar_uuid(clave_operacion)
    motivo = normalizar_texto(motivo, campo="motivo", maximo=255, obligatorio=True)
    usuario_id = contexto.membresia.usuario_id
    huella = huella_anulacion(usuario_id, venta_id, motivo)

    venta = Venta.objects.select_for_update().filter(
        pk=venta_id, negocio_id=contexto.negocio.pk,
    ).first()
    if venta is None:
        raise NotFound("La venta no existe en el negocio autorizado.")

    detalles = list(DetalleVenta.objects.filter(venta=venta).order_by("producto_id", "id"))
    existencias = bloquear_existencias(venta.negocio_id, [detalle.producto_id for detalle in detalles])
    contexto = revalidar_contexto_ventas(contexto, "anular_venta")

    repetida = _comprobar_repeticion(
        _anulacion_por_clave(venta.negocio_id, clave),
        usuario_id=usuario_id, huella=huella, venta_id=venta.pk,
    )
    if repetida is not None:
        return repetida
    existente = getattr(venta, "anulacion", None)
    if venta.estado == Venta.Estado.ANULADA or existente is not None:
        raise ConflictoVenta("La venta ya esta anulada.")
    if any(detalle.producto_id not in existencias for detalle in detalles):
        raise ValidationError({"venta_id": "La venta no tiene existencias coherentes para reponer."})

    try:
        with transaction.atomic():
            AnulacionVenta.objects.create(
                negocio=venta.negocio,
                venta=venta,
                usuario=contexto.membresia.usuario,
                motivo=motivo,
                clave_operacion=clave,
                huella_solicitud=huella,
            )
            for detalle in detalles:
                movimiento = aplicar_delta_bloqueado(
                    contexto,
                    existencias[detalle.producto_id],
                    tipo="entrada",
                    delta=detalle.cantidad,
                    motivo=f"Anulacion venta {venta.pk}, detalle {detalle.pk}",
                    clave_operacion=uuid4(),
                    huella_solicitud=huella_movimiento_venta(
                        usuario_id, detalle.pk, "anulacion",
                    ),
                    campo=f"detalles.{detalle.pk}.cantidad",
                )
                VinculoMovimientoVenta.objects.create(
                    negocio=venta.negocio,
                    detalle=detalle,
                    movimiento=movimiento,
                    operacion=VinculoMovimientoVenta.Operacion.ANULACION,
                )
            revalidar_contexto_ventas(contexto, "anular_venta")
            venta.estado = Venta.Estado.ANULADA
            venta.save(update_fields=["estado"])
            return venta
    except IntegrityError as error:
        if es_colision_clave(error, AnulacionVenta, "anulacion_clave_unica_por_negocio"):
            contexto = revalidar_contexto_ventas(contexto, "anular_venta")
            repetida = _comprobar_repeticion(
                _anulacion_por_clave(venta.negocio_id, clave),
                usuario_id=usuario_id, huella=huella, venta_id=venta.pk,
            )
            if repetida is not None:
                return repetida
        raise

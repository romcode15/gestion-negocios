"""Primitivas internas. El servicio invocador autoriza y valida la operación de negocio."""
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import DecimalValidator
from django.db import transaction
from django.db.transaction import TransactionManagementError
from rest_framework.exceptions import ValidationError

from catalogo.models import Producto, tiene_fraccion
from inventario.models import Existencia, MovimientoInventario


MAX_ENTERO_API = 2**53 - 1


def validar_rango_cantidad(valor, campo):
    if not isinstance(valor, Decimal) or not valor.is_finite():
        raise ValidationError({campo: "Usa un Decimal finito."})
    try:
        DecimalValidator(max_digits=14, decimal_places=3)(valor)
    except DjangoValidationError as error:
        raise ValidationError({campo: error.messages}) from error


def _exigir_transaccion(using):
    if not transaction.get_connection(using).in_atomic_block:
        raise TransactionManagementError("Las operaciones de inventario requieren una transacción externa.")


def bloquear_existencias(negocio_id, producto_ids, *, using="default"):
    """Devuelve mapa producto_id→Existencia; faltantes se validan en el servicio."""
    _exigir_transaccion(using)
    ids = list(producto_ids)
    if type(negocio_id) is not int or not 0 < negocio_id <= MAX_ENTERO_API:
        raise ValidationError({"negocio_id": "Usa un ID entero positivo válido."})
    if any(type(pk) is not int or not 0 < pk <= MAX_ENTERO_API for pk in ids):
        raise ValidationError({"producto_id": "Usa IDs enteros positivos válidos."})
    return {fila.producto_id: fila for fila in Existencia.objects.using(using).select_for_update().filter(
        negocio_id=negocio_id, producto_id__in=ids,
    ).order_by("producto_id")}


def aplicar_delta_bloqueado(contexto, existencia, *, tipo, delta, motivo, clave_operacion,
                           huella_solicitud, campo="cantidad"):
    """No valida permiso ni actividad: una anulación autorizada puede devolver inactivos.

    El llamador bloquea primero TODO el conjunto mediante bloquear_existencias,
    revalida acceso/estado y llama en el mismo orden. El savepoint garantiza que
    un fallo de movimiento no deja un saldo parcial aunque el llamador lo capture.
    """
    using = existencia._state.db or "default"
    _exigir_transaccion(using)
    if existencia.negocio_id != contexto.negocio.pk or existencia.pk is None:
        raise ValidationError({"producto_id": "Selecciona un producto del negocio."})
    validar_rango_cantidad(delta, campo)
    if (delta == 0 or tipo not in MovimientoInventario.Tipo.values
            or (tipo == "entrada" and delta < 0) or (tipo == "salida" and delta > 0)):
        raise ValidationError({campo: "El delta debe ser distinto de cero y corresponder al tipo."})
    # Releer bajo bloqueo impide aplicar un saldo de una instancia antigua.
    fila = Existencia.objects.using(using).select_for_update().get(pk=existencia.pk, negocio_id=contexto.negocio.pk)
    producto = Producto.objects.using(using).get(pk=fila.producto_id, negocio_id=fila.negocio_id)
    if producto.unidad == Producto.Unidad.UNIDAD and tiene_fraccion(delta):
        raise ValidationError({campo: "Esta unidad requiere cantidades enteras."})
    saldo = fila.cantidad + delta
    if saldo < 0:
        raise ValidationError({campo: "Saldo insuficiente."})
    validar_rango_cantidad(saldo, campo)
    if fila.version >= MAX_ENTERO_API:
        raise ValidationError({"version_esperada": "Versión fuera de rango."})
    with transaction.atomic(using=using):
        anterior = fila.cantidad
        fila.cantidad = saldo
        fila.version += 1
        fila.save(update_fields=["cantidad", "version"], using=using)
        movimientos = MovimientoInventario.objects if using == "default" else MovimientoInventario.objects.db_manager(using)
        return movimientos.create(
            negocio_id=fila.negocio_id, producto_id=fila.producto_id, usuario_id=contexto.membresia.usuario_id,
            tipo=tipo, cantidad=delta, saldo_anterior=anterior, saldo_posterior=saldo,
            motivo=motivo, clave_operacion=clave_operacion, huella_solicitud=huella_solicitud,
        )

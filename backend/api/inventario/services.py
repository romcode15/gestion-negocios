import json
import re
from decimal import Decimal
from hashlib import sha256
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import NON_FIELD_ERRORS, ValidationError as DjangoValidationError
from django.core.validators import DecimalValidator
from django.db import IntegrityError, transaction
from psycopg.errors import UniqueViolation
from rest_framework.exceptions import ValidationError

from api.common.access import resolver_contexto_negocio
from catalogo.models import Producto, tiene_fraccion
from inventario.models import Existencia, MovimientoInventario

from .exceptions import ConflictoInventario


Tipo = MovimientoInventario.Tipo
_PERMISOS = {
    Tipo.ENTRADA: "registrar_entrada",
    Tipo.SALIDA: "registrar_salida",
    Tipo.AJUSTE: "ajustar_inventario",
}
_PATRON_DECIMAL = re.compile(r"-?[0-9]+(?:\.[0-9]+)?")
_ESCALA = Decimal("0.001")
_VALIDAR_DECIMAL = DecimalValidator(max_digits=14, decimal_places=3)
_MAX_ENTERO_API = 2**53 - 1
_PRODUCTO_INVALIDO = "Selecciona un producto activo del negocio."
_RESTRICCION_CLAVE = "movimiento_clave_unica_por_negocio"


def _validar_rango_decimal(valor, campo):
    try:
        _VALIDAR_DECIMAL(valor)
    except DjangoValidationError as error:
        raise ValidationError({campo: error.messages}) from error


def _normalizar_decimal(valor, campo):
    if isinstance(valor, str) and _PATRON_DECIMAL.fullmatch(valor):
        valor = Decimal(valor)
    if not isinstance(valor, Decimal) or not valor.is_finite():
        raise ValidationError({campo: "Envía una cadena decimal sin coma ni exponentes."})
    _validar_rango_decimal(valor, campo)
    return (valor or Decimal(0)).quantize(_ESCALA)


def _normalizar_cantidad(tipo, cantidad, stock_objetivo, version_esperada):
    if tipo == Tipo.AJUSTE:
        if cantidad is not None:
            raise ValidationError({"cantidad": "Para un ajuste envía el stock objetivo."})
        if type(version_esperada) is not int or not 0 <= version_esperada <= _MAX_ENTERO_API:
            raise ValidationError({"version_esperada": "Envía una versión entera no negativa dentro del rango."})
        objetivo = _normalizar_decimal(stock_objetivo, "stock_objetivo")
        if objetivo < 0:
            raise ValidationError({"stock_objetivo": "El stock objetivo debe ser mayor o igual a cero."})
        return objetivo, "stock_objetivo"

    if stock_objetivo is not None:
        raise ValidationError({"stock_objetivo": "El stock objetivo solo se usa en ajustes."})
    if version_esperada is not None:
        raise ValidationError({"version_esperada": "La versión esperada solo se usa en ajustes."})
    cantidad = _normalizar_decimal(cantidad, "cantidad")
    if cantidad <= 0:
        raise ValidationError({"cantidad": "La cantidad debe ser positiva."})
    return cantidad, "cantidad"


def _normalizar_clave(valor):
    if isinstance(valor, UUID):
        return valor
    if isinstance(valor, str):
        try:
            clave = UUID(valor)
        except ValueError:
            pass
        else:
            if str(clave) == valor.lower():
                return clave
    raise ValidationError({"clave_operacion": "Envía un UUID válido."})


def _normalizar_motivo(motivo):
    motivo = motivo.strip() if isinstance(motivo, str) else ""
    if not 1 <= len(motivo) <= 255 or "\x00" in motivo:
        raise ValidationError({"motivo": "Ingresa un motivo válido de hasta 255 caracteres."})
    try:
        motivo.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValidationError({"motivo": "Ingresa un motivo con caracteres válidos."}) from error
    return motivo


def _revalidar_contexto(contexto, permiso):
    usuario = get_user_model().objects.only("id", "is_active").filter(pk=contexto.membresia.usuario_id).first()
    return resolver_contexto_negocio(usuario, contexto.negocio.pk, permiso)


def _movimiento_confirmado(negocio_id, clave, usuario_id, huella):
    movimiento = MovimientoInventario.objects.filter(negocio_id=negocio_id, clave_operacion=clave).first()
    if movimiento is not None and (movimiento.usuario_id != usuario_id or movimiento.huella_solicitud != huella):
        raise ConflictoInventario("La clave de operación ya está asociada a otra solicitud.")
    return movimiento


def _es_colision_de_clave(error):
    if isinstance(error, IntegrityError):
        causa = error.__cause__
        return isinstance(causa, UniqueViolation) and causa.diag.constraint_name == _RESTRICCION_CLAVE

    # full_clean también detecta la restricción si la otra transacción confirmó antes del INSERT.
    errores = getattr(error, "error_dict", {})
    if set(errores) != {NON_FIELD_ERRORS}:
        return False
    return all(
        detalle.code == "unique_together"
        and (detalle.params or {}).get("model_class") is MovimientoInventario
        and (detalle.params or {}).get("unique_check") == ("negocio", "clave_operacion")
        for detalle in errores[NON_FIELD_ERRORS]
    )


@transaction.atomic
def registrar_movimiento(
    contexto, *, producto_id, tipo, motivo, clave_operacion,
    cantidad=None, stock_objetivo=None, version_esperada=None,
):
    """Confirma un movimiento o devuelve la operación original de una repetición autorizada."""
    if not isinstance(tipo, str) or tipo not in _PERMISOS:
        raise ValidationError({"tipo": "Selecciona entrada, salida o ajuste."})
    permiso = _PERMISOS[tipo]
    contexto = _revalidar_contexto(contexto, permiso)

    if type(producto_id) is not int or not 0 < producto_id <= _MAX_ENTERO_API:
        raise ValidationError({"producto_id": "Envía un ID de producto entero y positivo."})
    motivo = _normalizar_motivo(motivo)
    clave = _normalizar_clave(clave_operacion)
    valor, campo = _normalizar_cantidad(tipo, cantidad, stock_objetivo, version_esperada)
    negocio_id = contexto.negocio.pk
    usuario_id = contexto.membresia.usuario_id
    datos_normalizados = {
        "actor": usuario_id, "producto_id": producto_id, "tipo": tipo, "motivo": motivo, campo: format(valor, ".3f"),
    }
    if tipo == Tipo.AJUSTE:
        datos_normalizados["version_esperada"] = version_esperada
    huella = sha256(json.dumps(datos_normalizados, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    existencia = Existencia.objects.select_for_update().filter(negocio_id=negocio_id, producto_id=producto_id).first()
    # Un cambio de permisos o de estado puede ocurrir mientras esperamos el bloqueo.
    contexto = _revalidar_contexto(contexto, permiso)
    anterior = _movimiento_confirmado(negocio_id, clave, usuario_id, huella)
    if anterior is not None:
        return anterior

    producto = Producto.objects.filter(
        pk=producto_id, negocio_id=negocio_id, activo=True, categoria__negocio_id=negocio_id, categoria__activo=True,
    ).first()
    if producto is None or existencia is None:
        raise ValidationError({"producto_id": _PRODUCTO_INVALIDO})
    if producto.unidad == Producto.Unidad.UNIDAD and tiene_fraccion(valor):
        raise ValidationError({campo: "Esta unidad requiere cantidades enteras."})

    saldo_anterior = existencia.cantidad
    if tipo == Tipo.AJUSTE:
        if version_esperada != existencia.version:
            raise ConflictoInventario("El saldo cambió. Consulta la existencia antes de volver a ajustar.")
        delta = valor - saldo_anterior
        if delta == 0:
            raise ValidationError({campo: "El objetivo debe cambiar el saldo."})
    else:
        delta = -valor if tipo == Tipo.SALIDA else valor

    saldo = saldo_anterior + delta
    if saldo < 0:
        raise ValidationError({campo: "Saldo insuficiente."})
    _validar_rango_decimal(saldo, campo)
    if existencia.version >= _MAX_ENTERO_API:
        raise ValidationError({"version_esperada": "Versión fuera de rango."})

    try:
        with transaction.atomic():
            existencia.cantidad = saldo
            existencia.version += 1
            existencia.save(update_fields=["cantidad", "version"])
            return MovimientoInventario.objects.create(
                negocio=contexto.negocio, producto=producto, usuario=contexto.membresia.usuario, tipo=tipo,
                cantidad=delta, saldo_anterior=saldo_anterior, saldo_posterior=saldo, motivo=motivo,
                clave_operacion=clave, huella_solicitud=huella,
            )
    except (IntegrityError, DjangoValidationError) as error:
        if _es_colision_de_clave(error):
            repetido = _movimiento_confirmado(negocio_id, clave, usuario_id, huella)
            if repetido is not None:
                return repetido
        raise

"""Validación, autorización y huellas compartidas por confirmación/anulación."""
import json
import re
from decimal import Decimal, localcontext
from hashlib import sha256
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import NON_FIELD_ERRORS, ValidationError as DjangoValidationError
from django.db import IntegrityError
from psycopg.errors import UniqueViolation
from rest_framework.exceptions import APIException, ValidationError

from api.common.access import resolver_contexto_negocio
from ventas.decimales import validar_decimal


class ConflictoVenta(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "La operación entra en conflicto con el estado actual de la venta."


def revalidar_contexto_ventas(contexto, permiso):
    usuario = get_user_model().objects.only("id", "is_active").filter(pk=contexto.membresia.usuario_id).first()
    return resolver_contexto_negocio(usuario, contexto.negocio.pk, permiso)


def normalizar_uuid(valor):
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


def normalizar_texto(valor, *, campo, maximo, obligatorio=False):
    if not isinstance(valor, str):
        raise ValidationError({campo: "Envía un texto válido."})
    valor = valor.strip()
    if len(valor) > maximo or (obligatorio and not valor) or "\x00" in valor:
        raise ValidationError({campo: f"Ingresa un texto válido de hasta {maximo} caracteres."})
    try:
        valor.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValidationError({campo: "Ingresa un texto con caracteres válidos."}) from error
    return valor


def normalizar_decimal(valor, *, campo, digitos, escala, positivo=False):
    # DRF puede entregar un Decimal validado; las llamadas internas también
    # admiten la cadena del contrato, nunca números binarios/int/bool.
    if isinstance(valor, str):
        if not re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", valor):
            raise ValidationError({campo: "Envía una cadena decimal sin coma ni exponentes."})
        valor = Decimal(valor)
    if not isinstance(valor, Decimal):
        raise ValidationError({campo: "Envía una cadena decimal sin coma ni exponentes."})
    try:
        validar_decimal(valor, campo=campo, digitos=digitos, escala=escala, positivo=positivo)
    except DjangoValidationError as error:
        raise ValidationError(error.message_dict) from error
    with localcontext() as ctx:
        ctx.prec = 40
        return (valor or Decimal(0)).quantize(Decimal(1).scaleb(-escala))


def es_colision_clave(error, modelo, restriccion):
    """Solo la unicidad de clave; no convertir otros fallos en un conflicto."""
    if isinstance(error, IntegrityError):
        causa = error.__cause__
        return isinstance(causa, UniqueViolation) and causa.diag.constraint_name == restriccion
    errores = getattr(error, "error_dict", {})
    if set(errores) != {NON_FIELD_ERRORS}:
        return False
    return bool(errores[NON_FIELD_ERRORS]) and all(
        detalle.code == "unique_together"
        and (detalle.params or {}).get("model_class") is modelo
        and (detalle.params or {}).get("unique_check") == ("negocio", "clave_operacion")
        for detalle in errores[NON_FIELD_ERRORS]
    )


def _huella(datos):
    return sha256(json.dumps(datos, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def huella_venta(vendedor_id, detalles, observaciones=""):
    """Recibe líneas ya validadas con cantidad/precio esperado Decimal."""
    return _huella({
        "actor": vendedor_id,
        "observaciones": observaciones.strip(),
        "detalles": [{
            "producto_id": linea["producto_id"], "cantidad": format(linea["cantidad"], ".3f"),
            "precio_unitario_esperado": format(linea["precio_unitario_esperado"], ".2f"),
        } for linea in sorted(detalles, key=lambda fila: fila["producto_id"])],
    })


def huella_anulacion(usuario_id, venta_id, motivo):
    return _huella({"actor": usuario_id, "venta_id": venta_id, "motivo": motivo.strip()})


def huella_movimiento_venta(usuario_id, detalle_id, operacion):
    return _huella({"actor": usuario_id, "detalle_id": detalle_id, "operacion": operacion})

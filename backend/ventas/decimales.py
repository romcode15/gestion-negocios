"""Importes de dominio; no admite aproximaciones binarias ni redondea entradas."""
from decimal import Decimal, ROUND_HALF_UP, localcontext

from django.core.exceptions import ValidationError
from django.core.validators import DecimalValidator


def validar_decimal(valor, *, campo, digitos, escala, positivo=False):
    if not isinstance(valor, Decimal) or not valor.is_finite():
        raise ValidationError({campo: "Usa un Decimal finito."})
    try:
        DecimalValidator(digitos, escala)(valor)
    except ValidationError as error:
        raise ValidationError({campo: error.messages}) from error
    if valor < 0 or (positivo and valor == 0):
        raise ValidationError({campo: "El valor debe ser positivo." if positivo else "El valor no puede ser negativo."})
    return valor


def calcular_subtotal(cantidad, precio_unitario):
    validar_decimal(cantidad, campo="cantidad", digitos=14, escala=3, positivo=True)
    validar_decimal(precio_unitario, campo="precio_unitario", digitos=12, escala=2)
    # Independiente de la precisión/redondeo del contexto Decimal de quien llama.
    with localcontext() as contexto:
        contexto.prec = 40
        subtotal = (cantidad * precio_unitario).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return validar_decimal(subtotal, campo="subtotal", digitos=14, escala=2)

"""B2: confirma una venta completa o devuelve su repetición autorizada."""
from collections.abc import Mapping
from decimal import Decimal, localcontext
from uuid import uuid4

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from catalogo.models import Producto, tiene_fraccion
from inventario.operaciones import MAX_ENTERO_API, aplicar_delta_bloqueado, bloquear_existencias
from ventas.decimales import calcular_subtotal, validar_decimal
from ventas.models import DetalleVenta, Venta, VinculoMovimientoVenta

from .common import (ConflictoVenta, es_colision_clave, huella_movimiento_venta, huella_venta,
                     normalizar_decimal, normalizar_texto, normalizar_uuid, revalidar_contexto_ventas)


_CAMPOS_LINEA = {"producto_id", "cantidad", "precio_unitario_esperado"}
_RESTRICCION_CLAVE = "venta_clave_unica_por_negocio"
_PRODUCTO_INVALIDO = "Selecciona un producto activo del negocio."


def _normalizar_detalles(detalles):
    if not isinstance(detalles, list) or not 1 <= len(detalles) <= 100:
        raise ValidationError({"detalles": "Incluye entre 1 y 100 productos distintos."})
    errores, normalizados, vistos = {}, [], set()
    for indice, linea in enumerate(detalles):
        prefijo = f"detalles.{indice}"
        if not isinstance(linea, Mapping):
            errores[prefijo] = ["Envía un objeto con producto, cantidad y precio esperado."]
            continue
        for campo in linea.keys() - _CAMPOS_LINEA:
            errores[f"{prefijo}.{campo}"] = ["Campo no permitido."]
        for campo in _CAMPOS_LINEA - linea.keys():
            errores[f"{prefijo}.{campo}"] = ["Este campo es obligatorio."]
        producto_id = linea.get("producto_id")
        if "producto_id" in linea:
            if type(producto_id) is not int or not 0 < producto_id <= MAX_ENTERO_API:
                errores[f"{prefijo}.producto_id"] = ["Envía un ID entero JSON positivo y seguro."]
            elif producto_id in vistos:
                errores[f"{prefijo}.producto_id"] = ["El producto ya aparece en otra línea."]
            else:
                vistos.add(producto_id)
        normalizada = {"indice": indice, "producto_id": producto_id}
        for campo, digitos, escala, positivo in [("cantidad", 14, 3, True), ("precio_unitario_esperado", 12, 2, False)]:
            if campo not in linea:
                continue
            try:
                normalizada[campo] = normalizar_decimal(
                    linea[campo], campo=f"{prefijo}.{campo}", digitos=digitos, escala=escala, positivo=positivo,
                )
            except ValidationError as error:
                errores.update(error.detail)
        normalizados.append(normalizada)
    if errores:
        raise ValidationError(errores)
    return sorted(normalizados, key=lambda linea: linea["producto_id"])


def _venta_confirmada(negocio_id, clave, usuario_id, huella):
    venta = Venta.objects.filter(negocio_id=negocio_id, clave_operacion=clave).first()
    if venta is not None and (venta.vendedor_id != usuario_id or venta.huella_solicitud != huella):
        raise ConflictoVenta("La clave de operación ya está asociada a otra solicitud.")
    return venta


def _preparar_lineas(negocio_id, lineas, existencias):
    productos = {p.pk: p for p in Producto.objects.filter(
        negocio_id=negocio_id, categoria__negocio_id=negocio_id, activo=True, categoria__activo=True,
        pk__in=[linea["producto_id"] for linea in lineas],
    ).select_related("categoria")}
    preparadas, total = [], Decimal("0.00")
    for linea in lineas:
        prefijo = f"detalles.{linea['indice']}"
        producto = productos.get(linea["producto_id"])
        existencia = existencias.get(linea["producto_id"])
        if producto is None or existencia is None:
            raise ValidationError({f"{prefijo}.producto_id": _PRODUCTO_INVALIDO})
        cantidad = linea["cantidad"]
        if producto.unidad == Producto.Unidad.UNIDAD and tiene_fraccion(cantidad):
            raise ValidationError({f"{prefijo}.cantidad": "Esta unidad requiere cantidades enteras."})
        if producto.precio_venta != linea["precio_unitario_esperado"]:
            raise ConflictoVenta("El precio de uno de los productos cambió. Revisa los precios antes de confirmar.")
        if cantidad > existencia.cantidad:
            raise ValidationError({f"{prefijo}.cantidad": "Saldo insuficiente."})
        if existencia.version >= MAX_ENTERO_API:
            raise ValidationError({f"{prefijo}.producto_id": "La versión de la existencia está fuera de rango."})
        try:
            subtotal = calcular_subtotal(cantidad, producto.precio_venta)
        except DjangoValidationError as error:
            raise ValidationError({f"{prefijo}.cantidad": "El importe de la línea está fuera de rango."}) from error
        total += subtotal
        preparadas.append((linea, producto, existencia, subtotal))
    try:
        validar_decimal(total, campo="detalles", digitos=14, escala=2)
    except DjangoValidationError as error:
        raise ValidationError({"detalles": "El total de la venta está fuera de rango."}) from error
    return preparadas, total


@transaction.atomic
def confirmar_venta(contexto, *, detalles, clave_operacion, observaciones=""):
    """detalles usa el contrato público (strings) o Decimal ya validado por DRF.

    No reserva stock ni publica una API. Todas las escrituras quedan dentro de
    la misma transacción; B5 adapta entradas/respuestas y conserva 201 en replay.
    """
    contexto = revalidar_contexto_ventas(contexto, "registrar_venta")
    clave = normalizar_uuid(clave_operacion)
    observaciones = normalizar_texto(observaciones, campo="observaciones", maximo=500)
    lineas = _normalizar_detalles(detalles)
    negocio_id, usuario_id = contexto.negocio.pk, contexto.membresia.usuario_id
    huella = huella_venta(usuario_id, lineas, observaciones)
    anterior = _venta_confirmada(negocio_id, clave, usuario_id, huella)
    if anterior is not None:
        return anterior

    existencias = bloquear_existencias(negocio_id, [linea["producto_id"] for linea in lineas])
    contexto = revalidar_contexto_ventas(contexto, "registrar_venta")
    # Otro intento pudo confirmar mientras esperábamos las existencias.
    anterior = _venta_confirmada(negocio_id, clave, usuario_id, huella)
    if anterior is not None:
        return anterior

    with localcontext() as precision:
        precision.prec = 40
        preparadas, total = _preparar_lineas(negocio_id, lineas, existencias)
        try:
            with transaction.atomic():
                venta = Venta.objects.create(
                    negocio=contexto.negocio, vendedor=contexto.membresia.usuario, total=total,
                    observaciones=observaciones, clave_operacion=clave, huella_solicitud=huella,
                )
                for linea, producto, existencia, subtotal in preparadas:
                    detalle = DetalleVenta.objects.create(
                        negocio=contexto.negocio, venta=venta, producto=producto, sku=producto.sku,
                        nombre=producto.nombre, unidad=producto.unidad, cantidad=linea["cantidad"],
                        precio_unitario=producto.precio_venta, subtotal=subtotal,
                    )
                    movimiento = aplicar_delta_bloqueado(
                        contexto, existencia, tipo="salida", delta=-linea["cantidad"],
                        motivo=f"Venta {venta.pk}, detalle {detalle.pk}", clave_operacion=uuid4(),
                        huella_solicitud=huella_movimiento_venta(usuario_id, detalle.pk, "venta"),
                        campo=f"detalles.{linea['indice']}.cantidad",
                    )
                    VinculoMovimientoVenta.objects.create(
                        negocio=contexto.negocio, detalle=detalle, movimiento=movimiento, operacion="venta",
                    )
                # La unicidad/FK de un INSERT también puede haber esperado.
                # Si el acceso cambió durante la escritura, revertir el conjunto.
                revalidar_contexto_ventas(contexto, "registrar_venta")
                return venta
        except (IntegrityError, DjangoValidationError) as error:
            if es_colision_clave(error, Venta, _RESTRICCION_CLAVE):
                # El savepoint ya revirtió las escrituras del perdedor. La
                # espera por unicidad también exige revalidar el acceso actual.
                contexto = revalidar_contexto_ventas(contexto, "registrar_venta")
                repetida = _venta_confirmada(negocio_id, clave, usuario_id, huella)
                if repetida is not None:
                    return repetida
            raise

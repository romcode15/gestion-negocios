from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, transaction
from django.db.models import F, Q
from django.db.models.functions import Floor

from accesos.models import Membresia
from catalogo.models import ModeloDeNegocio, PATRON_SKU, Producto, tiene_fraccion
from inventario.models import MovimientoInventario

from .decimales import calcular_subtotal


HUELLA_VALIDA = r"^[0-9a-f]{64}$"


def validar_miembro(usuario_id, negocio_id, campo):
    # La vigencia y los permisos se revalidan en los servicios. La relación
    # histórica admite que el usuario o su membresía se desactiven después.
    if usuario_id and negocio_id and not Membresia.objects.filter(usuario_id=usuario_id, negocio_id=negocio_id).exists():
        raise ValidationError({campo: "La cuenta debe pertenecer al negocio del registro."})


class HistoricoInmutable(ModeloDeNegocio):
    class Meta:
        abstract = True

    def save(self, *, force_insert=False, force_update=False, using=None, update_fields=None):
        if not self._state.adding or force_update or update_fields is not None:
            raise ValidationError("Un registro histórico existente no se puede editar.")
        return super().save(force_insert=True, using=using)

    def delete(self, *args, **kwargs):
        raise ValidationError("Un registro histórico no se puede borrar.")


class Venta(ModeloDeNegocio):
    class Estado(models.TextChoices):
        CONFIRMADA = "confirmada", "Confirmada"
        ANULADA = "anulada", "Anulada"

    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="ventas")
    vendedor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="ventas")
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.CONFIRMADA)
    observaciones = models.CharField(max_length=500, blank=True, default="")
    total = models.DecimalField(max_digits=14, decimal_places=2)
    clave_operacion = models.UUIDField()
    huella_solicitud = models.CharField(max_length=64, editable=False, validators=[RegexValidator(HUELLA_VALIDA)])
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-creado_en", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["negocio", "clave_operacion"], name="venta_clave_unica_por_negocio"),
            models.CheckConstraint(condition=Q(estado__in=["confirmada", "anulada"]), name="venta_estado_valido"),
            models.CheckConstraint(condition=Q(total__gte=0), name="venta_total_no_negativo"),
            models.CheckConstraint(condition=Q(huella_solicitud__regex=HUELLA_VALIDA), name="venta_huella_valida"),
        ]

    def clean_fields(self, exclude=None):
        if isinstance(self.observaciones, str):
            self.observaciones = self.observaciones.strip()
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        anterior = type(self).objects.filter(pk=self.pk).values().first() if self.pk is not None else None
        if anterior is None:
            validar_miembro(self.vendedor_id, self.negocio_id, "vendedor")
            if self.estado != self.Estado.CONFIRMADA:
                raise ValidationError({"estado": "Una venta nueva debe nacer confirmada."})
            return
        campos = ("negocio_id", "vendedor_id", "observaciones", "total", "clave_operacion", "huella_solicitud", "creado_en")
        if any(getattr(self, campo) != anterior[campo] for campo in campos):
            raise ValidationError("El encabezado de una venta confirmada es inmutable.")
        if self.estado != anterior["estado"]:
            if anterior["estado"] != self.Estado.CONFIRMADA or self.estado != self.Estado.ANULADA:
                raise ValidationError({"estado": "Solo se permite pasar de confirmada a anulada."})
            if not transaction.get_connection(self._state.db).in_atomic_block:
                raise ValidationError({"estado": "La anulación requiere una transacción."})
            if not AnulacionVenta.objects.filter(venta_id=self.pk, negocio_id=self.negocio_id).exists():
                raise ValidationError({"estado": "La anulación requiere su registro de auditoría."})

    def delete(self, *args, **kwargs):
        raise ValidationError("Una venta confirmada no se puede borrar.")


class DetalleVenta(HistoricoInmutable):
    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="detalles_venta")
    venta = models.ForeignKey(Venta, on_delete=models.PROTECT, related_name="detalles")
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT, related_name="detalles_venta")
    sku = models.CharField(max_length=50, validators=[RegexValidator(PATRON_SKU)])
    nombre = models.CharField(max_length=150)
    unidad = models.CharField(max_length=6, choices=Producto.Unidad.choices)
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["venta", "producto"], name="detalle_venta_producto_unico"),
            models.CheckConstraint(condition=Q(cantidad__gt=0), name="detalle_venta_cantidad_positiva"),
            models.CheckConstraint(condition=Q(precio_unitario__gte=0), name="detalle_venta_precio_no_negativo"),
            models.CheckConstraint(condition=Q(subtotal__gte=0), name="detalle_venta_subtotal_no_negativo"),
            models.CheckConstraint(condition=Q(unidad__in=["unidad", "kg", "litro"]), name="detalle_venta_unidad_valida"),
            models.CheckConstraint(condition=Q(sku__regex=PATRON_SKU), name="detalle_venta_sku_valido"),
            models.CheckConstraint(condition=~Q(unidad="unidad") | Q(cantidad=Floor("cantidad")), name="detalle_venta_unidades_enteras"),
            models.CheckConstraint(condition=Q(subtotal=models.Func(
                F("cantidad") * F("precio_unitario"), 2, function="ROUND",
                output_field=models.DecimalField(max_digits=14, decimal_places=2),
            )), name="detalle_venta_subtotal_calculado"),
        ]

    def clean_fields(self, exclude=None):
        for campo in ("sku", "nombre"):
            valor = getattr(self, campo)
            if isinstance(valor, str):
                setattr(self, campo, valor.strip())
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        venta = Venta.objects.filter(pk=self.venta_id).values("negocio_id", "estado").first()
        producto = Producto.objects.filter(pk=self.producto_id).values("negocio_id", "unidad").first()
        errores = {}
        if venta and venta["negocio_id"] != self.negocio_id:
            errores["venta"] = "La venta debe pertenecer al mismo negocio."
        if venta and venta["estado"] != Venta.Estado.CONFIRMADA:
            errores["venta"] = "No se agregan líneas a una venta anulada."
        if producto and (producto["negocio_id"] != self.negocio_id or producto["unidad"] != self.unidad):
            errores["producto"] = "El producto debe pertenecer al negocio y conservar la unidad del snapshot."
        if self.unidad == Producto.Unidad.UNIDAD and tiene_fraccion(self.cantidad):
            errores["cantidad"] = "La cantidad debe ser entera para productos por unidad."
        try:
            esperado = calcular_subtotal(self.cantidad, self.precio_unitario)
        except ValidationError as error:
            errores.update(error.message_dict)
        else:
            if self.subtotal != esperado:
                errores["subtotal"] = "El subtotal debe coincidir con cantidad × precio redondeado HALF_UP."
        if errores:
            raise ValidationError(errores)


class AnulacionVenta(HistoricoInmutable):
    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="anulaciones_venta")
    venta = models.OneToOneField(Venta, on_delete=models.PROTECT, related_name="anulacion")
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="anulaciones_venta")
    motivo = models.CharField(max_length=255)
    clave_operacion = models.UUIDField()
    huella_solicitud = models.CharField(max_length=64, editable=False, validators=[RegexValidator(HUELLA_VALIDA)])
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["negocio", "clave_operacion"], name="anulacion_clave_unica_por_negocio"),
            models.CheckConstraint(condition=Q(huella_solicitud__regex=HUELLA_VALIDA), name="anulacion_huella_valida"),
            models.CheckConstraint(condition=~Q(motivo=""), name="anulacion_motivo_no_vacio"),
        ]

    def clean_fields(self, exclude=None):
        if isinstance(self.motivo, str):
            self.motivo = self.motivo.strip()
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        validar_miembro(self.usuario_id, self.negocio_id, "usuario")
        venta = Venta.objects.filter(pk=self.venta_id).values("negocio_id", "estado").first()
        if venta and venta["negocio_id"] != self.negocio_id:
            raise ValidationError({"venta": "La venta debe pertenecer al mismo negocio."})
        if venta and venta["estado"] != Venta.Estado.CONFIRMADA:
            raise ValidationError({"venta": "La venta ya está anulada."})


class VinculoMovimientoVenta(HistoricoInmutable):
    class Operacion(models.TextChoices):
        VENTA = "venta", "Venta"
        ANULACION = "anulacion", "Anulación"

    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="vinculos_ventas")
    detalle = models.ForeignKey(DetalleVenta, on_delete=models.PROTECT, related_name="vinculos_movimientos")
    operacion = models.CharField(max_length=9, choices=Operacion.choices)
    movimiento = models.OneToOneField(MovimientoInventario, on_delete=models.PROTECT, related_name="vinculo_venta")

    class Meta:
        ordering = ["movimiento__creado_en", "movimiento_id"]
        constraints = [
            models.UniqueConstraint(fields=["detalle", "operacion"], name="vinculo_detalle_operacion_unico"),
            models.CheckConstraint(condition=Q(operacion__in=["venta", "anulacion"]), name="vinculo_operacion_valida"),
        ]

    def clean(self):
        super().clean()
        detalle = DetalleVenta.objects.filter(pk=self.detalle_id).values("negocio_id", "producto_id", "cantidad", "venta_id", "venta__vendedor_id").first()
        movimiento = MovimientoInventario.objects.filter(pk=self.movimiento_id).values("negocio_id", "producto_id", "tipo", "cantidad", "usuario_id").first()
        if detalle and detalle["negocio_id"] != self.negocio_id:
            raise ValidationError({"detalle": "El detalle debe pertenecer al mismo negocio."})
        if movimiento and movimiento["negocio_id"] != self.negocio_id:
            raise ValidationError({"movimiento": "El movimiento debe pertenecer al mismo negocio."})
        if detalle and movimiento:
            tipo = "salida" if self.operacion == self.Operacion.VENTA else "entrada"
            delta = -detalle["cantidad"] if self.operacion == self.Operacion.VENTA else detalle["cantidad"]
            if (movimiento["producto_id"], movimiento["tipo"], movimiento["cantidad"]) != (detalle["producto_id"], tipo, delta):
                raise ValidationError({"movimiento": "El producto, tipo y delta deben coincidir con el detalle y la operación."})
            actor = detalle["venta__vendedor_id"]
            if self.operacion == self.Operacion.ANULACION:
                actor = AnulacionVenta.objects.filter(venta_id=detalle["venta_id"]).values_list("usuario_id", flat=True).first()
            if actor is None or actor != movimiento["usuario_id"]:
                raise ValidationError({"movimiento": "El actor debe coincidir con la venta o su anulación auditada."})

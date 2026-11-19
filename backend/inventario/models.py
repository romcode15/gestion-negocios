from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from catalogo.models import ModeloDeNegocio, Producto, tiene_fraccion


class RegistroDeProducto(ModeloDeNegocio):
    class Meta:
        abstract = True

    def clean(self):
        super().clean()
        if not isinstance(self.producto_id, int):
            return
        producto = Producto.objects.filter(pk=self.producto_id).values("negocio_id", "unidad").first()
        if producto is None:
            return
        if producto["negocio_id"] != self.negocio_id:
            raise ValidationError({"producto": "El producto debe pertenecer al mismo negocio que el registro."})
        if producto["unidad"] == Producto.Unidad.UNIDAD:
            errores = {
                campo: "La cantidad debe ser entera para productos por unidad."
                for campo in self.campos_cantidad if tiene_fraccion(getattr(self, campo))
            }
            if errores:
                raise ValidationError(errores)


class Existencia(RegistroDeProducto):
    campos_cantidad = ("cantidad",)

    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="existencias")
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT, related_name="existencias")
    cantidad = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0.000"))
    version = models.BigIntegerField(default=0)

    class Meta:
        ordering = ["producto_id"]
        constraints = [
            models.UniqueConstraint(fields=["negocio", "producto"], name="existencia_unica_por_negocio_producto"),
            models.CheckConstraint(condition=Q(cantidad__gte=0), name="existencia_cantidad_no_negativa"),
            models.CheckConstraint(condition=Q(version__gte=0), name="existencia_version_no_negativa"),
        ]


class MovimientoInventario(RegistroDeProducto):
    class Tipo(models.TextChoices):
        ENTRADA = "entrada", "Entrada"
        SALIDA = "salida", "Salida"
        AJUSTE = "ajuste", "Ajuste"

    campos_cantidad = ("cantidad", "saldo_anterior", "saldo_posterior")

    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="movimientos")
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT, related_name="movimientos")
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="movimientos_inventario")
    tipo = models.CharField(max_length=7, choices=Tipo.choices)
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    saldo_anterior = models.DecimalField(max_digits=14, decimal_places=3)
    saldo_posterior = models.DecimalField(max_digits=14, decimal_places=3)
    motivo = models.CharField(max_length=255)
    clave_operacion = models.UUIDField()
    huella_solicitud = models.CharField(max_length=64, editable=False)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-creado_en", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["negocio", "clave_operacion"], name="movimiento_clave_unica_por_negocio"),
            models.CheckConstraint(condition=Q(tipo__in=["entrada", "salida", "ajuste"]), name="movimiento_tipo_valido"),
            models.CheckConstraint(condition=~Q(cantidad=0), name="movimiento_delta_no_cero"),
            models.CheckConstraint(
                condition=~Q(tipo="entrada") | Q(cantidad__gt=0), name="movimiento_entrada_positiva",
            ),
            models.CheckConstraint(
                condition=~Q(tipo="salida") | Q(cantidad__lt=0), name="movimiento_salida_negativa",
            ),
            models.CheckConstraint(
                condition=Q(saldo_anterior__gte=0, saldo_posterior__gte=0), name="movimiento_saldos_no_negativos",
            ),
            models.CheckConstraint(
                condition=Q(saldo_posterior=F("saldo_anterior") + F("cantidad")), name="movimiento_delta_concilia_saldos",
            ),
            models.CheckConstraint(
                condition=Q(huella_solicitud__regex=r"^[0-9a-f]{64}$"), name="movimiento_huella_sha256_valida",
            ),
        ]

    def clean_fields(self, exclude=None):
        if isinstance(self.motivo, str):
            self.motivo = self.motivo.strip()
        super().clean_fields(exclude=exclude)

    def save(self, *, force_insert=False, force_update=False, using=None, update_fields=None):
        if not self._state.adding or force_update or update_fields is not None:
            raise ValidationError("Un movimiento existente no se puede editar.")
        return super().save(force_insert=True, using=using)

    def delete(self, *args, **kwargs):
        raise ValidationError("Un movimiento existente no se puede borrar.")

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q
from django.db.models.functions import Floor

from accesos.models import ModeloValidado


PATRON_SKU = r"^[A-Z0-9][A-Z0-9._-]{0,49}$"


def tiene_fraccion(valor):
    return isinstance(valor, Decimal) and valor.is_finite() and valor != valor.to_integral_value()


class ModeloDeNegocio(ModeloValidado):
    """Conserva el negocio de cada registro guardado."""

    class Meta:
        abstract = True

    def clean(self):
        super().clean()
        if self.pk is not None:
            negocio_anterior = type(self).objects.filter(pk=self.pk).values_list("negocio_id", flat=True).first()
            if negocio_anterior is not None and negocio_anterior != self.negocio_id:
                raise ValidationError({"negocio": "El negocio de un registro existente no se puede cambiar."})


class Categoria(ModeloDeNegocio):
    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="categorias")
    nombre = models.CharField(max_length=150)
    descripcion = models.CharField(max_length=500, blank=True, default="")
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["negocio", "nombre"], name="categoria_nombre_unico_por_negocio"),
        ]

    def clean_fields(self, exclude=None):
        if isinstance(self.nombre, str):
            self.nombre = self.nombre.strip()
        if isinstance(self.descripcion, str):
            self.descripcion = self.descripcion.strip()
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        if self.pk is not None and self.activo is False and self.productos.filter(activo=True).exists():
            raise ValidationError({"activo": "Desactiva los productos activos antes de desactivar la categoría."})

    def __str__(self):
        return self.nombre


class Producto(ModeloDeNegocio):
    class Unidad(models.TextChoices):
        UNIDAD = "unidad", "Unidad"
        KG = "kg", "Kilogramo"
        LITRO = "litro", "Litro"

    negocio = models.ForeignKey("negocios.Negocio", on_delete=models.PROTECT, related_name="productos")
    categoria = models.ForeignKey(Categoria, on_delete=models.PROTECT, related_name="productos")
    sku = models.CharField(max_length=50, validators=[RegexValidator(PATRON_SKU, "Ingresa un SKU válido.")])
    nombre = models.CharField(max_length=150)
    descripcion = models.CharField(max_length=500, blank=True, default="")
    unidad = models.CharField(max_length=6, choices=Unidad.choices)
    precio_venta = models.DecimalField(max_digits=12, decimal_places=2)
    stock_minimo = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0.000"))
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["negocio", "sku"], name="producto_sku_unico_por_negocio"),
            models.CheckConstraint(condition=Q(sku__regex=PATRON_SKU), name="producto_sku_valido"),
            models.CheckConstraint(condition=Q(unidad__in=["unidad", "kg", "litro"]), name="producto_unidad_valida"),
            models.CheckConstraint(condition=Q(precio_venta__gte=0), name="producto_precio_no_negativo"),
            models.CheckConstraint(condition=Q(stock_minimo__gte=0), name="producto_stock_minimo_no_negativo"),
            models.CheckConstraint(
                condition=~Q(unidad="unidad") | Q(stock_minimo=Floor("stock_minimo")),
                name="producto_stock_minimo_entero_por_unidad",
            ),
        ]

    def clean_fields(self, exclude=None):
        if isinstance(self.nombre, str):
            self.nombre = self.nombre.strip()
        if isinstance(self.descripcion, str):
            self.descripcion = self.descripcion.strip()
        if isinstance(self.sku, str):
            self.sku = self.sku.strip().upper()
        super().clean_fields(exclude=exclude)

    def clean(self):
        super().clean()
        anterior = None
        if self.pk is not None:
            anterior = type(self).objects.filter(pk=self.pk).values("categoria_id", "unidad").first()
        categoria = None
        if isinstance(self.categoria_id, int):
            categoria = Categoria.objects.filter(pk=self.categoria_id).values("negocio_id", "activo").first()

        errores = {}
        if categoria is not None:
            if categoria["negocio_id"] != self.negocio_id:
                errores["categoria"] = "La categoría debe pertenecer al mismo negocio que el producto."
            elif not categoria["activo"] and (
                anterior is None or self.activo or anterior["categoria_id"] != self.categoria_id
            ):
                errores["categoria"] = "Selecciona una categoría activa."
        if self.unidad == self.Unidad.UNIDAD and tiene_fraccion(self.stock_minimo):
            errores["stock_minimo"] = "El stock mínimo debe ser entero para productos por unidad."
        if anterior is not None and anterior["unidad"] != self.unidad and self.movimientos.exists():
            errores["unidad"] = "La unidad no se puede cambiar después del primer movimiento."
        if errores:
            raise ValidationError(errores)

    def __str__(self):
        return self.sku

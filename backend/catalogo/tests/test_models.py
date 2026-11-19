from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase

from catalogo.models import Categoria, Producto
from inventario.models import Existencia
from negocios.models import Negocio
from tests.support.fase2 import crear_producto_prueba


class CatalogoTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.tienda = Negocio.objects.create(nombre="Tienda", tipo="tienda")
        cls.otro = Negocio.objects.create(nombre="Otro", tipo="tienda")

    def test_categoria_recorta_nombre_y_descripcion_y_es_unica_por_negocio(self):
        categoria = Categoria.objects.create(negocio=self.tienda, nombre="  Bebidas  ", descripcion="  Frías  ")
        self.assertEqual((categoria.nombre, categoria.descripcion, categoria.activo), ("Bebidas", "Frías", True))
        Categoria.objects.create(negocio=self.otro, nombre="Bebidas")
        Categoria.objects.create(negocio=self.tienda, nombre="BEBIDAS")
        with self.assertRaises(ValidationError):
            Categoria.objects.create(negocio=self.tienda, nombre=" Bebidas ")
        with self.assertRaises(ValidationError):
            Categoria.objects.create(negocio=self.tienda, nombre=" \t ")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Categoria.objects.bulk_create([Categoria(negocio=self.tienda, nombre="Bebidas")])

    def test_sku_canonico_y_unico_por_negocio(self):
        producto = crear_producto_prueba(self.tienda, sku="  a-001.2_  ", nombre="  Agua  ", descripcion="  Mineral  ")
        self.assertEqual((producto.sku, producto.nombre, producto.descripcion), ("A-001.2_", "Agua", "Mineral"))
        crear_producto_prueba(self.otro, sku="A-001.2_", nombre="Agua")
        with self.assertRaises(ValidationError):
            crear_producto_prueba(self.tienda, sku="  a-001.2_  ")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Producto.objects.filter(pk=producto.pk).update(sku="minúsculas")
        duplicado = crear_producto_prueba(self.tienda)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Producto.objects.filter(pk=duplicado.pk).update(sku=producto.sku)

    def test_producto_rechaza_categoria_ajena_y_negocio_inmutable(self):
        producto = crear_producto_prueba(self.tienda)
        categoria_ajena = Categoria.objects.create(negocio=self.otro, nombre="Otra")
        with self.assertRaisesMessage(ValidationError, "La categoría debe pertenecer al mismo negocio"):
            crear_producto_prueba(self.tienda, categoria=categoria_ajena)
        producto.negocio = self.otro
        producto.categoria = categoria_ajena
        with self.assertRaisesMessage(ValidationError, "El negocio de un registro existente no se puede cambiar"):
            producto.save()
        self.assertEqual(Producto.objects.get(pk=producto.pk).negocio_id, self.tienda.pk)

        categoria = Categoria.objects.get(negocio=self.tienda)
        categoria.negocio = self.otro
        with self.assertRaisesMessage(ValidationError, "El negocio de un registro existente no se puede cambiar"):
            categoria.save()
        with self.assertRaises(ProtectedError):
            Categoria.objects.get(pk=categoria.pk).delete()

    def test_categoria_inactiva_permite_editar_producto_inactivo_sin_moverlo_ni_reactivarlo(self):
        producto = crear_producto_prueba(self.tienda)
        categoria = producto.categoria
        categoria.activo = False
        with self.assertRaisesMessage(ValidationError, "Desactiva los productos activos"):
            categoria.save()
        producto.activo = False
        producto.save()
        categoria.save()
        producto.nombre = "Agua archivada"
        producto.save()
        producto.activo = True
        with self.assertRaisesMessage(ValidationError, "Selecciona una categoría activa"):
            producto.save()
        with self.assertRaisesMessage(ValidationError, "Selecciona una categoría activa"):
            crear_producto_prueba(self.tienda, categoria=categoria)
        otra = Categoria.objects.create(negocio=self.tienda, nombre="Archivo", activo=False)
        producto.activo = False
        producto.categoria = otra
        with self.assertRaisesMessage(ValidationError, "Selecciona una categoría activa"):
            producto.save()

    def test_precio_stock_minimo_y_unidad_respetan_precision_y_rango(self):
        for datos in (
            {"sku": "-invalido"}, {"unidad": "caja"}, {"precio_venta": Decimal("-0.01")},
            {"precio_venta": Decimal("1.001")}, {"precio_venta": Decimal("10000000000.00")},
            {"stock_minimo": Decimal("0.125")}, {"unidad": "kg", "stock_minimo": Decimal("-0.125")},
            {"unidad": "litro", "stock_minimo": Decimal("0.0001")},
        ):
            with self.subTest(datos=datos), self.assertRaises(ValidationError):
                crear_producto_prueba(self.tienda, **datos)
        self.assertFalse(Categoria.objects.filter(negocio=self.tienda).exists())
        self.assertFalse(Producto.objects.exists())
        self.assertFalse(Existencia.objects.exists())

        producto = crear_producto_prueba(self.tienda, unidad="kg", stock_minimo=Decimal("0.125"))
        self.assertEqual(producto.stock_minimo, Decimal("0.125"))
        with self.assertRaises(IntegrityError), transaction.atomic():
            Producto.objects.filter(pk=producto.pk).update(unidad="unidad")

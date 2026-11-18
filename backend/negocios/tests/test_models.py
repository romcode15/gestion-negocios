from django.core.exceptions import ValidationError
from django.test import TestCase

from negocios.models import Negocio


class NegocioTests(TestCase):
    def test_campos_requeridos_y_estado_inicial(self):
        for campo in ("nombre", "tipo"):
            with self.subTest(campo=campo), self.assertRaises(ValidationError):
                datos = {"nombre": "Tienda", "tipo": "tienda", campo: ""}
                Negocio.objects.create(**datos)
        negocio = Negocio.objects.create(nombre="Tienda", tipo="tienda")
        self.assertTrue(negocio.activo)
        self.assertIsInstance(negocio.pk, int)

    def test_nombre_no_es_identificador_unico_del_tenant(self):
        primero = Negocio.objects.create(nombre="Centro", tipo="tienda")
        segundo = Negocio.objects.create(nombre="Centro", tipo="ferreteria")
        self.assertNotEqual(primero.pk, segundo.pk)

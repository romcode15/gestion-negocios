from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from accesos.catalogo import PERMISOS_NEGOCIO, PERMISOS_PLATAFORMA, SUPERADMINISTRADOR
from accesos.models import Permiso, Rol, RolPermiso, UsuarioRolGlobal
from accesos.services import asignar_superadministrador, preparar_administrador_negocio, preparar_catalogo
from negocios.models import Negocio


class PreparacionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # Los casos de preparación verifican el servicio desde un catálogo vacío.
        Permiso.objects.all().delete()

    def test_catalogo_idempotente_y_permisos_exactos(self):
        primero = preparar_catalogo()
        segundo = preparar_catalogo()
        self.assertEqual(primero.pk, segundo.pk)
        self.assertEqual(Permiso.objects.count(), len(PERMISOS_NEGOCIO) + len(PERMISOS_PLATAFORMA))
        self.assertEqual(Rol.objects.count(), 1)
        self.assertEqual(RolPermiso.objects.count(), 4)
        self.assertEqual(set(Permiso.objects.filter(ambito="negocio").values_list("codigo", flat=True)), set(PERMISOS_NEGOCIO))
        self.assertEqual(set(primero.permisos_asignados.values_list("permiso__codigo", flat=True)), set(PERMISOS_PLATAFORMA))

    def test_administrador_por_negocio_idempotente_sin_permisos_globales(self):
        negocio = Negocio.objects.create(nombre="Tienda", tipo="tienda")
        primero = preparar_administrador_negocio(negocio)
        segundo = preparar_administrador_negocio(negocio)
        self.assertEqual(primero.pk, segundo.pk)
        self.assertTrue(primero.predefinido)
        self.assertEqual(primero.negocio_id, negocio.pk)
        self.assertEqual(set(primero.permisos_asignados.values_list("permiso__codigo", flat=True)), set(PERMISOS_NEGOCIO))
        self.assertFalse(UsuarioRolGlobal.objects.exists())

    def test_rechaza_negocio_sin_guardar(self):
        with self.assertRaises(ValidationError):
            preparar_administrador_negocio(Negocio(nombre="Tienda", tipo="tienda"))

    def test_asignacion_inicial_idempotente_sin_cambiar_credenciales(self):
        usuario = get_user_model().objects.create_user(username="inicial")
        original = usuario.password
        a = asignar_superadministrador(usuario)
        b = asignar_superadministrador(usuario)
        usuario.refresh_from_db()
        self.assertEqual(a.pk, b.pk)
        self.assertEqual(UsuarioRolGlobal.objects.count(), 1)
        self.assertEqual(usuario.password, original)
        self.assertFalse(usuario.is_superuser)

    def test_no_asigna_a_cuenta_inactiva_o_no_guardada(self):
        inactivo = get_user_model().objects.create_user(username="inactivo", is_active=False)
        for usuario in (inactivo, get_user_model()(username="nuevo")):
            with self.subTest(usuario=usuario), self.assertRaises(ValidationError):
                asignar_superadministrador(usuario)
        self.assertFalse(UsuarioRolGlobal.objects.exists())
        self.assertFalse(Permiso.objects.exists())

    def test_is_superuser_no_crea_asignacion_del_dominio(self):
        usuario = get_user_model().objects.create_user(username="django", is_superuser=True)
        self.assertFalse(usuario.roles_globales.exists())

    def test_revalida_estado_actual_de_cuenta_antes_de_asignar(self):
        usuario = get_user_model().objects.create_user(username="desactualizado")
        get_user_model().objects.filter(pk=usuario.pk).update(is_active=False)
        with self.assertRaises(ValidationError):
            asignar_superadministrador(usuario)
        self.assertFalse(UsuarioRolGlobal.objects.exists())
        self.assertFalse(Permiso.objects.exists())

    def test_comando_repetible_con_y_sin_cuenta(self):
        usuario = get_user_model().objects.create_user(username="inicial")
        for _ in range(2):
            call_command("preparar_accesos", stdout=StringIO())
            call_command("preparar_accesos", username=usuario.username, stdout=StringIO())
        self.assertEqual(Permiso.objects.count(), len(PERMISOS_NEGOCIO) + len(PERMISOS_PLATAFORMA))
        self.assertEqual(UsuarioRolGlobal.objects.count(), 1)

    def test_comando_rechaza_cuenta_inexistente_e_inactiva(self):
        get_user_model().objects.create_user(username="inactivo", is_active=False)
        for username in ("no_existe", "inactivo"):
            with self.subTest(username=username), self.assertRaises(CommandError):
                call_command("preparar_accesos", username=username, stdout=StringIO())
        self.assertFalse(Permiso.objects.exists())

    def test_colision_con_rol_personalizado_no_lo_convierte_en_predefinido(self):
        rol = Rol.objects.create(nombre=SUPERADMINISTRADOR)
        with self.assertRaises(ValidationError):
            preparar_catalogo()
        rol.refresh_from_db()
        self.assertFalse(rol.predefinido)
        self.assertFalse(Permiso.objects.exists())

    def test_no_corrige_silenciosamente_un_catalogo_incompatible(self):
        Permiso.objects.create(codigo="crear_rol", ambito="plataforma")
        with self.assertRaises(ValidationError):
            preparar_catalogo()
        self.assertEqual(Permiso.objects.count(), 1)
        self.assertFalse(Rol.objects.exists())

    def test_fallo_en_asociacion_revierte_preparacion(self):
        with patch.object(RolPermiso, "save", side_effect=RuntimeError("fallo simulado")):
            with self.assertRaises(RuntimeError):
                preparar_catalogo()
        self.assertFalse(Permiso.objects.exists())
        self.assertFalse(Rol.objects.exists())

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase

from accesos.models import Membresia, Permiso, Rol, RolPermiso, UsuarioRolGlobal
from accesos.services import preparar_catalogo
from tests.support.factories import crear_dos_negocios


class IntegridadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.global_rol = preparar_catalogo()
        cls.tienda, cls.ferreteria = crear_dos_negocios()
        cls.usuario = get_user_model().objects.create_user(username="miembro")

    def test_nombres_unicos_por_ambito_con_null_global(self):
        Rol.objects.create(nombre="Cajero", negocio=self.tienda.negocio)
        Rol.objects.create(nombre="Cajero", negocio=self.ferreteria.negocio)
        Rol.objects.create(nombre="Cajero")
        for negocio in (self.tienda.negocio, None):
            with self.subTest(negocio=negocio), self.assertRaises(ValidationError):
                Rol.objects.create(nombre="Cajero", negocio=negocio)

    def test_indices_unicos_de_roles_en_postgresql(self):
        for negocio_id in (None, self.tienda.negocio.pk):
            with self.subTest(negocio_id=negocio_id):
                Rol.objects.create(nombre="Unico", negocio_id=negocio_id)
                with self.assertRaises(IntegrityError), transaction.atomic():
                    Rol.objects.bulk_create([Rol(nombre="Unico", negocio_id=negocio_id)])

    def test_codigo_unico_y_ambito_valido(self):
        with self.assertRaises(ValidationError):
            Permiso.objects.create(codigo="crear_rol", ambito="negocio")
        with self.assertRaises(ValidationError):
            Permiso.objects.create(codigo="otro", ambito="invalido")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Permiso.objects.bulk_create([Permiso(codigo="otro", ambito="invalido")])
        with self.assertRaises(IntegrityError), transaction.atomic():
            Permiso.objects.bulk_create([Permiso(codigo="crear_rol", ambito="negocio")])

    def test_rol_permiso_rechaza_ambitos_cruzados(self):
        for rol, ambito in ((self.global_rol, "negocio"), (self.tienda.rol, "plataforma")):
            with self.subTest(ambito=ambito), self.assertRaises(ValidationError):
                RolPermiso.objects.create(rol=rol, permiso=Permiso.objects.filter(ambito=ambito).first())

    def test_asignacion_global_rechaza_rol_de_negocio(self):
        with self.assertRaises(ValidationError):
            UsuarioRolGlobal.objects.create(usuario=self.usuario, rol=self.tienda.rol)

    def test_membresia_rechaza_rol_ajeno_y_global(self):
        for rol in (self.ferreteria.rol, self.global_rol):
            with self.subTest(rol=rol), self.assertRaises(ValidationError):
                Membresia.objects.create(usuario=self.usuario, negocio=self.tienda.negocio, rol=rol)
        self.assertFalse(self.usuario.membresias.exists())

    def test_rechaza_relaciones_inexistentes(self):
        for modelo, datos in (
            (RolPermiso, {"rol_id": 999999, "permiso_id": 999999}),
            (UsuarioRolGlobal, {"usuario": self.usuario, "rol_id": 999999}),
            (Membresia, {"usuario": self.usuario, "negocio": self.tienda.negocio, "rol_id": 999999}),
        ):
            with self.subTest(modelo=modelo), self.assertRaises(ValidationError):
                modelo.objects.create(**datos)

    def test_misma_cuenta_puede_tener_roles_distintos_por_negocio(self):
        for contexto in (self.tienda, self.ferreteria):
            Membresia.objects.create(usuario=self.usuario, negocio=contexto.negocio, rol=contexto.rol)
        self.assertEqual(self.usuario.membresias.count(), 2)

    def test_membresia_duplicada_aunque_este_inactiva(self):
        primera = Membresia.objects.create(
            usuario=self.usuario, negocio=self.tienda.negocio, rol=self.tienda.rol, activo=False,
        )
        with self.assertRaises(ValidationError):
            Membresia.objects.create(usuario=self.usuario, negocio=self.tienda.negocio, rol=self.tienda.rol)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Membresia.objects.bulk_create([Membresia(
                usuario_id=primera.usuario_id, negocio_id=primera.negocio_id, rol_id=primera.rol_id,
            )])

    def test_pares_unicos_de_asignaciones_en_modelo_y_base(self):
        permiso = Permiso.objects.filter(ambito="plataforma").first()
        UsuarioRolGlobal.objects.create(usuario=self.usuario, rol=self.global_rol)
        casos = (
            (UsuarioRolGlobal, {"usuario": self.usuario, "rol": self.global_rol}),
            (RolPermiso, {"rol": self.global_rol, "permiso": permiso}),
        )
        for modelo, datos in casos:
            with self.subTest(modelo=modelo):
                with self.assertRaises(ValidationError):
                    modelo.objects.create(**datos)
                with self.assertRaises(IntegrityError), transaction.atomic():
                    modelo.objects.bulk_create([modelo(**datos)])

    def test_no_se_puede_mover_un_rol_a_otro_ambito(self):
        for rol, destino in ((self.tienda.rol, self.ferreteria.negocio), (self.global_rol, self.tienda.negocio)):
            with self.subTest(rol=rol), self.assertRaises(ValidationError):
                rol.negocio = destino
                rol.save()

    def test_no_se_puede_cambiar_ambito_de_permiso_asignado(self):
        permiso = Permiso.objects.get(codigo="crear_rol")
        permiso.ambito = "plataforma"
        with self.assertRaises(ValidationError):
            permiso.save()
        permiso.refresh_from_db()
        self.assertEqual(permiso.ambito, "negocio")

    def test_guardado_de_cambio_de_membresia_tambien_valida(self):
        miembro = self.tienda.membresia
        miembro.rol = self.ferreteria.rol
        with self.assertRaises(ValidationError):
            miembro.save(update_fields=["rol"])
        miembro.refresh_from_db()
        self.assertEqual(miembro.rol_id, self.tienda.rol.pk)

    def test_borrados_protegidos_no_eliminan_cuentas_o_accesos(self):
        UsuarioRolGlobal.objects.create(usuario=self.usuario, rol=self.global_rol)
        for objeto in (
            self.tienda.negocio, self.tienda.administrador, self.tienda.rol,
            self.global_rol, self.usuario, Permiso.objects.get(codigo="crear_rol"),
        ):
            with self.subTest(objeto=type(objeto).__name__), self.assertRaises(ProtectedError):
                objeto.delete()

    def test_borrar_rol_sin_usuarios_borra_sus_asociaciones(self):
        rol = Rol.objects.create(nombre="Temporal", negocio=self.tienda.negocio)
        RolPermiso.objects.create(rol=rol, permiso=Permiso.objects.get(codigo="listar_roles"))
        rol_id = rol.pk
        rol.delete()
        self.assertFalse(RolPermiso.objects.filter(rol_id=rol_id).exists())

    def test_datos_reutilizables_no_tienen_password_utilizable(self):
        self.assertFalse(self.tienda.administrador.has_usable_password())
        self.assertNotEqual(self.tienda.rol.pk, self.ferreteria.rol.pk)

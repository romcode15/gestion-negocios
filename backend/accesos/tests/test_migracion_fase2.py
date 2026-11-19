from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase

from accesos.catalogo import PERMISOS_NEGOCIO, PERMISOS_PLATAFORMA
from accesos.models import Permiso, RolPermiso


PERMISOS_FASE1_NEGOCIO = {
    "listar_roles", "crear_rol", "listar_membresias", "crear_membresia", "asignar_rol",
}
PERMISOS_NUEVOS = set(PERMISOS_NEGOCIO) - PERMISOS_FASE1_NEGOCIO
FASE1 = ("accesos", "0001_initial")
FASE2 = ("accesos", "0002_permisos_fase2")


class MigracionPermisosFase2Tests(TestCase):
    def test_instalacion_limpia_precarga_once_permisos_de_negocio(self):
        self.assertEqual(len(PERMISOS_NUEVOS), 11)
        self.assertEqual(
            set(Permiso.objects.filter(codigo__in=PERMISOS_NUEVOS).values_list("codigo", "ambito")),
            {(codigo, "negocio") for codigo in PERMISOS_NUEVOS},
        )

    def test_actualizacion_conserva_permisos_previos_y_solo_amplia_administradores(self):
        aplicaciones = MigrationExecutor(connection).migrate([FASE1]).apps
        Negocio = aplicaciones.get_model("negocios", "Negocio")
        RolHistorico = aplicaciones.get_model("accesos", "Rol")
        PermisoHistorico = aplicaciones.get_model("accesos", "Permiso")
        RolPermisoHistorico = aplicaciones.get_model("accesos", "RolPermiso")
        PermisoHistorico.objects.filter(codigo__in=PERMISOS_NUEVOS).delete()

        tienda = Negocio.objects.create(nombre="Tienda anterior", tipo="tienda")
        ferreteria = Negocio.objects.create(nombre="Ferretería anterior", tipo="ferreteria")
        otro = Negocio.objects.create(nombre="Otro", tipo="tienda")
        administradores = [
            RolHistorico.objects.create(nombre="Administrador de negocio", negocio=negocio, predefinido=True)
            for negocio in (tienda, ferreteria)
        ]
        limitado = RolHistorico.objects.create(nombre="Supervisor", negocio=tienda, predefinido=True)
        homonimo = RolHistorico.objects.create(nombre="Administrador de negocio", negocio=otro)
        plataforma = RolHistorico.objects.create(nombre="Superadministrador", predefinido=True)

        permisos_anteriores = {}
        for codigo in PERMISOS_FASE1_NEGOCIO:
            permiso = PermisoHistorico.objects.create(codigo=codigo, ambito="negocio")
            permisos_anteriores[codigo] = permiso.pk
            for rol in administradores:
                RolPermisoHistorico.objects.create(rol=rol, permiso=permiso)
        for rol in (limitado, homonimo):
            RolPermisoHistorico.objects.create(rol=rol, permiso_id=permisos_anteriores["listar_roles"])
        for codigo in PERMISOS_PLATAFORMA:
            permiso = PermisoHistorico.objects.create(codigo=codigo, ambito="plataforma")
            RolPermisoHistorico.objects.create(rol=plataforma, permiso=permiso)
            permisos_anteriores[codigo] = permiso.pk

        for repeticion in range(2):
            if repeticion:
                MigrationExecutor(connection).migrate([FASE1])
            MigrationExecutor(connection).migrate([FASE2])
            self.assertEqual(
                dict(Permiso.objects.filter(codigo__in=permisos_anteriores).values_list("codigo", "pk")),
                permisos_anteriores,
            )
            esperados = {
                **{rol.pk: set(PERMISOS_NEGOCIO) for rol in administradores},
                limitado.pk: {"listar_roles"},
                homonimo.pk: {"listar_roles"},
                plataforma.pk: set(PERMISOS_PLATAFORMA),
            }
            for rol_id, codigos in esperados.items():
                self.assertEqual(
                    set(RolPermiso.objects.filter(rol_id=rol_id).values_list("permiso__codigo", flat=True)),
                    codigos,
                )

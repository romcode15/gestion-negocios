from importlib import import_module

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase

from accesos.catalogo import PERMISOS_NEGOCIO, PERMISOS_PLATAFORMA
from accesos.models import Permiso, RolPermiso
from accesos.services import preparar_administrador_negocio, preparar_catalogo
from tests.support.factories import crear_contexto_negocio


NUEVOS = set(import_module("accesos.migrations.0003_permisos_fase3").PERMISOS_FASE3)
FASE2 = ("accesos", "0002_permisos_fase2")
FASE3 = ("accesos", "0003_permisos_fase3")


class MigracionPermisosFase3Tests(TestCase):
    def test_instalacion_y_negocios_nuevos_reciben_catalogo_idempotente_sin_ampliar_plataforma(self):
        self.assertEqual(NUEVOS, {"registrar_venta", "listar_ventas", "anular_venta"})
        self.assertEqual(len(PERMISOS_NEGOCIO), 19)
        contexto = crear_contexto_negocio()
        for _ in range(2):
            preparar_administrador_negocio(contexto.negocio)
            global_rol = preparar_catalogo()
        self.assertEqual(set(contexto.rol.permisos_asignados.values_list("permiso__codigo", flat=True)), set(PERMISOS_NEGOCIO))
        self.assertEqual(set(global_rol.permisos_asignados.values_list("permiso__codigo", flat=True)), set(PERMISOS_PLATAFORMA))
        self.assertEqual(Permiso.objects.filter(ambito="negocio").count(), 19)
        self.assertEqual(set(Permiso.objects.filter(codigo__in=NUEVOS).values_list("ambito", flat=True)), {"negocio"})

    def test_upgrade_conserva_ids_previos_y_solo_amplia_administradores_predefinidos(self):
        apps = MigrationExecutor(connection).migrate([FASE2]).apps
        Negocio = apps.get_model("negocios", "Negocio")
        Rol = apps.get_model("accesos", "Rol")
        PermisoAnterior = apps.get_model("accesos", "Permiso")
        Asignacion = apps.get_model("accesos", "RolPermiso")
        PermisoAnterior.objects.filter(codigo__in=NUEVOS).delete()
        # La instalación de fase 2 precarga sus once permisos; la preparación
        # del negocio/plataforma ya habría creado los cinco y cuatro anteriores.
        for codigo in set(PERMISOS_NEGOCIO) - NUEVOS:
            PermisoAnterior.objects.get_or_create(codigo=codigo, defaults={"ambito": "negocio"})
        for codigo in PERMISOS_PLATAFORMA:
            PermisoAnterior.objects.get_or_create(codigo=codigo, defaults={"ambito": "plataforma"})
        ids = dict(PermisoAnterior.objects.values_list("codigo", "pk"))
        negocio = Negocio.objects.create(nombre="Base fase 2", tipo="tienda")
        admin = Rol.objects.create(nombre="Administrador de negocio", negocio=negocio, predefinido=True)
        limitado = Rol.objects.create(nombre="Supervisor", negocio=negocio, predefinido=True)
        otro = Negocio.objects.create(nombre="Otro negocio", tipo="tienda")
        homonimo = Rol.objects.create(nombre="Administrador de negocio", negocio=otro, predefinido=False)
        plataforma = Rol.objects.create(nombre="Superadministrador", predefinido=True)
        for codigo, pk in ids.items():
            if codigo in PERMISOS_NEGOCIO:
                Asignacion.objects.create(rol=admin, permiso_id=pk)
            else:
                Asignacion.objects.create(rol=plataforma, permiso_id=pk)
        for rol in (limitado, homonimo):
            Asignacion.objects.create(rol=rol, permiso_id=ids["listar_roles"])
        for _ in range(2):
            MigrationExecutor(connection).migrate([FASE3])
            self.assertEqual(dict(Permiso.objects.filter(codigo__in=ids).values_list("codigo", "pk")), ids)
            for rol, esperado in [(admin, set(PERMISOS_NEGOCIO)), (limitado, {"listar_roles"}),
                                  (homonimo, {"listar_roles"}), (plataforma, set(PERMISOS_PLATAFORMA))]:
                self.assertEqual(set(RolPermiso.objects.filter(rol_id=rol.pk).values_list("permiso__codigo", flat=True)), esperado)
            self.assertEqual(Permiso.objects.filter(codigo__in=NUEVOS).count(), 3)
            MigrationExecutor(connection).migrate([FASE2])
        MigrationExecutor(connection).migrate([FASE3])

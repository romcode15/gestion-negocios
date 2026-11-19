from django.db import migrations


PERMISOS_FASE2 = (
    "listar_categorias", "crear_categoria", "editar_categoria",
    "listar_productos", "crear_producto", "editar_producto",
    "consultar_existencias", "registrar_entrada", "registrar_salida",
    "ajustar_inventario", "listar_movimientos",
)


def preparar_permisos_fase2(apps, schema_editor):
    db = schema_editor.connection.alias
    Permiso = apps.get_model("accesos", "Permiso")
    Rol = apps.get_model("accesos", "Rol")
    RolPermiso = apps.get_model("accesos", "RolPermiso")

    permisos = []
    for codigo in PERMISOS_FASE2:
        permiso, _ = Permiso.objects.using(db).get_or_create(codigo=codigo, defaults={"ambito": "negocio"})
        if permiso.ambito != "negocio":
            raise ValueError(f"El permiso {codigo} tiene un ámbito incompatible.")
        permisos.append(permiso)

    administradores = Rol.objects.using(db).filter(
        nombre="Administrador de negocio", predefinido=True, negocio__isnull=False,
    ).values_list("pk", flat=True)
    for rol_id in administradores.iterator():
        RolPermiso.objects.using(db).bulk_create(
            [RolPermiso(rol_id=rol_id, permiso_id=permiso.pk) for permiso in permisos],
            ignore_conflicts=True,
        )


class Migration(migrations.Migration):
    dependencies = [("accesos", "0001_initial")]

    operations = [
        # Conservar los permisos y las delegaciones posteriores si se revierte el código.
        migrations.RunPython(preparar_permisos_fase2, migrations.RunPython.noop),
    ]

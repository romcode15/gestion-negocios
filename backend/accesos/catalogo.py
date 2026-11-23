"""Catálogo de permisos del dominio, independiente de auth.Permission."""

PERMISOS_PLATAFORMA = (
    "listar_negocios", "crear_negocio", "listar_usuarios", "crear_usuario",
)
PERMISOS_NEGOCIO = (
    "listar_roles", "crear_rol", "listar_membresias", "crear_membresia", "asignar_rol",
    "listar_categorias", "crear_categoria", "editar_categoria",
    "listar_productos", "crear_producto", "editar_producto",
    "consultar_existencias", "registrar_entrada", "registrar_salida",
    "ajustar_inventario", "listar_movimientos",
    "registrar_venta", "listar_ventas", "anular_venta",
)
SUPERADMINISTRADOR = "Superadministrador"
ADMINISTRADOR_NEGOCIO = "Administrador de negocio"

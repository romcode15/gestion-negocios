"""Catálogo cerrado de permisos de fase 1; no confundir con auth.Permission."""

PERMISOS_PLATAFORMA = (
    "listar_negocios", "crear_negocio", "listar_usuarios", "crear_usuario",
)
PERMISOS_NEGOCIO = (
    "listar_roles", "crear_rol", "listar_membresias", "crear_membresia", "asignar_rol",
)
SUPERADMINISTRADOR = "Superadministrador"
ADMINISTRADOR_NEGOCIO = "Administrador de negocio"

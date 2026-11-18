# Verificación de membresías (#15)

Implementación en fix/frontend-panel-membresias, junto con la corrección del panel #14. La base de sesión se recuperó del historial porque el revert de #15 había retirado también archivos de #13. Backend no fue modificado.

## Funcionalidad

- Listado paginado con username, rol resuelto desde el catálogo y estado.
- Cuenta nueva envía username/password/rol_id; existente omite password completamente.
- Cambio de modo borra contraseña y errores.
- Cambio de rol usa membresia.id y envía solo rol_id.
- Permisos de listar, crear y asignar independientes. Sin listar_roles no se consulta el catálogo ni se permite asignar.
- Catálogo obtenido mediante las páginas de listarRoles del negocio activo, sin seguir enlaces mock con fetch. Permite resolver nombres de roles de otras páginas; los selectores conservan la selección al paginar.
- Cambio de negocio remonta el módulo y cancela/descarta respuestas y errores anteriores. Las mutaciones también usan store.enContexto.
- Un cambio del rol propio restaura la sesión mediante me y reevalúa permisos, navegación y negocio autorizado.
- No incorpora eliminación, desactivación, edición de cuentas ni creación de roles.

## Comprobaciones ejecutadas

Desde frontend:
- npm.cmd test: correcto. Ejecuta API, sesión, panel, membresías y flujos DOM.
- npm.cmd run lint: correcto, sin advertencias.
- npm.cmd run build: correcto.

verificar-membresias.mjs comprueba solicitudes de ambos modos, exclusión de password, roles numéricos, pertenencia del rol, catálogo de tres páginas, listado, carga/vacío/error, permisos, duplicados, usuario inactivo/inexistente, contraseña inválida, rol ajeno y cambios de rol con lecturas posteriores.

verificar-flujos.mjs monta React en jsdom y ejecuta eventos de formularios: cambio de modo con limpieza de contraseña/errores, altas de ambos modos, doble envío, refresco de permisos tras cambiar el rol propio, cambio rápido de negocio y expiración. verificar-sesion.mjs comprueba además respuestas tardías de transportes que ignoran AbortSignal.

## Reproducción local

1. npm.cmd run dev con VITE_API_MODE=mock.
2. admin_tienda / Demo-12345!: entrar a /negocio/membresias, incorporar existente con rol Consulta; luego crear una cuenta nueva con contraseña de al menos 8 caracteres.
3. Comprobar registros en la siguiente página y cambiarles el rol.
4. Cambiar el rol de admin_tienda a Consulta: desaparecen las acciones de incorporar/asignar.
5. Iniciar sesión como compartido: tiene consulta en tienda y ningún permiso en ferretería. Alternar negocios no debe conservar datos de tienda.
6. Para usuario inactivo, desde la consola de Vite importar el servicio de mocks y ejecutar configurarMocks({ usuariosInactivos: [5] }); intentar incorporar existente. reiniciarMocks restaura las cuentas.
7. Los escenarios empty, validation_error, permission_denied, not_found y not_authenticated se configuran según API.md.

## Límites y revisión pendiente

Las pruebas usan simulación, renderizado y DOM en jsdom. No se ha comprobado visualmente la disposición a 320px ni ejecutado un lector de pantalla o navegación de teclado en un navegador real. Los estilos comunes permiten envolver controles y desplazar tablas horizontalmente.

Pendiente integración real con Django/PostgreSQL:
- GET/POST /api/v1/negocios/{negocio_id}/membresias/
- PATCH /api/v1/negocios/{negocio_id}/membresias/{membresia_id}/
- GET /api/v1/negocios/{negocio_id}/roles/
- GET /api/v1/auth/me/ tras cambios de rol propio.

La coordinación y cierre de las siete entregas, revisión del PR e integración en dev corresponden a la validación conjunta del equipo; no se presentan como realizados.

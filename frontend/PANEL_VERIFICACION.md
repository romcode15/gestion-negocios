# Verificación del panel de plataforma (#14)

## Corrección del estado actual

El revert de membresías también había retirado la base de sesión (#13) y desconectado NegociosPage. Se recuperaron exclusivamente los archivos del frontend necesarios para esa base y sus pruebas, y se volvió a montar el panel de #14. No se recuperaron cambios de backend ni pantallas funcionales de membresías.

Además:
- Los errores de administrador_id se muestran y se vinculan al selector incluso sin cuentas disponibles.
- Una cuenta recién creada se puede seleccionar sin permiso para listar usuarios; no se lanza esa consulta.
- Los cuatro permisos de plataforma se evalúan independientemente. Sin listar_negocios no se consulta ese listado. Con permisos solo de cuentas se presentan sus operaciones autorizadas.
- Lecturas y mutaciones usan el contexto compartido para cancelar/descartar respuestas anteriores.
- Se conserva la selección de cuentas entre páginas y se recargan listados tras altas.

## Resultados automáticos reproducibles

Ejecutar desde frontend:

| Comando | Resultado |
| --- | --- |
| `npm.cmd run lint` | Correcto, sin advertencias. |
| `npm.cmd run build` | Correcto, TypeScript y Vite compilan. |
| `npm.cmd run test:api` | Correcto: lecturas, mutaciones, errores y transporte HTTP con fetch sustituido. |
| `npm.cmd run test:sesion` | Correcto: restauración, permisos, expiración, logout y descarte de respuestas anteriores. |
| `npm.cmd run test:panel` | Correcto: validaciones, payloads, selección paginada, formularios hermanos, estados del listado, permisos independientes y errores del administrador sin opciones. |

Las pruebas del panel renderizan HTML y comprueban las funciones puras. No ejecutan eventos reales de teclado ni sustituyen una prueba del navegador.

## Comprobación manual pendiente

Los escenarios descritos en la versión anterior del documento no eran reproducibles en el estado roto del repositorio. Esta corrección no los presenta como ejecutados.

1. Ejecutar `npm.cmd run dev`, iniciar sesión como `plataforma` / `Demo-12345!` y entrar a /plataforma.
2. Comprobar carga y listas paginadas de negocios y cuentas. Elegir una cuenta de la segunda o tercera página y comprobar que sigue seleccionada al paginar.
3. Crear una cuenta con username duplicado y otra con contraseña corta. Revisar errores por campo, foco y conservación de entradas.
4. Crear una cuenta válida: comprobar limpieza de su contraseña, selección automática y disponibilidad al volver a elegir administrador.
5. Enviar negocio sin tipo o sin administrador: revisar errores visibles y foco. Revisar administrador inválido/inactivo mediante las validaciones automatizadas y, al integrar, contra Django.
6. Crear negocio válido, comprobar mensaje de éxito y encontrarlo paginando el listado.
7. Probar empty, validation_error y permission_denied según API.md. Verificar reintento y conservación de entradas tras fallo.
8. En modo HTTP sin servidor, comprobar error de red; no declarar integración exitosa por esa prueba.
9. Entrar como compartido y acceder a /plataforma: debe mostrar acceso denegado.
10. Revisar Tab/Shift+Tab/Enter, ausencia de doble envío durante latencia y diseño a 320px.

## Alcance de simulación

Datos y credenciales de desarrollo documentados en API.md. Los datos se reinician al recargar; la identidad de una cuenta semilla puede restaurarse desde sessionStorage, sin guardar contraseñas ni tokens. reiniciarMocks elimina esa identidad.

No se comprobó integración real con Django/PostgreSQL. Quedan pendientes:

- GET /api/v1/plataforma/negocios/
- GET /api/v1/plataforma/usuarios/
- POST /api/v1/plataforma/usuarios/
- POST /api/v1/plataforma/negocios/

Confirmar en integración CSRF, estados HTTP, paginación, validación de contraseñas y la transacción atómica del backend. La pantalla envía solo el contrato; no implementa esa transacción.

## Pruebas adicionales de flujos

`npm.cmd test` ejecuta todas las comprobaciones y pasa. `npm.cmd run test:flujos` monta las pantallas en jsdom y comprueba formularios con eventos DOM: duplicado, contraseña inválida, cuenta seleccionada tras alta, foco al validar, bloqueo de doble envío, paginación y fallo de red conservando entradas.

Esto amplía la evidencia automática anterior; la revisión visual y de teclado en navegador real sigue pendiente. Los estándares comunes están en COMPONENTES.md y los resultados de #15 en MEMBRESIAS_VERIFICACION.md.

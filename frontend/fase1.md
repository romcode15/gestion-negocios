## Fase 1 · Frontend — Usuarios, negocios, roles y membresías

### Objetivo

Implementar con React, TypeScript y Vite el inicio de sesión, el panel de
plataforma y el panel de negocio. Las pantallas se desarrollan con datos
simulados desde el inicio y se integran con Django por flujo cuando cada
endpoint esté disponible.

### Flujos de pantalla

| Pantalla | Comportamiento esperado |
|---|---|
| Inicio de sesión | Recibe nombre de usuario y contraseña. Recupera la sesión al recargar mediante `/auth/me/`. |
| Panel de plataforma | Lista negocios y permite crear un negocio con una cuenta activa como administrador inicial. Permite crear esa cuenta si hace falta. |
| Selector de negocio | Muestra los negocios disponibles en `Sesion.negocios` y cambia el contexto de las pantallas. |
| Roles del negocio | Lista los roles y permite crear uno seleccionando permisos delegables. |
| Membresías del negocio | Lista miembros, permite incorporar una cuenta existente o crear una nueva con rol, y permite cambiar el rol de una membresía. |

### Contrato de la API

Consumir rutas relativas con prefijo `/api/v1`. Usar los nombres de campos
en `snake_case` y los IDs como números.

| Método y ruta | Datos que envía la interfaz | Resultado esperado |
|---|---|---|
| `GET /auth/csrf/` | Sin cuerpo | `204` y cookie `csrftoken`. |
| `POST /auth/login/` | `{ username, password }` | `200` con `Sesion`. |
| `GET /auth/me/` | Sin cuerpo | `200` con `Sesion`. |
| `POST /auth/logout/` | Sin cuerpo | `204`. |
| `GET /plataforma/negocios/` | `page` opcional | Lista paginada de `Negocio`. |
| `GET /plataforma/usuarios/` | `page` opcional | Lista paginada de `Usuario`. |
| `POST /plataforma/usuarios/` | `{ username, password }` | `201` con `Usuario`. |
| `POST /plataforma/negocios/` | `{ nombre, tipo, administrador_id }` | `201` con `Negocio`. |
| `GET /negocios/{negocio_id}/permisos/` | `page` opcional | Lista paginada de `Permiso`. |
| `GET /negocios/{negocio_id}/roles/` | `page` opcional | Lista paginada de `Rol`. |
| `GET /negocios/{negocio_id}/roles/asignables/` | `page` opcional | Lista paginada de `Rol` que el actor puede asignar. |
| `POST /negocios/{negocio_id}/roles/` | `{ nombre, permiso_ids }` | `201` con `Rol`. |
| `GET /negocios/{negocio_id}/membresias/` | `page` opcional | Lista paginada de `Membresia`. |
| `POST /negocios/{negocio_id}/membresias/` | Cuenta nueva: `{ username, password, rol_id }`. Cuenta existente: `{ username, rol_id }`. | `201` con `Membresia`. |
| `PATCH /negocios/{negocio_id}/membresias/{membresia_id}/` | `{ rol_id }` | `200` con `Membresia` actualizada. |

### Tipos compartidos

- `Usuario` = `{ id, username, is_active }`.
- `Negocio` = `{ id, nombre, tipo, activo }`. `tipo` es un texto requerido.
- `Permiso` = `{ id, codigo, ambito }`. Los ámbitos son `plataforma` y `negocio`.
- `Rol` = `{ id, nombre, negocio_id, predefinido, permiso_ids }`.
  `negocio_id` es `number | null` y `permiso_ids` es `number[]`.
- `Membresia` = `{ id, usuario, negocio_id, rol_id, activo }`.
  `usuario` usa el tipo `Usuario`.
- `Sesion` = `{ usuario, permisos_globales, negocios }`.
  Cada entrada de `negocios` tiene `{ id, nombre, rol_id, permisos }`.
  Los permisos de sesión se expresan como códigos de texto.
- `Pagina<T>` = `{ count, next, previous, results }`.
  `next` y `previous` son enlaces o `null`, y `results` es `T[]`.
- `ApiError` = `{ code, detail, errors }`. `errors` contiene listas de
  mensajes por campo y es `{}` para errores generales.

Los tipos se definen una vez en el módulo dueño de los datos. Por ejemplo,
`Negocio` vive en `features/negocios/types.ts`. El formulario de alta usa
un tipo distinto de la respuesta porque envía `administrador_id`.

### Qué representa la base de datos en la interfaz

- `usuario` representa la cuenta. Su contraseña solo se pide al iniciar
  sesión o en un formulario que crea una cuenta.
- `negocio` representa el tenant. Su ID se toma del negocio activo y se
  usa en las rutas del panel de negocio.
- `membresia` representa la relación entre una cuenta, un negocio y su rol.
  Para cambiar el rol se usa `membresia_id`, aunque se muestre el `username`
  de la persona en la tabla.
- `rol` y `rol_permiso` determinan qué acciones tiene disponibles un usuario.
  La interfaz muestra las acciones usando los códigos que devuelve la sesión.
  Django valida el acceso al ejecutar cada llamada.

### Sesión, errores e integración

- Mostrar la creación de roles con `crear_rol` aunque no exista `listar_roles`; en ese caso no consultar ni mostrar el listado general.
- El selector de membresías usa `roles/asignables/` con `crear_membresia` o `asignar_rol`, sin exigir `listar_roles`. Solo ofrece roles del negocio con permisos incluidos en los del actor. Los nombres de roles del listado general se consultan únicamente con `listar_roles`.
- La simulación y Django rechazan asignar permisos superiores a los propios y quitar el rol al último Administrador de negocio activo. Para probar un cambio de rol propio permitido, preparar otro administrador activo. Mostrar los errores del servidor en `rol_id`.

- Centralizar las llamadas HTTP en `src/api/`. En desarrollo, configurar
  Vite para reenviar `/api` a Django. El frontend usa rutas relativas.
- Antes del login, llamar a `/auth/csrf/`. En `POST` y `PATCH`, enviar
  `X-CSRFToken` con el valor actual de `csrftoken`. Leer la cookie de nuevo
  después del login, porque Django puede rotar el token.
- Manejar `204` como respuesta sin cuerpo. En los formularios,
  `validation_error` muestra `errors` junto a sus campos. `invalid_credentials`
  muestra un mensaje general en el login.
- Si la API devuelve `not_authenticated`, limpiar la sesión local y volver
  al login. Si devuelve `permission_denied`, mostrar que falta acceso a
  la acción. Para `csrf_failed`, volver a obtener el token y permitir que
  la persona repita el envío. Para `not_found`, mostrar que el recurso
  solicitado ya no está disponible en su contexto.
- Usar los códigos `listar_negocios`, `crear_negocio`, `listar_usuarios`
  y `crear_usuario` en el panel de plataforma. En el panel de negocio usar
  `listar_roles`, `crear_rol`, `listar_membresias`, `crear_membresia` y
  `asignar_rol` según la pantalla y la acción.
- Las páginas llaman funciones tipadas como `crearNegocio()` y
  `listarRoles()`. Primero estas funciones devuelven datos simulados con
  las estructuras acordadas. La integración sustituye la implementación
  simulada por una llamada a Django manteniendo la misma firma.
- Al cambiar de negocio, limpiar las selecciones anteriores, cargar los
  datos del nuevo y descartar la respuesta de cualquier solicitud pendiente
  del negocio anterior.

### Criterios de cierre

- Cada issue de interfaz se puede validar con datos simulados, incluyendo
  carga, lista vacía, errores de campos y errores de permisos.
- Cada issue de integración se valida con Django y PostgreSQL. Verificar
  desde React que el negocio, el rol o la membresía quedan guardados.
- El flujo completo funciona al recargar la página, al cambiar de negocio
  y al cerrar sesión. Ejecutar `npm.cmd run lint` y `npm.cmd run build`.

  ### Convenciones obligatorias de React y TypeScript

| Tema | Se permite o se requiere | Se debe evitar |
|---|---|---|
| Componentes | Organizar las pantallas por funcionalidad y reutilizar componentes compartidos como botones, campos y mensajes de error. | Duplicar componentes que cumplen la misma función o concentrar toda una pantalla y sus detalles en un único componente difícil de mantener. |
| Tipos | Definir cada tipo en su módulo de origen e importarlo donde haga falta. Separar el tipo de solicitud del de respuesta cuando tengan campos distintos. | Repetir la misma interfaz en varias vistas o usar `any` para omitir errores de tipado. |
| Llamadas a la API | Usar funciones tipadas como `crearNegocio()` y un cliente HTTP compartido para rutas, sesión, CSRF y errores. | Dispersar llamadas `fetch` en las páginas o repetir el manejo de credenciales y errores en cada formulario. |
| Estado | Mantener el estado del formulario en su pantalla y compartir la sesión y el negocio activo. Derivar valores de los datos actuales y guardar desde el evento de envío. | Duplicar datos derivados en el estado o usar efectos para ejecutar acciones que corresponden a un evento del usuario. |
| Desarrollo en paralelo | Hacer que los datos simulados respeten el mismo contrato de entrada, salida y errores que Django. Mantener la firma de la función al integrar. | Acoplar las pantallas a datos simulados importados directamente o inventar campos que la API no devolverá. |
| Acceso y cambio de negocio | Mostrar las acciones disponibles según los permisos de sesión. Al cambiar de negocio, limpiar selecciones y descartar respuestas pendientes del contexto anterior. | Tratar una ruta oculta como control de seguridad o mostrar registros del negocio anterior tras cambiar de contexto. |
| Formularios y errores | Usar etiquetas visibles, mostrar errores junto al campo y bloquear el envío mientras se guarda. | Mostrar solo un mensaje genérico cuando la API identifica un campo inválido o enviar el formulario varias veces. |

Antes de abrir el PR, ejecutar `npm.cmd run lint` y `npm.cmd run build`.
Los issues de interfaz se validan con datos simulados. Los issues de
integración se validan con Django y PostgreSQL.

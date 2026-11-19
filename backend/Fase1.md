## Fase 1 · Backend — Usuarios, negocios, roles y membresías

La ubicación de los módulos, sus responsables y la composición de rutas se describen en [Estructura de desarrollo](ESTRUCTURA.md). Usar esa distribución al implementar los issues de esta fase.

La base HTTP, los helpers de autorización y sus reglas de uso se documentan en [API y seguridad](API.md).

Swagger UI está configurado para todo el backend. Consultar [README backend](README.md) para probar operaciones y documentar nuevos endpoints; cada issue debe mantener el esquema y comprobar los casos aplicables sin repetir la configuración.

### Objetivo

Implementar con Django REST Framework y PostgreSQL el flujo en el que el
Superadministrador crea un negocio y le asigna un administrador inicial.
El Administrador de negocio puede crear roles con permisos, incorporar
usuarios y asignarles un rol dentro de su negocio.

### Base de datos

| Entidad | Campos base | Regla |
|---|---|---|
| `usuario` | `id`, `username`, `password`, `is_active` | `username` es único. El modelo `cuentas.Usuario` ya hereda `password` de `AbstractUser`. Django guarda el hash. |
| `negocio` | `id`, `nombre`, `tipo`, `activo` | Cada registro representa un tenant. |
| `rol` | `id`, `nombre`, `negocio_id`, `predefinido` | `negocio_id` es nulo para roles globales. El nombre del rol es único dentro de su ámbito. |
| `permiso` | `id`, `codigo`, `ambito` | `codigo` es único. `ambito` puede ser `plataforma` o `negocio`. |
| `rol_permiso` | `rol_id`, `permiso_id` | Cada par es único. |
| `usuario_rol_global` | `usuario_id`, `rol_id` | Cada par es único. Solo admite roles de plataforma. |
| `membresia` | `id`, `usuario_id`, `negocio_id`, `rol_id`, `activo` | El par `(usuario_id, negocio_id)` es único. El rol pertenece al mismo negocio. |

Los dos roles predefinidos son **Superadministrador**, con alcance global,
y **Administrador de negocio**, creado para cada negocio. El backend
define el catálogo de permisos. Los administradores crean roles y eligen
los permisos que pueden delegar dentro de su ámbito.

La cuenta inicial se prepara en Django y recibe una asignación en
`usuario_rol_global`. Ese registro autoriza su acceso a la API de plataforma.

### Contrato de la API

Todas las rutas de la tabla comienzan con `/api/v1`. Las rutas de negocio
usan `{negocio_id}` como parte de la URL. Los IDs son números. Se usan
nombres de campos en `snake_case` y barra final en las rutas.

| Método y ruta | Entrada | Respuesta exitosa |
|---|---|---|
| `GET /auth/csrf/` | Sin cuerpo | `204` y cookie `csrftoken`. |
| `POST /auth/login/` | `{ username, password }` | `200` y objeto `Sesion`. |
| `GET /auth/me/` | Sin cuerpo | `200` y objeto `Sesion`. |
| `POST /auth/logout/` | Sin cuerpo | `204`. |
| `GET /plataforma/negocios/` | `page` opcional | `200` y lista paginada de negocios. |
| `GET /plataforma/usuarios/` | `page` opcional | `200` y lista paginada de usuarios. |
| `POST /plataforma/usuarios/` | `{ username, password }` | `201` y objeto `Usuario`. |
| `POST /plataforma/negocios/` | `{ nombre, tipo, administrador_id }` | `201` y objeto `Negocio`. |
| `GET /negocios/{negocio_id}/permisos/` | `page` opcional | `200` y lista paginada de permisos delegables. |
| `GET /negocios/{negocio_id}/roles/` | `page` opcional | `200` y lista paginada de roles. |
| `GET /negocios/{negocio_id}/roles/asignables/` | `page` opcional | `200` y lista paginada de roles que el actor puede asignar. |
| `POST /negocios/{negocio_id}/roles/` | `{ nombre, permiso_ids }` | `201` y objeto `Rol`. |
| `GET /negocios/{negocio_id}/membresias/` | `page` opcional | `200` y lista paginada de membresías. |
| `POST /negocios/{negocio_id}/membresias/` | Cuenta nueva: `{ username, password, rol_id }`. Cuenta existente: `{ username, rol_id }`. | `201` y objeto `Membresia`. |
| `PATCH /negocios/{negocio_id}/membresias/{membresia_id}/` | `{ rol_id }` | `200` y objeto `Membresia` actualizado. |

En el alta de un negocio, `administrador_id` identifica una cuenta activa
que ya existe. El backend crea el negocio, su rol inicial de administrador
y la membresía en una sola transacción.

En el alta de membresías, la presencia de `password` indica creación de
cuenta. Si el nombre ya existe, se devuelve un error de validación.
Cuando solo se envía `username`, se busca una cuenta activa por coincidencia
exacta, se conserva su contraseña y se crea únicamente la membresía.
La creación de una cuenta nueva y su membresía se guarda en una sola
transacción. Se valida `rol_id` en ambas modalidades.

### Campos de respuesta

- `Usuario` = `{ id, username, is_active }`.
- `Negocio` = `{ id, nombre, tipo, activo }`. `tipo` es un texto requerido.
- `Permiso` = `{ id, codigo, ambito }`.
- `Rol` = `{ id, nombre, negocio_id, predefinido, permiso_ids }`.
  `permiso_ids` es una lista de IDs de permisos.
- `Membresia` = `{ id, usuario, negocio_id, rol_id, activo }`.
  `usuario` usa la estructura `Usuario`.
- `Sesion` = `{ usuario, permisos_globales, negocios }`.
  `permisos_globales` contiene códigos. Cada elemento de `negocios` tiene
  `{ id, nombre, rol_id, permisos }`, donde `permisos` contiene códigos.
  Solo se incluyen negocios y membresías activos.
- Una lista devuelve `{ count, next, previous, results }`.
  `next` y `previous` son enlaces de paginación o `null`.
  El tamaño inicial es 2 y el orden ascendente por `id`, alineados con la simulación de frontend.
- `204` indica éxito con cuerpo vacío.

Códigos base de permisos para esta entrega:

| Ámbito | Códigos |
|---|---|
| Plataforma | `listar_negocios`, `crear_negocio`, `listar_usuarios`, `crear_usuario` |
| Negocio | `listar_roles`, `crear_rol`, `listar_membresias`, `crear_membresia`, `asignar_rol` |

El alta del negocio con su administrador usa `crear_negocio`. La consulta
de permisos delegables usa `crear_rol`. Crear una cuenta al incorporar
un miembro usa `crear_membresia` y se limita a ese flujo de negocio.

Los permisos de cada acción son independientes: `crear_rol` no exige `listar_roles`. El catálogo de roles asignables requiere `crear_membresia` o `asignar_rol` y devuelve solo roles del negocio con permisos incluidos en los del actor. No habilita el listado general de roles ni el catálogo de permisos. Cada escritura vuelve a validar estas restricciones.

### Autenticación y errores

Usar sesiones de Django. El login valida CSRF explícitamente y recibe
`username` y `password`. Las operaciones `POST` y `PATCH` requieren el
encabezado `X-CSRFToken`. Crear cuentas con `create_user()` y aplicar
`validate_password()`. Excluir la contraseña y su hash de las respuestas.

Los errores de la API usan `{ code, detail, errors }`. `code` identifica
el caso para React, `detail` es un mensaje legible y `errors` es un objeto
con listas de mensajes por campo. En errores generales, `errors` es `{}`.

| HTTP | `code` | Cuándo se devuelve |
|---|---|---|
| `400` | `validation_error` | Campos inválidos, membresía duplicada o relación inválida. |
| `400` | `invalid_credentials` | El login falla. El mensaje es el mismo para cualquier credencial inválida. |
| `403` | `not_authenticated` | La ruta es protegida y falta una sesión válida. |
| `403` | `permission_denied` | La sesión es válida, pero falta membresía activa o el permiso requerido. |
| `403` | `csrf_failed` | Falta un token CSRF válido en una operación que lo requiere. |
| `404` | `not_found` | El recurso no existe en el ámbito autorizado. |

Ejemplo de validación:

```json
{
  "code": "validation_error",
  "detail": "Revisa los campos indicados.",
  "errors": {
    "administrador_id": ["Selecciona una cuenta activa."]
  }
}
```

### Reglas de implementación y cierre

- Las vistas coordinan la solicitud. Los serializers validan los datos y
  declaran sus campos. Los servicios ejecutan operaciones que coordinan
  varios modelos. Las migraciones se versionan con los cambios del modelo.
- Filtrar los querysets por el negocio validado y asignar el tenant en el
  servidor. Verificar la pertenencia de roles y membresías antes de guardar.
  Validar que quien crea un rol pueda delegar cada permiso seleccionado.
- Solo se puede asignar un rol del mismo negocio cuyos permisos estén incluidos
  en los del actor. Al cambiar roles, conservar al último Administrador de negocio
  activo y comprobarlo bajo bloqueo dentro de la transacción de guardado.
- Mantener la gestión de roles globales como capacidad prevista de la
  plataforma. El flujo mínimo de esta entrega utiliza el Superadministrador
  inicial y la creación de roles dentro de negocios.
- Comprobar el flujo completo con una tienda y una ferretería. Probar una
  operación permitida, una sin permiso y una que intente usar un rol o
  membresía del otro negocio. Confirmar que un fallo al crear la primera
  membresía revierte el alta del negocio.

  ### Convenciones obligatorias de Django y DRF

| Tema | Se permite o se requiere | Se debe evitar |
|---|---|---|
| Vistas | Usar vistas genéricas de DRF y delegar el guardado al serializer o al servicio. Un CRUD sencillo puede usar `serializer.save()`. | Crear registros directamente desde la vista o concentrar en ella validaciones, consultas y reglas de negocio. |
| Serializers | Declarar explícitamente los campos, validar las entradas y marcar `password` como `write_only` cuando corresponda. | Usar `fields = "__all__"` en serializers de la API o devolver contraseñas y hashes. |
| Servicios | Usar un servicio y `transaction.atomic()` para el alta conjunta del negocio, su rol inicial y la membresía. | Guardar cada parte del alta de forma independiente o usar señales para ejecutar pasos esenciales del flujo. |
| Aislamiento por negocio | Validar el negocio de la ruta y filtrar las consultas por ese negocio. Asignar el tenant en el servidor al crear registros. | Confiar en un `negocio_id` enviado en el cuerpo o buscar un registro de negocio solo por su ID global. |
| Roles y permisos | Reutilizar las comprobaciones de membresía y permisos. Validar el ámbito del rol y los permisos que el usuario puede delegar. | Repetir la misma lógica de acceso en cada vista o aceptar roles de otro negocio. |
| Cuentas y sesiones | Crear cuentas con `create_user()`, cambiar claves con `set_password()` y conservar la protección CSRF, incluido el login. | Guardar contraseñas mediante asignación directa o desactivar CSRF para resolver errores de integración. |
| Base de datos | Versionar las migraciones con los modelos y reforzar con restricciones las relaciones y combinaciones únicas definidas. | Editar migraciones que el equipo ya aplicó o confiar solo en validaciones de la interfaz para conservar la integridad. |
| Contrato de API | Respetar las rutas, los campos, los estados HTTP y el formato de errores de esta descripción. | Cambiar el contrato sin coordinar con frontend y actualizar la descripción y los datos simulados. |

Antes de abrir el PR, comprobar una operación permitida, una sin permiso
y una que intente usar datos de otro negocio. Para el alta del negocio,
comprobar también que un fallo en la membresía inicial revierte la operación.

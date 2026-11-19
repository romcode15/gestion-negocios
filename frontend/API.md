# API tipada, simulación y cliente HTTP

## Estado y alcance

La fase 1 incluye funciones tipadas, simulación, transporte HTTP, provider de sesión/negocio y pantallas funcionales. Los tipos coinciden con [el contrato backend](../backend/Fase1.md). Las pruebas de `npm test` usan simulación o fetch sustituido; la comprobación integral con Django y PostgreSQL se ejecuta por separado según el README.

## Modo central

Copiar `.env.example` a `.env.local` dentro de frontend y reiniciar Vite:

```dotenv
VITE_API_MODE=mock
```

Valores: `mock` (predeterminado) y `http`. La selección está solo en `src/api/client.ts`. Ambos transportes implementan `Transport.request<T>()`; las páginas solo importan sus funciones de `features/<modulo>/api.ts`. No deben importar datos semilla, llamar fetch ni seleccionar modo.

Para el modo HTTP usar `VITE_API_MODE=http`. Vite reenvía `/api` a `http://127.0.0.1:8000` manteniendo el host de origen. Abrir frontend siempre con el mismo hostname (por ejemplo, `http://localhost:5173`) y acceder a Django desde el proxy `/api`. No alternar localhost y 127.0.0.1 durante la sesión. Django debe permitir el host y confiar en el origen de Vite para CSRF según su configuración. En producción se necesita un proxy del mismo origen; el proxy de Vite solo opera en desarrollo.

## Firmas públicas

Todos los módulos usan los tipos únicos ya existentes. Los resultados son promesas; los IDs son números. Las opciones de petición son `{ signal?: AbortSignal }`; las de listado añaden `page?: number`.

| Import desde | Función y resultado |
| --- | --- |
| `features/auth/api` | `obtenerCsrf(opciones?): Promise<void>` |
| `features/auth/api` | `iniciarSesion({ username, password }, opciones?): Promise<Sesion>` |
| `features/auth/api` | `obtenerSesion(opciones?): Promise<Sesion>` |
| `features/auth/api` | `cerrarSesion(opciones?): Promise<void>` |
| `features/usuarios/api` | `listarUsuarios(opciones?): Promise<Pagina<Usuario>>` |
| `features/usuarios/api` | `crearUsuario({ username, password }, opciones?): Promise<Usuario>` |
| `features/negocios/api` | `listarNegocios(opciones?): Promise<Pagina<Negocio>>` |
| `features/negocios/api` | `crearNegocio({ nombre, tipo, administrador_id }, opciones?): Promise<Negocio>` |
| `features/roles/api` | `listarPermisos(negocioId, opciones?): Promise<Pagina<Permiso>>` |
| `features/roles/api` | `listarRoles(negocioId, opciones?): Promise<Pagina<Rol>>` |
| `features/roles/api` | `listarRolesAsignables(negocioId, opciones?): Promise<Pagina<Rol>>` |
| `features/roles/api` | `crearRol(negocioId, { nombre, permiso_ids }, opciones?): Promise<Rol>` |
| `features/membresias/api` | `listarMembresias(negocioId, opciones?): Promise<Pagina<Membresia>>` |
| `features/membresias/api` | `crearMembresia(negocioId, { username, rol_id, password? }, opciones?): Promise<Membresia>` |
| `features/membresias/api` | `cambiarRolMembresia(negocioId, membresiaId, { rol_id }, opciones?): Promise<Membresia>` |

Para membresías, enviar password únicamente al crear cuenta nueva. La cuenta existente conserva su contraseña. Las respuestas nunca incluyen password. Kelvin puede consumir listarRoles sin esperar ninguna pantalla de Diana.

`listarRolesAsignables()` consulta `GET /negocios/{negocio_id}/roles/asignables/` con `crear_membresia` o `asignar_rol`. Devuelve solo roles delegables del negocio, sin exigir `listar_roles`. Los selectores acumulan sus páginas; los nombres del listado de miembros pueden resolverse con el catálogo general únicamente si existe `listar_roles`. Cada mutación vuelve a validarse en Django.

## Sesión, CSRF y errores

`iniciarSesion` obtiene CSRF antes de enviar credenciales. En HTTP, cada POST/PATCH lee de nuevo la cookie csrftoken y envía X-CSRFToken, con credentials=include. Así se respeta la rotación después del login. Un 204 devuelve undefined sin intentar parsear JSON.

`ApiException` implementa `ApiError`: code, detail y errors (listas por campo). Su propiedad status es metadato del transporte, no un campo añadido a las respuestas del contrato. Errores de red usan network_error/status 0; respuesta ilegible usa invalid_response; HTTP sin el contrato usa http_error.

Ante csrf_failed se obtiene de nuevo el token y se propaga el error. El consumidor ofrece reenvío manual; la mutación nunca se repite automáticamente. La sesión compartida limpia su estado ante not_authenticated. La pantalla maneja permission_denied, not_found y errors por campo. Cancelaciones conservan AbortError y no deben presentarse como fallo de API.

## Cancelación al cambiar de negocio

```ts
import { crearContextoSolicitudes } from '../../api/context'
import { listarRoles } from '../roles/api'

// Una instancia por consumidor. Conservarla entre cargas.
const contexto = crearContextoSolicitudes()
const resultado = listarRoles(1, { signal: contexto.signal })
contexto.cambiar() // cancela la petición anterior antes de cargar otro negocio
const siguiente = listarRoles(2, { signal: contexto.signal })
// Manejar ambas promesas; ignorar AbortError.
// Limpiar selecciones y resultados anteriores desde el consumidor.
```

Cada operación recibe el ID de negocio explícitamente. El mock valida permisos y membresía activa de ese ID; no mantiene una segunda selección global. El provider comparte la selección activa. Cancelar evita recibir respuestas del contexto anterior; no garantiza revertir una mutación que el servidor real ya haya confirmado.

## Datos y persistencia simulados

Los datos y credenciales ficticias viven en memoria; las altas y cambios se reflejan en siguientes consultas durante la ejecución. Al recargar se restaura la semilla. Solo la identidad ficticia de una cuenta inicial se conserva en sessionStorage para que auth/me pueda restaurar su sesión. No se guardan contraseñas ni tokens de sesión en el navegador. Las cuentas creadas durante la ejecución desaparecen al recargar. reiniciarMocks también elimina la identidad guardada y cierra la sesión simulada.

### Usuarios y contraseñas de prueba

Estas cuentas solo funcionan con `VITE_API_MODE=mock`; no son cuentas de Django/PostgreSQL.

| Usuario | Contraseña | Acceso |
| --- | --- | --- |
| `plataforma` | `Demo-12345!` | Administración de plataforma; sin negocios asignados |
| `admin_tienda` | `Demo-12345!` | Administrador de Tienda Central, ID 1 |
| `admin_ferreteria` | `Demo-12345!` | Administrador de Ferretería Norte, ID 2 |
| `compartido` | `Demo-12345!` | Consulta en tienda; sin permisos en ferretería |
| `existente` | `Demo-12345!` | Cuenta activa sin negocios asignados |

La contraseña es exclusivamente de demostración. El mock exige 8 caracteres al crear una cuenta; no reproduce todos los validadores de contraseñas de Django.

Se validan unicidad de username, nombre de rol por negocio, membresía por usuario/negocio, pertenencia del rol y permisos delegables. Al crear o cambiar membresías se rechazan roles con permisos superiores a los del actor. No se puede degradar al último Administrador de negocio activo; una cuenta inactiva no cuenta como respaldo. El alta de negocio crea su rol administrador y membresía tras validar la entrada. El alta de cuenta y membresía valida todo antes de modificar las colecciones. La seguridad real depende de Django.

## Paginación

Mock: tamaño fijo de **2**, orden ascendente por id (la semilla y las altas mantienen ese orden). Respuestas con count, next, previous y results; página fuera de rango devuelve not_found. Backend y simulación usan actualmente tamaño 2 y orden ascendente por ID, según el contrato de fase 1.

Los enlaces next/previous usan el esquema no HTTP `mock:/api/v1/...`. No se deben pasar a fetch. Incrementar/decrementar page y volver a llamar la misma función tipada mientras next/previous no sea null. Esto permite pasar a Django sin cambiar firmas ni seguir enlaces simulados hacia un servidor.

## Escenarios reproducibles

En una composición de desarrollo o consola de Vite:

```js
const { reiniciarMocks, configurarMocks } =
  await import('/src/mocks/services/transport.ts')
const auth = await import('/src/features/auth/api.ts')
const roles = await import('/src/features/roles/api.ts')
reiniciarMocks()
await auth.iniciarSesion({ username: 'admin_tienda', password: 'Demo-12345!' })
configurarMocks({ latencia: 1000 })
await roles.listarRoles(1) // permite observar carga al integrar una pantalla
configurarMocks({ latencia: 0, escenario: 'empty' })
await roles.listarRoles(1) // lista vacía con contrato Pagina
```

`configurarMocks({ escenario })` afecta solo la siguiente solicitud que llegue al servicio. Usarlo después del login para no consumirlo en la obtención de CSRF. Los escenarios admitidos son normal, empty, validation_error, invalid_credentials, not_authenticated, permission_denied, csrf_failed y not_found. La latencia persiste hasta cambiarla o reiniciar.

- validation_error forzado devuelve errors.non_field_errors; entradas inválidas reales del mock devuelven campos concretos: username, password, rol_id, permiso_ids, administrador_id o nombre.
- invalid_credentials también se reproduce iniciando sesión con contraseña incorrecta.
- not_authenticated cierra la sesión; obtenerSesion vuelve a fallar hasta iniciar sesión.
- permission_denied también se reproduce con compartido intentando crear un rol o consultar roles del negocio 2.
- csrf_failed recupera el token para el siguiente envío manual.
- not_found se reproduce modificando una membresía inexistente dentro de un negocio autorizado.
- empty vacía solo la respuesta de listado, sin borrar datos.
- normal permite probar altas y siguientes consultas con estado actualizado.

No hay llamadas HTTP en modo mock. sessionStorage conserva únicamente la identidad ficticia descrita arriba; los datos y contraseñas no persisten.

## Verificación ejecutada

Desde frontend:

```powershell
node verificar-api.mjs
npm.cmd run lint
npm.cmd run build
```

verificar-api.mjs ejecuta las funciones públicas con mocks y prueba el transporte HTTP con fetch sustituido. Verifica payloads, 204, cookies, rotación de CSRF, errores, paginación, permisos, contexto, mutaciones, validaciones, altas conjuntas, cancelación y reinicio.

`npm test` no necesita Django. Comprueba los formularios con DOM, las reglas del simulador y el transporte HTTP con fetch sustituido. Para comprobar las pantallas con solicitudes reales, ejecutar `tools/verificar_postgres.py --integracion-frontend` desde backend con las dependencias de frontend instaladas. La política completa de contraseñas sigue perteneciendo a Django.

## Pantallas de plataforma y membresías

Las pantallas de #14 y #15 consumen estas firmas. Componentes compartidos y contratos de contexto: [COMPONENTES.md](COMPONENTES.md). Ejecutar `npm.cmd test` para todas las comprobaciones automatizadas; la revisión visual y la integración real con Django/PostgreSQL se verifican por separado.

Para simular cuentas inactivas: `configurarMocks({ usuariosInactivos: [5] })` marca la cuenta existente como inactiva hasta `reiniciarMocks()`. No cambia el contrato público de la API ni agrega campos a respuestas.

## Fase 2: catálogo e inventario (#50)

Los tipos pertenecen a `features/{categorias,productos,existencias,movimientos}/types.ts`;
cada módulo expone sus servicios desde `api.ts`. Las respuestas, solicitudes de
alta, PATCH, opciones y filtros tienen tipos separados. Los IDs y `version` son
números; precios, cantidades y saldos son cadenas decimales; `creado_en` es texto ISO.
Las páginas consumen estos servicios y no importan la semilla ni el transporte.

Todas las rutas siguientes tienen el prefijo `/api/v1/negocios/{negocioId}`.
Las listas reciben `(negocioId, { page?, signal?, ...filtros }?)` y devuelven
`Promise<Pagina<T>>`. Los detalles reciben `(negocioId, id, { signal? }?)`;
las escrituras `(negocioId, input, { signal? }?)`, salvo PATCH, que también recibe
el ID antes de input. Las escrituras y detalles devuelven el recurso tipado.

| Módulo | Funciones públicas | Ruta y filtros de listado |
|---|---|---|
| categorías | `listarCategorias`, `obtenerCategoria`, `crearCategoria`, `actualizarCategoria` | `/categorias/`, `search`, `activo`; detalle/PATCH `/{id}/` |
| categorías | `listarCategoriasOpciones` | `/categorias/opciones/`, `search` |
| productos | `listarProductos`, `obtenerProducto`, `crearProducto`, `actualizarProducto` | `/productos/`, `search`, `categoria_id`, `activo`; detalle/PATCH `/{id}/` |
| productos | `listarProductosOpciones` | `/productos/opciones/`, `search` |
| existencias | `listarExistencias`, `obtenerExistencia` | `/existencias/`, `search`, `categoria_id`, `activo`, `bajo_minimo`; detalle `/{producto_id}/` |
| movimientos | `listarMovimientos`, `registrarMovimiento` | `/movimientos/`, `search`, `producto_id`, `tipo`, `desde`, `hasta` |
| movimientos | `registrarAjuste` | POST `/ajustes/` |

Los filtros se codifican con `URLSearchParams`; `desde` es inclusivo y `hasta`
exclusivo, con fecha/hora y zona horaria. La simulación rechaza parámetros
desconocidos, repetidos o inválidos. Las páginas contienen dos registros;
catálogo se ordena por ID, existencias por producto e historial por fecha/ID
descendentes. Sus enlaces `mock:` conservan filtros y no se envían a fetch.

Las opciones de categorías requieren `crear_producto` o `editar_producto`;
las de productos, `registrar_entrada`, `registrar_salida` o `ajustar_inventario`.
El detalle de existencia acepta `consultar_existencias` o `ajustar_inventario`.
Estos selectores no requieren permisos para los listados generales.

### Decimales y operaciones reintentables

`lib/decimales.ts` publica `aEnteroEscalado`, `formatearDecimal` y
`normalizarDecimal`. Validan cadenas sin exponentes/comas, signo, rango,
precisión y cantidades enteras cuando la unidad es `unidad`.
Cantidad/stock: `{ escala: 3, precision: 14 }`; precio:
`{ escala: 2, precision: 12 }`. `unidad` admite `unidad`, `kg` y `litro`.
Los cálculos usan enteros escalados internamente y siempre devuelven cadenas
al contrato; no se serializan bigint ni se calculan saldos con float.

```ts
import { normalizarDecimal } from './lib/decimales'
import { crearOperacionInventario } from './api/operacionInventario'
import { registrarMovimiento } from './features/movimientos/api'
import type { RegistrarMovimientoSolicitud } from './features/movimientos/types'

// Conservar una instancia por formulario, por ejemplo mediante useRef.
const operacion = crearOperacionInventario<
  Omit<RegistrarMovimientoSolicitud, 'clave_operacion'>
>()
const payload = operacion.preparar({
  producto_id: 1,
  tipo: 'entrada',
  cantidad: normalizarDecimal('2', { escala: 3, precision: 14, unidad: 'unidad' }),
  motivo: 'Recepción',
})
await registrarMovimiento(1, payload)
operacion.nueva() // Solo después del éxito o al comenzar otra operación.
```

`generarClaveOperacion()` genera UUID con `crypto.randomUUID()`. `preparar`
conserva UUID y una copia del payload para el reintento manual idéntico;
cambiar datos genera otra clave. Conservar la instancia y los datos ante un
fallo de red; limpiar al cambiar negocio/sesión. No hay reenvíos automáticos.

La simulación compara actor y contenido normalizado por negocio/UUID:
una repetición compatible devuelve el mismo movimiento y fecha con 201, sin
afectar otra vez saldo o versión. Un contenido/actor incompatible devuelve
`409`, `code: 'conflict'`, `errors: {}`. Un ajuste nuevo con versión obsoleta
también devuelve 409; primero se resuelve la idempotencia de un reintento.
El cliente común conserva ese error y ApiFeedback muestra su detalle.
El consumidor puede recargar el saldo y pedir una nueva confirmación manual.

### Semilla, aislamiento y límites

Hay categorías/productos de dos negocios, incluyendo SKU iguales entre
negocios, categoría y producto inactivos, existencias con versión e historial
coherentes. La cuenta ficticia `inactivo` está deshabilitada y no inicia sesión.
Los administradores de negocio reciben los once permisos nuevos (dieciséis en
total); los roles limitados anteriores conservan sus permisos. Administrar la
plataforma no concede acceso implícito a un negocio. Un negocio nuevo recibe
su administrador con los nuevos permisos y catálogo vacío.

`reiniciarMocks()` reinicia fase 1 y fase 2 juntas. `configurarMocks` conserva
latencia, cancelación y escenarios previos; `conflict` fuerza un 409 en la
siguiente solicitud. `empty` solo modifica la respuesta, sin borrar datos.
Las escrituras validan una copia y solo la publican al terminar: los errores
no dejan productos sin existencia, cambios parciales ni historial sin saldo.
Las existencias no tienen POST/PATCH; solo cambian con movimientos y ajustes.
No se permite desactivar categorías con productos activos ni cambiar unidad
de productos con historial. Se comprueban pertenencia, actividad, stock
insuficiente, precisión y versión antes de guardar.

La simulación vive en memoria y serializa sus mutaciones en JavaScript; su
comparación de contenido no implementa un hash criptográfico ni bloqueos de
PostgreSQL. Esto permite desarrollar módulos sin backend y no acredita la
integración ni concurrencia transaccional real de Django/PostgreSQL.

### Verificación de fase 2

```powershell
npm.cmd run test:fase2
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

`verificar-fase2.mjs` comprueba validaciones, filtros/paginación, decimales,
permisos mínimos, actor permitido/denegado, negocio ajeno, cancelación,
idempotencia y conflictos de saldo/versión; compara saldo e historial tras
errores para detectar cambios parciales. Los permisos nuevos se buscan por
código, sin fijar sus IDs. `verificar-http-fase2.mjs` sustituye fetch para
comprobar rutas, query strings, payloads, signal, CSRF y ausencia de reintentos.
`npm.cmd test` incluye ambas pruebas y las regresiones de fase 1.
Queda pendiente verificar estos endpoints contra Django/PostgreSQL mediante
la entrega de integración F3; los resultados del mock no prueban persistencia real.

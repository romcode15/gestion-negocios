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

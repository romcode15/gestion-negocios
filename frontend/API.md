# API tipada, simulación y cliente HTTP

## Estado y alcance

Esta issue continúa sobre la base de #11 por indicación del equipo, aunque su revisión e integración en dev siguen pendientes. El PR debe declarar esa dependencia y actualizarse al integrar la base.

No incorpora pantallas, providers de sesión ni autorización visual. No cambia backend. Las pruebas de HTTP sustituyen fetch; no demuestran integración real con Django/PostgreSQL.

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
| `features/roles/api` | `crearRol(negocioId, { nombre, permiso_ids }, opciones?): Promise<Rol>` |
| `features/membresias/api` | `listarMembresias(negocioId, opciones?): Promise<Pagina<Membresia>>` |
| `features/membresias/api` | `crearMembresia(negocioId, { username, rol_id, password? }, opciones?): Promise<Membresia>` |
| `features/membresias/api` | `cambiarRolMembresia(negocioId, membresiaId, { rol_id }, opciones?): Promise<Membresia>` |

Para membresías, enviar password únicamente al crear cuenta nueva. La cuenta existente conserva su contraseña. Las respuestas nunca incluyen password. Kelvin puede consumir listarRoles sin esperar ninguna pantalla de Diana.

## Sesión, CSRF y errores

`iniciarSesion` obtiene CSRF antes de enviar credenciales. En HTTP, cada POST/PATCH lee de nuevo la cookie csrftoken y envía X-CSRFToken, con credentials=include. Así se respeta la rotación después del login. Un 204 devuelve undefined sin intentar parsear JSON.

`ApiException` implementa `ApiError`: code, detail y errors (listas por campo). Su propiedad status es metadato del transporte, no un campo añadido a las respuestas del contrato. Errores de red usan network_error/status 0; respuesta ilegible usa invalid_response; HTTP sin el contrato usa http_error.

Ante csrf_failed se obtiene de nuevo el token y se propaga el error. El consumidor ofrece reenvío manual; la mutación nunca se repite automáticamente. La futura sesión compartida deberá limpiar su estado ante not_authenticated. La pantalla manejará permission_denied, not_found y errors por campo. Cancelaciones conservan AbortError y no deben presentarse como fallo de API.

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

Cada operación recibe el ID de negocio explícitamente. El mock valida permisos y membresía activa de ese ID; no mantiene una segunda selección global. El futuro provider compartirá la selección activa. Cancelar evita recibir respuestas del contexto anterior; no garantiza revertir una mutación que el servidor real ya haya confirmado.

## Datos y persistencia simulados

Todo vive en memoria del módulo: datos, sesión, token y credenciales ficticias. Las altas y cambios se reflejan en siguientes consultas mientras la aplicación siga cargada. Al recargar, reiniciar Vite o llamar reiniciarMocks se restaura la semilla y se cierra la sesión. No se usa localStorage, sessionStorage, IndexedDB ni cookies para guardar contraseñas. Las cuentas creadas durante la ejecución también desaparecen al reiniciar.

Cuentas ficticias, todas con contraseña **Demo-12345!**:

| Username | Escenario |
| --- | --- |
| plataforma | Permisos de plataforma; sin membresías iniciales |
| admin_tienda | Administrador de Tienda Central, ID 1 |
| admin_ferreteria | Administrador de Ferretería Norte, ID 2 |
| compartido | Consulta en tienda; sin permisos en ferretería |
| existente | Cuenta activa sin membresías iniciales |

La contraseña es exclusivamente de demostración. El mock exige 8 caracteres al crear una cuenta; no reproduce todos los validadores de contraseñas de Django.

Se validan unicidad de username, nombre de rol por negocio, membresía por usuario/negocio, pertenencia del rol y permisos delegables. El alta de negocio crea su rol administrador y membresía tras validar la entrada. El alta de cuenta y membresía valida todo antes de modificar las colecciones. La seguridad real depende de Django.

## Paginación

Mock: tamaño fijo de **2**, orden ascendente por id (la semilla y las altas mantienen ese orden). Respuestas con count, next, previous y results; página fuera de rango devuelve not_found. Este tamaño y orden son una convención local pendiente de coordinación con backend, cuyos documentos no los fijan.

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

No hay almacenamiento persistente ni llamadas HTTP en modo mock.

## Verificación ejecutada

Desde frontend:

```powershell
node verificar-api.mjs
npm.cmd run lint
npm.cmd run build
```

verificar-api.mjs ejecuta las funciones públicas con mocks y prueba el transporte HTTP con fetch sustituido. Verifica payloads, 204, cookies, rotación de CSRF, errores, paginación, permisos, contexto, mutaciones, validaciones, altas conjuntas, cancelación y reinicio.

No necesita Django. La integración real, las políticas finales de contraseña/paginación y el comportamiento del servidor ante cookies/CSRF quedan pendientes de comprobar con Django/PostgreSQL. No se han añadido ni validado pantallas en esta issue.

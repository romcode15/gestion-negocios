# Verificación · Membresías del negocio (#15)

Rama: `feat/15-membresias` (desde `dev`, base `f07db93`).
Modo de ejecución: `VITE_API_MODE=mock` (predeterminado). Todo lo registrado abajo es
**simulación**; no se declara integración real con Django/PostgreSQL.

## Alcance implementado

- `src/features/membresias/pages/index.tsx`: consulta paginada de membresías y roles del
  negocio activo, gating por permisos y refresco de sesión tras cambiar el rol propio.
- `src/features/membresias/components/`: tabla con estados, selector paginado de roles,
  alta en dos modos y formulario de cambio de rol por `membresia.id`.
- `src/features/membresias/validacion.ts` y `seleccion.ts`: solicitudes tipadas, omisión de
  `password` en cuenta existente y resolución de nombres desde `Rol`.
- `verificar-membresias.mjs`: verificación automatizada enfocada (lógica crítica, render y
  operaciones con mocks). No modifica `app/`, `api/`, `mocks/`, componentes compartidos,
  tipos base, rutas ni `package.json`.

## Comandos y resultados

Ejecutados desde `frontend/`:

| Comando | Resultado |
|---|---|
| `npm.cmd run lint` | Sin advertencias ni errores (`oxlint`). |
| `npm.cmd run build` | Correcto: `tsc -b && vite build`, 51 módulos, `dist/` generado. |
| `npm.cmd run test:api` | Correcto: mocks, HTTP con `fetch` sustituido y funciones públicas. |
| `node verificar-membresias.mjs` | 5 bloques en verde (detalle abajo). |

Salida literal de `node verificar-membresias.mjs`:

```text
OK validación: modos explícitos, password omitido en cuenta existente y rol numérico.
OK selección: paginación acumulada, aislamiento por negocio y nombres sin ampliar el contrato.
OK render: tabla con username/rol/estado, estados de carga y vacío, permisos por acción y modos del formulario.
OK mocks: altas en ambas modalidades, duplicado, rol ajeno, contraseña inválida, cambio por membresía y lecturas posteriores.
OK permisos y contexto: aislamiento entre negocios, cuenta compartida, escenarios y sesión reflejando el cambio de rol propio.
```

### Qué cubre la verificación automatizada

1. **Validación**: `username` vacío, `password` obligatorio solo en modo `nueva`, `rol_id`
   numérico positivo. `aSolicitudMembresia` produce `{ username, password, rol_id }` en cuenta
   nueva y `{ username, rol_id }` en existente; se comprueba `Object.hasOwn(..., 'password') === false`.
   `aSolicitudCambioRol` solo devuelve `{ rol_id }`.
2. **Selección de roles**: acumulación entre páginas, filtro por `negocio_id` (un rol del negocio 2
   nunca aparece en el 1), nombres resueltos desde `Rol` y fallback `Rol #<id>` sin ampliar el contrato.
3. **Render (SSR)**: tabla con `username`, rol y estado; estados de carga y lista vacía; sin
   selector cuando falta `listar_roles`; sin acciones cuando faltan `crear_membresia` o
   `asignar_rol`; modos explícitos y campo `password` solo en cuenta nueva; un solo `<form>` por
   alta (sin formularios anidados).
4. **Operaciones con mocks**: altas en ambas modalidades, duplicado (`username`), rol ajeno al
   negocio (`rol_id`), contraseña corta (`password`), cambio de rol usando `membresia.id` (no
   `usuario.id`), paginación y lecturas posteriores que reflejan las mutaciones; inicio de sesión
   con la cuenta recién creada.
5. **Permisos y contexto**: `compartido` solo puede listar en Tienda Central y nada en
   Ferretería Norte; errores `permission_denied` en altas/cambios; escenarios `empty`,
   `permission_denied`, `not_found` y `validation_error`; la misma cuenta aparece en dos negocios;
   tras cambiar el rol propio la sesión refleja los permisos reducidos.

## Verificación manual en navegador (mocks)

Servidor: `npm.cmd run dev -- --host 127.0.0.1 --port 5174 --strictPort`.
Usuarios: `admin_tienda`, `admin_ferreteria`, `compartido`; contraseña `Demo-12345!`.

| Paso | Resultado observado |
|---|---|
| Ingresar como `admin_tienda` y abrir **Membresías** | Tabla con `admin_tienda / Administrador de negocio / Activo` y `compartido / Consulta / Activo`. Nombres de rol resueltos desde `Rol`. Sin errores de consola. |
| Seleccionar **Crear cuenta nueva**, completar `browser_nuevo`, contraseña y rol `Consulta`, enviar | Mensaje `Miembro browser_nuevo incorporado.`; el formulario se limpia; al paginar aparece `browser_nuevo / Consulta / Activo`. |
| Cambiar a **Usar cuenta existente** | El campo `Contraseña` desaparece; se borran contraseña y errores previos. |
| Alta de `existente` con rol `Administrador de negocio` | `Miembro existente incorporado.`; la cuenta se agrega sin contraseña (los mocks no emiten HTTP; la omisión está verificada en el paso 1 automatizado). |
| Repetir el alta de `existente` | Error por campo bajo **Nombre de usuario**: `La cuenta ya pertenece al negocio.`; foco en el primer campo inválido. |
| Cambiar el rol propio de `admin_tienda` a `Consulta` | La fila pasa a `Consulta`; desaparece la columna **Cambiar rol** y el formulario de alta; aparecen `No tienes permiso para incorporar miembros.` y `No tienes permiso para cambiar roles.`; la navegación se reevalúa y se mantiene Membresías porque `Consulta` conserva `listar_membresias`. Sin errores de consola. |
| Cerrar sesión e ingresar como `admin_ferreteria`, abrir **Membresías** | Solo `admin_ferreteria / Administrador de negocio` y `compartido / Sin permisos`. El selector ofrece `Administrador de negocio` y `Sin permisos`; no aparecen `Consulta`, `browser_nuevo` ni `Tienda Central`. |
| Cerrar sesión e ingresar como `compartido` | Vista de solo lectura en Tienda Central: sin columna **Cambiar rol** ni formulario de alta, con los dos avisos de permiso. |
| Cambiar el negocio activo a **Ferretería Norte** y volver a **Tienda Central** (incluido un cambio rápido) | En Ferretería Norte se muestra **Acceso denegado** (sin permisos); al volver se recargan solo los miembros de Tienda Central. No se mezclan datos de un negocio en otro; no hay estados `Cargando` rezagados ni errores de consola. |

La misma cuenta `compartido` aparece con rol `Consulta` en Tienda Central y `Sin permisos` en
Ferretería Norte, comprobando que no se reutiliza la membresía de un contexto en el otro.

## Escenarios comprobados

- **Carga**: estados `Cargando…` y tabla poblada.
- **Vacío**: escenario `empty` y lista sin miembros (`No hay membresías`).
- **Éxito**: altas en ambas modalidades y cambio de rol; las lecturas posteriores reflejan los cambios.
- **Validación**: campos vacíos, duplicado, usuario inexistente/inactivo, contraseña inválida,
  rol ajeno al negocio y `membresia_id` inexistente.
- **Falta de acceso**: `listar_membresias`, `crear_membresia`, `asignar_rol` y `listar_roles`
  evaluados de forma independiente; sin `listar_roles` no se consulta roles y se muestra la limitación.
- **Contexto**: cuenta en dos negocios, cambio rápido de negocio, lista vacía y actualización de la
  sesión al cambiar el rol propio.
- **Sesión vencida / CSRF / credenciales**: cubiertos por `npm.cmd run test:api` (`verificar-api.mjs`),
  que comprueba `not_authenticated`, `invalid_credentials` y rotación CSRF con `fetch` sustituido.

## Coordinación de contrato

- El contrato de `Membresia` no incluye `nombre_rol`; los nombres se resuelven desde `Rol` usando
  `GET /negocios/{negocio_id}/roles/`. Sin `listar_roles`, el selector muestra la limitación y se
  usa el fallback visual `Rol #<id>`; no se elude el permiso. Si el flujo necesita mostrar siempre
  el nombre, coordinar con Henry y Romel antes de ampliar el contrato.
- Los escenarios del navegador se simulan en memoria. `configurarMocks` no está expuesto en
  `window`, por lo que los escenarios distintos de `normal` se ejercitan en
  `verificar-membresias.mjs` y `verificar-api.mjs`, no mediante la interfaz.

## Pendiente con Django/PostgreSQL

Todo lo anterior usa `VITE_API_MODE=mock`. Queda por comprobar contra el backend real:

- `GET /api/v1/negocios/{negocio_id}/membresias/` — paginación real, filtro por negocio activo y
  resolución de nombres con los roles devueltos por Django.
- `POST /api/v1/negocios/{negocio_id}/membresias/` — alta de cuenta nueva y de cuenta existente
  (confirmar que el backend omite/ignora `password` en la segunda y que valida duplicados,
  usuario inactivo/inexistente y contraseña débil con `400` y errores por campo).
- `PATCH /api/v1/negocios/{negocio_id}/membresias/{membresia_id}/` — envío exclusivo de
  `{ rol_id }`, uso real de `membresia.id` y validación de rol perteneciente al negocio.
- `GET /api/v1/negocios/{negocio_id}/roles/` — paginación real y permiso `listar_roles`.
- Refresco de sesión (`/auth/me/`) tras cambiar el rol del usuario actual y reevaluación de
  navegación/acceso con las cookies y CSRF reales.
- Códigos HTTP y forma de `ApiError` del contrato (`400`, `403`, `404`, paginación y `snake_case`).

Los issues de backend #9 y #10 son referencias para esa coordinación; no bloquearon este trabajo.

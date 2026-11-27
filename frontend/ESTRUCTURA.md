# Estructura de desarrollo del frontend

## Base de ventas · Fase 3 / F1 (#89)

Base revisada: `dev` en `02fd4ee`, con PR #79 y las bases B1/B2 integradas.
Fuentes: [contrato común](../fase3.md) y [guía frontend](fase3.md).

```text
src/features/ventas/
├── types.ts                     # DTO exactos de fase 3, Henry/F2
├── api.ts                       # Siete funciones mock/HTTP, Henry/F2
├── draft/
│   ├── types.ts                 # Estado local, no DTO de API
│   ├── state.ts                 # Validación/cambios atómicos del borrador
│   ├── operaciones.ts           # Snapshot/UUID congelados y normalización
│   ├── VentaDraftContext.ts     # Contexto y useVentaDraft
│   ├── VentaDraftProvider.tsx   # Aislamiento por sesión/negocio y bloqueo
│   └── index.ts                 # Exportaciones públicas
├── pages/
│   ├── NuevaVentaPage.tsx       # Composición de Henry
│   ├── VentasPage.tsx           # Entrada informativa; Kelvin desde F7
│   └── index.ts
└── components/
    ├── shared/
    │   ├── contracts.ts         # Props/callbacks de piezas independientes
    │   ├── erroresLinea.ts      # Errores por snapshot enviado
    │   └── PiezaVentaPendiente.tsx
    └── nueva/
        ├── SelectorProductosVenta.tsx # Stub; Diana/F4 (#91)
        ├── CarritoVenta.tsx           # Stub; Diana/F5 (#92)
        └── ConfirmarVenta.tsx         # Stub; Diana/F6 (#93)
```

Henry mantiene rutas, `draft/`, `components/shared/` y la composición de
`NuevaVentaPage`. Diana sustituye los tres stubs de `nueva/` manteniendo sus
exportaciones y props. Kelvin completa `VentasPage` y crea
`components/consulta/{ListaVentas,DetalleVentaPanel,MovimientosVenta,AnularVentaModal}`
en F7–F9. No duplicar provider ni importar páginas de otro autor para obtener
estado. Coordinar cambios a contratos compartidos con Henry.

F2 (#90), sobre `dev` en `e572140` con PR #104 integrado, incorpora
`ventas/types.ts`, `ventas/api.ts`, importes exactos y simulación.
`ProductoVentaDraft` es un alias de `VentaProductoOpcion`, sin duplicar modelos.
Los genéricos de consulta reciben VentaResumen/VentaDetalle de F2.
`mocks/data/fase3.ts` prepara antecedentes y `mocks/services/fase3.ts` resuelve
ventas sobre `mocks/services/almacen.ts`, también usado por fase 2. Las páginas
no deben importar esos archivos internos.

Rutas del router existente:

- `/negocio/nueva-venta`: `registrar_venta`.
- `/negocio/ventas`: cualquiera de `registrar_venta`, `listar_ventas`, `anular_venta`.

Los placeholders informan qué está pendiente, sin formularios, éxito ficticio
ni llamadas HTTP. Sin `listar_ventas`, la base indica que el detalle por ID se
completará en F8. F2 amplía los administradores del mock con los tres nuevos
códigos, conservando roles limitados. La navegación ya
acepta sesiones autorizadas que contengan los códigos de ventas.

Prueba propia: `npm.cmd run test:ventas-base`, incluida en `npm.cmd test`.
Contratos y simulación F2: `npm.cmd run test:ventas-api`, también en la suite.
Contratos y límites: [COMPONENTES.md](COMPONENTES.md).

La fase 1 incorpora tipos compartidos, sesión, selección de negocio, componentes, layouts y pantallas de autenticación, plataforma, roles y membresías. Las llamadas tipadas pueden usar simulación o HTTP sin cambiar las pantallas.

Fuentes obligatorias: [fase 1 frontend](fase1.md), [fase 1 backend](../backend/Fase1.md) y [README del proyecto](../README.md).

## Mapa de carpetas

```text
src/
├── main.tsx                 # Entrada de React y estilos globales
├── App.tsx                  # Composición principal
├── app/
│   ├── providers/           # Sesión y negocio activo compartidos
│   ├── layouts/             # Paneles y navegación
│   └── routes/              # Rutas y acceso a pantallas
├── api/
│   └── types/               # ApiError y Pagina<T>
├── mocks/
│   ├── data/                # Datos ficticios iniciales
│   └── services/            # Operaciones y validaciones simuladas
├── components/
│   ├── ui/                  # Botones, campos y controles compartidos
│   └── feedback/            # Carga, listas vacías y errores
├── features/
│   ├── auth/
│   │   ├── components/      # Formulario de autenticación
│   │   └── pages/           # Login
│   ├── usuarios/            # Tipos y operaciones de cuentas
│   ├── negocios/
│   │   ├── components/      # Selector, tabla y alta de negocios
│   │   └── pages/           # Panel de plataforma
│   ├── roles/
│   │   ├── components/      # Tabla, formulario y permisos delegables
│   │   └── pages/           # Gestión de roles
│   └── membresias/
│       ├── components/      # Tabla, alta y cambio de rol
│       └── pages/           # Gestión de miembros
└── assets/                  # Imágenes e iconos importados
```

## Archivos de cada funcionalidad

Crear `types.ts` y `api.ts` en la raíz de la funcionalidad cuando lo requiera su issue. Los componentes usan nombres como `CrearRolForm.tsx`; las pantallas, `RolesPage.tsx`. No crear archivos vacíos TypeScript solo para completar el mapa.

Definir cada tipo una sola vez:

| Tipo | Ubicación |
|---|---|
| Usuario | `features/usuarios/types.ts` |
| Negocio | `features/negocios/types.ts` |
| Rol y Permiso | `features/roles/types.ts` |
| Membresia | `features/membresias/types.ts` |
| Sesion | `features/auth/types.ts` |
| ApiError y Pagina<T> | `api/types/` |

Separar tipos de entrada y respuesta cuando sus campos difieran. Importar tipos y operaciones desde su módulo de origen, sin duplicarlos. Una funcionalidad puede consumir operaciones de otra, pero no debe depender de sus páginas para obtener datos.

## Simulación y conexión con Django

```text
Pantalla → features/<funcionalidad>/api.ts → implementación simulada o HTTP
```

- Las pantallas llaman funciones tipadas como `crearNegocio()`, `listarRoles()` y `crearMembresia()`. No importan directamente JSON ni dispersan llamadas `fetch`.
- `mocks/data/` admite JSON o datos TypeScript ficticios que respeten el contrato. Preparar al menos dos negocios con roles y membresías distintos. No incluir credenciales reales.
- `mocks/services/` implementa sesión, consultas, altas, cambios de rol, paginación y errores. El JSON estático por sí solo no simula estas operaciones.
- `api/client.ts` selecciona entre implementación simulada y HTTP con `VITE_API_MODE`, conservando firmas, respuestas y errores. No repartir comprobaciones de modo simulado por las pantallas. Documentar cómo persisten y se reinician los datos simulados.
- `api/` contiene el cliente HTTP común: prefijo `/api/v1`, sesiones, CSRF, respuesta 204 y errores. Las operaciones propias de cada funcionalidad viven en su `api.ts`.
- La simulación permite verificar carga, listas vacías, errores por campo, falta de permisos y sesión vencida. Incluir roles iniciales para que membresías no dependa de la pantalla de creación de roles.
- Al cambiar de negocio, limpiar selecciones y descartar respuestas pendientes del negocio anterior. Django es responsable de la autorización real.
- El proxy `/api` de Vite reenvía a Django en `127.0.0.1:8000` conservando el host. Activar `VITE_API_MODE=http` y reiniciar Vite. Las cuentas y datos del modo HTTP pertenecen a PostgreSQL; ver [README](README.md).

## Responsables y límites

| Responsable | Carpetas y responsabilidades previstas |
|---|---|
| Henry | `app/`, `api/`, `mocks/`, `components/`, tipos iniciales, autenticación y composición en App/main. |
| Kelvin | Funcionalidades de plataforma en `negocios/` y `usuarios/`, módulo `membresias/` y coordinación de pruebas. |
| Diana | Módulo `roles/`, selección de permisos y seguimiento de issues. |

Henry integra primero la base compartida. Después Kelvin y Diana avanzan en sus módulos con la API simulada, sin esperar las pantallas del otro. Coordinar con Henry cualquier cambio a tipos o archivos compartidos.

Crear una rama por issue desde `dev` actualizada y abrir el PR hacia `dev`. Implementar únicamente el alcance del issue y seguir las reglas de fase 1. Mantener los componentes de dominio en `features/` y evitar concentrar la aplicación en `App.tsx`.

Antes del PR, ejecutar desde `frontend/`:

```powershell
npm.cmd run lint
npm.cmd run build
```

La pantalla inicial de Vite fue sustituida por las pantallas funcionales de fase 1. Las interfaces disponibles se describen a continuación.

## Base compartida implementada

Los tipos del contrato y sus solicitudes están en los módulos propietarios indicados arriba. `ApiError` y `Pagina<T>` se importan desde `src/api/types`. Los tipos de respuesta no incluyen contraseñas ni campos de solicitudes.

### Interfaces de integración

- `components/ui/Button`: props nativas de button, `pending` y `pendingLabel`. El tipo predeterminado es button: usar `type="submit"` para guardar. `pending` bloquea el control. El formulario debe además impedir envíos repetidos desde su manejador y bloquear sus campos mientras guarda.
- `components/ui/TextField`: props nativas de input, `label`, `hint` y `errors: string[]`. Genera IDs únicos, vincula etiqueta y mensajes, y marca `aria-invalid`. Pasar `name`, `required` y `autoComplete` según el formulario. Tras validar, el formulario enfoca el primer campo inválido.
- `components/feedback/Feedback`: `Loading`, `EmptyState`, `ErrorMessage` y `AccessDenied`. Los errores generales anuncian alertas; carga usa status. `AccessDenied` presenta el mensaje, sin implementar autorización.
- `app/layouts/Layouts`: `LoginLayout`, `PlataformaLayout` y `NegocioLayout` reciben children; los paneles admiten navigation como ReactNode.
- Cada módulo exporta su página desde `features/<modulo>/pages/index.tsx`: `AuthPage`, `NegociosPage`, `RolesPage` y `MembresiasPage`. Cada responsable mantiene el contenido de su página conservando esa exportación. No deben editar App.tsx, main.tsx ni app/routes.
- Henry mantiene `app/routes/modules.ts`, el registro tipado `EntradaModulo` con id, label, path y Page. Las rutas actuales son `/`, `/plataforma`, `/negocio/roles` y `/negocio/membresias`. El router controla el acceso por sesión y códigos de permisos. La navegación usa enlaces internos; el servidor de producción deberá redirigir las rutas de la aplicación a index.html. Vite ya permite acceso directo en desarrollo.
- Los enlaces y comprobaciones visuales de permisos se componen desde `app/`. El provider restaura la sesión y descarta respuestas del negocio anterior. La autorización de cada operación se realiza en Django.

### Estado de la fase 1

La capa de datos ya está disponible: funciones públicas en `features/<modulo>/api.ts`, selección central en `api/client.ts`, transporte HTTP en `api/http.ts` y servicios simulados en `mocks/services/transport.ts`. Las firmas, escenarios y límites se documentan en [API.md](API.md). Las pantallas y el provider están implementados. Los formularios mantienen estado local y usan cancelación al cambiar de contexto. Membresías consulta `roles/asignables/` con sus permisos de escritura, sin exigir `listar_roles`; el listado general conserva su permiso propio.

### Ejecución

Desde frontend: `npm.cmd ci`, `npm.cmd run dev`. Comprobaciones: `npm.cmd test`, `npm.cmd run lint` y `npm.cmd run build`. Consultar configuración y escenarios en [API.md](API.md).

Esta sección sustituye las notas anteriores que describían todas las carpetas como vacías y la conservación de la pantalla de Vite. La estructura está versionada junto con el código; no necesita archivos del equipo de otro integrante.

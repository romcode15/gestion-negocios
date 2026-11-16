# Estructura de desarrollo del frontend

Esta base incorpora tipos del contrato, componentes compartidos, layouts y entradas de páginas pendientes. La sesión, la simulación y las pantallas funcionales se implementarán en sus issues. Los `.gitkeep` conservan las carpetas reservadas.

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
- `mocks/services/` implementará sesión, consultas, altas, cambios de rol, paginación y errores. El JSON estático por sí solo no simula estas operaciones.
- Henry definirá una selección central entre implementación simulada y real, conservando firmas, respuestas y errores. No repartir comprobaciones de modo simulado por las pantallas. Documentar cómo persisten y se reinician los datos simulados.
- `api/` alojará el cliente HTTP común: prefijo `/api/v1`, sesiones, CSRF, respuesta 204 y errores. Las operaciones propias de cada funcionalidad viven en su `api.ts`.
- La simulación permitirá verificar carga, listas vacías, errores por campo, falta de permisos y sesión vencida. Incluir roles iniciales para que membresías no dependa de la pantalla de creación de roles.
- Al cambiar de negocio, limpiar selecciones y descartar respuestas pendientes del negocio anterior. Django seguirá siendo responsable de la autorización real.
- La conexión posterior configurará el proxy de Vite y sustituirá la implementación simulada por HTTP, manteniendo las llamadas de las pantallas. El cierre de integración requiere validar con Django y PostgreSQL.

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

La pantalla de Vite fue sustituida por puntos de entrada pendientes. Las interfaces disponibles se describen a continuación.

## Base compartida implementada

Los tipos del contrato y sus solicitudes están en los módulos propietarios indicados arriba. `ApiError` y `Pagina<T>` se importan desde `src/api/types`. Los tipos de respuesta no incluyen contraseñas ni campos de solicitudes.

### Interfaces de integración

- `components/ui/Button`: props nativas de button, `pending` y `pendingLabel`. El tipo predeterminado es button: usar `type="submit"` para guardar. `pending` bloquea el control. El formulario debe además impedir envíos repetidos desde su manejador y bloquear sus campos mientras guarda.
- `components/ui/TextField`: props nativas de input, `label`, `hint` y `errors: string[]`. Genera IDs únicos, vincula etiqueta y mensajes, y marca `aria-invalid`. Pasar `name`, `required` y `autoComplete` según el formulario. Tras validar, el formulario enfoca el primer campo inválido.
- `components/feedback/Feedback`: `Loading`, `EmptyState`, `ErrorMessage` y `AccessDenied`. Los errores generales anuncian alertas; carga usa status. `AccessDenied` presenta el mensaje, sin implementar autorización.
- `app/layouts/Layouts`: `LoginLayout`, `PlataformaLayout` y `NegocioLayout` reciben children; los paneles admiten navigation como ReactNode.
- Cada módulo exporta su página desde `features/<modulo>/pages/index.tsx`: `AuthPage`, `NegociosPage`, `RolesPage` y `MembresiasPage`. Kelvin y Diana sustituyen el contenido de su página conservando esa exportación. No deben editar App.tsx, main.tsx ni app/routes.
- Henry mantiene `app/routes/modules.ts`, el registro tipado `EntradaModulo` con id, label, path y Page. Las rutas actuales son `/`, `/plataforma`, `/negocio/roles` y `/negocio/membresias`. Son puntos de entrada pendientes, no flujos terminados. La navegación usa enlaces nativos; el servidor de producción deberá redirigir las rutas de la aplicación a index.html. Vite ya permite acceso directo en desarrollo.
- Los futuros enlaces y comprobaciones de permisos se compondrán desde app/. Estas rutas todavía no tienen sesión ni protección. No muestran datos de negocio.

### Alcance pendiente

La capa de datos ya está disponible: funciones públicas en `features/<modulo>/api.ts`, selección central en `api/client.ts`, transporte HTTP en `api/http.ts` y servicios simulados en `mocks/services/transport.ts`. Las firmas, escenarios y límites se documentan en [API.md](API.md). Las pantallas y el provider de sesión/negocio activo siguen pendientes. Los formularios mantendrán estado local y usarán señales de cancelación al cambiar de contexto.

### Ejecución

Desde frontend: `npm.cmd ci`, `npm.cmd run dev`. Comprobaciones: `npm.cmd run lint` y `npm.cmd run build`. La guía de verificación se encuentra en [VERIFICACION.md](VERIFICACION.md).

Esta sección sustituye las notas anteriores que describían todas las carpetas como vacías y la conservación de la pantalla de Vite. La estructura está versionada junto con el código; no necesita archivos del equipo de otro integrante.

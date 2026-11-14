# Estructura de desarrollo del frontend

Esta estructura prepara el trabajo de fase 1. Las carpetas están vacías: la lógica y las pantallas se implementarán en sus issues. Los `.gitkeep` permiten versionar directorios vacíos y pueden retirarse cuando contengan código.

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

La pantalla actual de Vite se conserva hasta que los issues de implementación la sustituyan. Esta estructura no incorpora todavía navegación, tipos, servicios o simulación funcional.

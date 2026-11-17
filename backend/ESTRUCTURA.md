# Estructura de desarrollo del backend

Esta estructura define dónde implementar los siete issues de fase 1. El núcleo de modelos y preparación inicial de #4 se documenta en [MODELOS.md](MODELOS.md). La capa HTTP se desarrolla desde #5.

La autenticación y las bases compartidas de #5 se describen en [API.md](API.md). Plataforma, roles y membresías mantienen sus URLs vacías hasta sus respectivas entregas.

Consultar [Fase1.md](Fase1.md), [README del proyecto](../README.md) y el [contrato frontend](../frontend/fase1.md). Las carpetas Python incluyen `__init__.py`; las migraciones nuevas se crean durante el desarrollo, sin editar la migración existente de Usuario.

## Mapa de carpetas

```text
backend/
├── config/                  # Settings y composición de URLs; Romel
├── cuentas/                 # Usuario existente; conservar AbstractUser
│   └── migrations/
├── negocios/                # App de dominio: Negocio; Romel
│   ├── models.py
│   ├── migrations/
│   └── tests/               # Restricciones del modelo
├── accesos/                 # App de dominio: roles, permisos y membresías
│   ├── models.py            # Modelos y restricciones; Romel
│   ├── migrations/
│   ├── management/commands/ # Preparación inicial idempotente; Romel
│   └── tests/               # Integridad y preparación inicial
├── api/                     # Capa HTTP; no es una app de modelos
│   ├── common/              # Errores, permisos, paginación y contexto; Romel
│   ├── auth/                # Sesiones, CSRF y representación de Sesion; Romel
│   │   └── tests/
│   ├── plataforma/          # Usuarios y alta de negocios; Romel
│   │   └── tests/
│   ├── roles/               # Consultas, creación y permisos delegables; Sebastián
│   │   └── tests/
│   └── membresias/          # Incorporación y cambio de rol; Diego
│       └── tests/
└── tests/
    ├── support/             # Fábricas/datos compartidos de pruebas; Romel
    └── integration/         # Flujo completo; coordinación de Diego
```

`negocios` y `accesos` están registradas en INSTALLED_APPS y contienen sus migraciones iniciales. No registrar `api/` como app de modelos ni mover Usuario a otra app.

## Archivos que se crean al implementar cada módulo

| Archivo | Responsabilidad |
|---|---|
| `serializers.py` | Campos explícitos de entrada/salida y validaciones. |
| `views.py` | Vistas genéricas DRF y coordinación de la solicitud. |
| `selectors.py` | Consultas y filtrado por contexto autorizado cuando resulte útil. |
| `services.py` | Operaciones de escritura que coordinan modelos y transacciones. |
| `urls.py` | Rutas exclusivas del módulo. |
| `tests/test_*.py` | Casos de aceptación y seguridad del módulo. |

Crear solo los archivos necesarios; no duplicar la lógica entre capas. Los modelos están en cuentas, negocios y accesos, no dentro de los módulos HTTP. Un CRUD simple puede usar serializer.save(); las operaciones conjuntas requieren servicio y transaction.atomic().

## Responsabilidades por issue

| Issue | Responsable | Archivos principales |
|---|---|---|
| #4 Modelos y preparación inicial | Romel | cuentas/, negocios/, accesos/, config/settings.py y tests/support/. |
| #5 Sesión e infraestructura común | Romel | api/common/, api/auth/, api/urls.py y config/. |
| #6 Plataforma | Romel | api/plataforma/. |
| #7 y #8 Roles | Sebastián | api/roles/. |
| #9 y #10 Membresías | Diego | api/membresias/. |

Romel concentra modelos, migraciones y componentes compartidos. Sebastián y Diego reutilizan esos imports y solicitan los ajustes necesarios; no modifican el esquema ni crean modelos alternativos dentro de sus módulos. No mover cuentas/tests.py a un paquete tests/ sin revisar primero su contenido; las pruebas nuevas de HTTP se alojan en api/.

## Composición de rutas sin conflictos

En #5 se crean `api/urls.py` y los `urls.py` de auth, plataforma, roles y membresias. Los módulos todavía no implementados tienen `urlpatterns = []`. La composición desde config/urls.py bajo `/api/v1/` es:

| Módulo | Prefijo que debe añadir la composición común |
|---|---|
| api/auth/urls.py | `auth/` |
| api/plataforma/urls.py | `plataforma/` |
| api/roles/urls.py | `negocios/<int:negocio_id>/` |
| api/membresias/urls.py | `negocios/<int:negocio_id>/` |

Los dos últimos prefijos coinciden intencionalmente: roles define únicamente `permisos/` y `roles/`; membresias define `membresias/` y `membresias/<int:membresia_id>/`. Conservar barra final y evitar duplicar los prefijos en los archivos internos. No agregar capturas genéricas que absorban rutas del otro módulo.

Después de integrar #5, cada autor completa solo su urls.py. No necesita editar la composición raíz al añadir sus endpoints. Los cuatro endpoints de autenticación ya están definidos en esa entrega.

## Pruebas independientes y trabajo en paralelo

- #4 → #5 → #6 forman la base común integrada en dev. Después, Sebastián trabaja #7 → #8 y Diego #9 → #10, sin dependencias entre ambos módulos.
- Los fixtures o fábricas de tests/support/ crean cuentas, negocios, roles y membresías mediante modelos y helpers compartidos. Las pruebas de membresías no llaman al POST de roles y las de roles no llaman al POST de membresías.
- Mantener las pruebas de cada módulo dentro de su carpeta; reservar tests/integration/ para el flujo completo al final. No compartir archivos de pruebas editados por ambos autores.
- Usar PostgreSQL y una base de pruebas separada. No ejecutar limpieza de pruebas sobre la base de uso normal. Documentar la configuración necesaria, sin subir credenciales ni cambiar a SQLite para eludir restricciones.
- En pruebas de seguridad, habilitar comprobación real de CSRF y verificar acceso permitido, denegado y datos de otro negocio. Las escrituras conjuntas prueban rollback.
- El #10 puede desarrollar sus pruebas sin #8. La comprobación integral de la fase se realiza cuando todas las entregas estén integradas; cada responsable corrige su módulo.

## Entrega

Crear rama por issue desde dev actualizada y PR hacia dev. Implementar el alcance del issue y respetar Fase1.md; los cambios de contrato se coordinan con Romel y Henry.

Desde backend, con el entorno configurado:

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py test
```

Para pruebas aisladas de modelos y migraciones sin modificar permisos de la base local, consultar tools/verificar_postgres.py y [MODELOS.md](MODELOS.md). La fase requiere además las pruebas y criterios de aceptación de cada issue.

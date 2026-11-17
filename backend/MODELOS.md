# Núcleo de datos de fase 1 · Issue #4

Esta entrega implementa modelos, restricciones y preparación inicial. Sesiones, autorización HTTP y endpoints se desarrollan en #5 y posteriores. Los roles del dominio son independientes de los Groups/Permissions e is_superuser de Django.

## Imports y relaciones

```python
from django.contrib.auth import get_user_model
from negocios.models import Negocio
from accesos.models import Permiso, Rol, RolPermiso, UsuarioRolGlobal, Membresia
from accesos.services import (
    preparar_catalogo,
    preparar_administrador_negocio,
    asignar_superadministrador,
)
```

| Modelo | Campos del núcleo y relaciones |
|---|---|
| Usuario | Se conserva cuentas.Usuario y su migración original; obtenerlo con get_user_model(). |
| Negocio | id, nombre (150), tipo (100), activo=True. El nombre no es único; el tenant se identifica por ID. |
| Permiso | id, codigo único (100), ambito: plataforma o negocio. |
| Rol | id, nombre (150), negocio nullable, predefinido=False. Nombre único por negocio o dentro del ámbito global. |
| RolPermiso | rol, permiso; par único. |
| UsuarioRolGlobal | usuario, rol; par único y solo roles globales. |
| Membresia | id, usuario, negocio, rol, activo=True; par usuario/negocio único aunque la membresía esté inactiva. |

Los IDs se generan como BigAutoField. Las listas de Negocio, Permiso, Rol y Membresia tienen orden inicial por id. La API debe conservar un orden estable al paginar.

Imports de consulta reutilizables:

```python
# Relaciones inversas del dominio; no ejecutan autorización por sí mismas.
usuario.roles_globales.select_related("rol")
usuario.membresias.select_related("negocio", "rol")
rol.permisos_asignados.select_related("permiso")
```

No se expone un ManyToMany automático de permisos: escribir las asociaciones con RolPermiso para que sus guardados individuales pasen por validación. El campo permiso_ids de la API se construirá en el serializer; no es un campo adicional del modelo.

## Garantías de integridad

PostgreSQL garantiza claves foráneas, codigo único, ámbito permitido, pares únicos y nombres de rol únicos. Dos índices condicionales separan nombres globales (negocio NULL) y nombres por negocio, sin depender de la semántica de unicidad de NULL.

Las relaciones entre tablas se validan en clean(): rol del mismo negocio en Membresia, rol global en UsuarioRolGlobal y ámbito compatible en RolPermiso. Los modelos nuevos ejecutan full_clean() explícitamente al guardar; Django no lo hace automáticamente en su save() original. Una creación mediante objects.create() y un guardado individual validan también esas relaciones.

El negocio de un Rol y el ámbito de un Permiso existentes no pueden cambiarse mediante guardados individuales. Esto impide invalidar posteriormente membresías y asociaciones ya guardadas. Para otro ámbito se crea otro registro.

**Límite:** update(), bulk_create(), bulk_update(), SQL directo y operaciones equivalentes eluden save()/clean(). Las restricciones de PostgreSQL siguen aplicándose, pero no las comprobaciones entre tablas. Los flujos de escritura del proyecto deben usar guardados individuales o servicios validados; no usar esas operaciones para escribir relaciones del dominio. Los tests omiten save() deliberadamente solo para comprobar las restricciones físicas.

Los serializers futuros deben devolver errores por campo usando las reglas comunes de #5. No confiar en que la interfaz o el nombre de un rol autoricen una operación. Las decisiones sobre quién puede delegar/asignar roles y sobre el último administrador corresponden a #5.

### Borrado

- PROTECT para cuentas, negocios y roles referenciados por membresías o asignaciones globales; también para permisos referenciados. Eliminar un registro padre no elimina silenciosamente sus accesos.
- CASCADE solo desde un Rol eliminado a sus RolPermiso. Un rol referenciado por miembros o asignaciones globales no puede eliminarse.
- El estado activo se conserva como dato; esta entrega no incorpora endpoints de borrado ni desactivación.

## Preparación inicial

Configurar el entorno según el README. Desde backend:

```powershell
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py preparar_accesos
```

El comando crea los cuatro permisos de plataforma, los cinco de negocio y el rol global Superadministrador con permisos de plataforma. Se puede repetir sin duplicarlos. Un catálogo incompatible o un rol personalizado con el nombre reservado produce un error; no se transforma silenciosamente en rol predefinido. No hay señales ni creación automática de cuentas.

Para preparar la cuenta inicial, crear una cuenta mediante el mecanismo de Django (por ejemplo createsuperuser con contraseña introducida de manera interactiva) y asignarle explícitamente el rol global:

```powershell
.\.venv\Scripts\python.exe manage.py createsuperuser
.\.venv\Scripts\python.exe manage.py preparar_accesos --username nombre_de_la_cuenta
```

Sustituir nombre_de_la_cuenta por una cuenta activa existente. La asignación es idempotente y no cambia contraseña, is_staff o is_superuser. Esos flags de Django no sustituyen UsuarioRolGlobal. Una cuenta inexistente o inactiva se rechaza.

En el servicio transaccional de alta de negocio de #6, después de guardar el negocio:

```python
# Ejecutar dentro de la transacción que crea el negocio y su membresía.
rol = preparar_administrador_negocio(negocio)
# Crear luego Membresia para la cuenta administradora validada.
```

El helper crea el rol predefinido del negocio con los cinco permisos de negocio. No crea la cuenta, el negocio ni la membresía. Los helpers usan transaction.atomic(); la transacción externa debe abarcar la operación completa en #6.

## Datos y ejecución de pruebas

Las fábricas de tests/support/factories.py ofrecen crear_contexto_negocio() y crear_dos_negocios(), que devuelven negocio, administrador, rol y membresía. Crean cuentas con contraseña inutilizable, sin credenciales reales y sin llamar endpoints. Deben usarse únicamente dentro de pruebas y sus transacciones.

Para ejecutar la suite con la base de pruebas separada que crea Django:

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py test
```

Django necesita poder crear su base test_<DB_NAME>, o una base de pruebas dedicada ya preparada por el administrador y utilizada con --keepdb. No usar la base del trabajo normal como base de pruebas ni ampliar permisos del usuario de la aplicación solo para ejecutar tests.

### Verificación aislada sin modificar permisos del entorno

Si están instaladas las herramientas del servidor PostgreSQL, el siguiente comando inicia una instancia temporal con autenticación SCRAM y una contraseña aleatoria, aplica las migraciones desde cero y ejecuta la suite en otra base de pruebas. Detiene el servidor y elimina únicamente su directorio temporal al finalizar; no usa las credenciales o datos del .env.

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py
```

Busca las herramientas en PATH o en C:/Program Files/PostgreSQL/18/bin. Para otra instalación:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py --pg-bin "C:\Program Files\PostgreSQL\17\bin"
```

El script usa el intérprete actual y escucha solo en 127.0.0.1 con un puerto libre. Requiere permiso del sistema para ejecutar los binarios y crear archivos temporales. Si una comprobación falla, termina con error; no informa éxito parcial.

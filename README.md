# Gestión de Negocios

Sistema web multi-tenant desarrollado para la materia de Aplicaciones Web. Permite gestionar distintos negocios desde una misma plataforma, como tiendas, ferreterías, farmacias y restaurantes.

La primera fase funcional cubre usuarios, negocios, roles, permisos y membresías. Sobre esta base se incorporarán catálogo, inventario y ventas.

## Funcionamiento del sistema

| Área | Responsabilidades |
|---|---|
| Administración de la plataforma | El **Superadministrador** gestiona los negocios y asigna al administrador inicial de cada uno. La plataforma contempla la creación de roles globales para delegar tareas administrativas. |
| Administración del negocio | El **Administrador de negocio** incorpora usuarios, crea roles y asigna permisos dentro de su negocio. |
| Operación del negocio | Cada usuario utiliza las funciones habilitadas por su rol. Por ejemplo, un negocio puede crear un rol Cajero con permiso para registrar ventas. |

Los roles predefinidos son **Superadministrador** y **Administrador de negocio**. Los demás roles se crean según las necesidades de cada ámbito. Las cuentas inician sesión con nombre de usuario y contraseña.

### Cómo funciona el tenant

Cada negocio registrado representa un **tenant**. Todos los negocios comparten la misma base PostgreSQL y los datos operativos se identifican mediante `negocio_id`.

Una persona puede usar la misma cuenta en varios negocios. Su **membresía** indica a qué negocio pertenece y qué rol tiene allí. Por ejemplo, puede ser administradora de una ferretería y cajera de una tienda.

En cada operación del negocio, Django valida que el negocio esté activo, que el usuario tenga una membresía activa y que su rol conceda el permiso requerido. Las consultas y escrituras se limitan al negocio validado. Al guardar relaciones, el backend comprueba que los registros pertenezcan al mismo negocio.

## Herramientas y arquitectura

La guía para explorar y probar los endpoints con Swagger UI está en el [README del backend](backend/README.md).

| Área | Herramientas |
|---|---|
| Frontend | React, TypeScript y Vite |
| Backend | Python, Django 5.2 LTS y Django REST Framework |
| Base de datos | PostgreSQL y Psycopg |
| Control de versiones | Git y GitHub |
| Gestión del trabajo | GitHub Issues, Milestones y GitHub Projects |

El proyecto se organiza como un **monorepo**. React consume la API REST de un **backend monolítico modular** en Django. Django centraliza el acceso a PostgreSQL, las reglas de negocio y la autorización. En desarrollo, Django y Vite se ejecutan en terminales separadas.

| Ruta | Contenido |
|---|---|
| `backend/` | Proyecto Django, dependencias de Python y plantilla de configuración local. |
| `backend/config/` | Configuración general de Django. |
| `backend/cuentas/` | Modelo de usuario y migraciones del módulo de cuentas. |
| `frontend/` | Aplicación React con TypeScript y dependencias de npm. |
| `.gitignore` | Exclusiones de credenciales, dependencias locales y archivos de compilación. |

## Base de datos de partida

La **Fase 0** prepara el modelo base de usuario y las tablas que requiere Django. La **Fase 1** incorpora el núcleo de negocios y acceso. Los nombres de la tabla siguiente representan las entidades del diseño.

| Entidad | Campos principales | Propósito |
|---|---|---|
| `usuario` | `id`, `username`, `password`, `is_active` | Cuenta con un nombre de usuario único. `password` almacena el hash generado por Django. |
| `negocio` | `id`, `nombre`, `tipo`, `activo` | Representa una tienda, ferretería, farmacia, restaurante u otro negocio. |
| `rol` | `id`, `nombre`, `negocio_id`, `predefinido` | Tiene alcance global si `negocio_id` es nulo. Si tiene un valor, pertenece a ese negocio. |
| `permiso` | `id`, `codigo`, `ambito` | Representa una acción del sistema. El código es único y el ámbito es `plataforma` o `negocio`. |
| `rol_permiso` | `rol_id`, `permiso_id` | Relaciona cada rol con los permisos que concede. |
| `usuario_rol_global` | `usuario_id`, `rol_id` | Asigna a una cuenta roles de administración de la plataforma. |
| `membresia` | `id`, `usuario_id`, `negocio_id`, `rol_id`, `activo` | Vincula una cuenta con un negocio y con un rol de ese mismo negocio. |

La combinación `(usuario_id, negocio_id)` es única en `membresia`. Una cuenta puede pertenecer a varios negocios y tiene un rol en cada uno. Los permisos que un administrador puede delegar se limitan a su ámbito.

Los siguientes incrementos incorporarán categorías, productos, existencias, movimientos de inventario, ventas y detalles de venta.

## Roles del equipo

| Integrante | Rol | Responsabilidad general |
|---|---|---|
| **Romel** | Jefe del proyecto y líder de backend | Coordina al equipo, planifica las fases y organiza los milestones e issues. Define la arquitectura del backend y revisa sus cambios. |
| **Diego** | Desarrollador backend y responsable de pruebas | Desarrolla funcionalidades en Django y coordina las pruebas de la API. Verifica los criterios de aceptación y registra en GitHub los errores reproducibles. |
| **Sebastián** | Desarrollador backend y encargado del seguimiento de backend | Desarrolla funcionalidades en Django y revisa el avance de los issues del equipo. Identifica tareas bloqueadas o pendientes de revisión y comunica su estado a Romel. |
| **Henry** | Líder de frontend | Define la estructura de React, coordina las convenciones del equipo de frontend y revisa los cambios de su área. |
| **Kelvin** | Desarrollador frontend y responsable de pruebas | Desarrolla pantallas y componentes en React y coordina las pruebas de la interfaz y su integración con la API. Verifica los criterios de aceptación y registra en GitHub los errores reproducibles. |
| **Diana** | Desarrolladora frontend y encargada del seguimiento de frontend | Desarrolla pantallas y componentes en React y revisa el avance de los issues del equipo. Identifica tareas bloqueadas o pendientes de revisión y comunica su estado a Henry. |

Romel y Henry coordinan el contrato de la API y las dependencias entre ambos equipos. Las tareas concretas se asignan mediante los issues de cada fase.

## Metodología de desarrollo

Seguimos un **desarrollo iterativo e incremental** con un **tablero Kanban en GitHub Projects**. Cada fase tiene un objetivo, un conjunto de tareas y criterios que permiten verificar el resultado antes de avanzar al siguiente incremento.

| Elemento | Uso |
|---|---|
| Milestone | Agrupa los issues de una fase y permite seguir su avance. |
| Issue | Describe una tarea, su responsable y sus criterios de aceptación. |
| Tablero Kanban | Muestra el estado de cada tarea mediante **Pendiente → Listo → En progreso → En revisión → Terminado**. |
| Pull request | Vincula los cambios con su issue y facilita la revisión antes de integrarlos en `main`. |

Usamos las etiquetas `backend`, `frontend`, `integración`, `documentación` y `bug` para identificar el tipo de trabajo.

### Flujo de trabajo

1. Se define el objetivo de la fase y se crea su milestone.
2. Se crean los issues, se asignan responsables y se agregan las tareas al tablero.
3. Cada integrante crea una rama para su issue a partir de `main` actualizada.
4. Cuando los cambios están listos, el integrante abre un pull request hacia `main` y lo vincula con el issue. Para cerrar el issue al integrar el PR, puede usar `Closes #N`, donde `N` es su número.
5. Después de la revisión y la integración, la tarea pasa a **Terminado**. Al cerrar la fase, el equipo verifica el flujo completo.

### Fases iniciales

- **Fase 0 · Preparación del proyecto.** Romel configura el repositorio, Django con PostgreSQL y React con TypeScript, y documenta cómo ejecutar el proyecto desde un clon limpio.
- **Fase 1 · Usuarios, negocios, roles y membresías.** Tres integrantes trabajan en backend y tres en frontend. El flujo se completa cuando el superadministrador crea un negocio y asigna a su administrador, y este crea un rol con permisos y lo asigna a un usuario mediante su membresía.

### Desarrollo en paralelo e integración

Antes de implementar cada flujo, backend y frontend acuerdan las rutas, los datos de entrada, la autenticación, los permisos, las respuestas y los errores. Los requisitos técnicos de Django y React, junto con el contrato de API, se consultan desde los issues de la Fase 1.

Frontend desarrolla las pantallas con **datos simulados** que respetan el contrato mientras backend implementa Django. Cuando un endpoint está disponible, se abre o se continúa el issue de integración de ese flujo. El equipo verifica la operación con React, Django y PostgreSQL.

## Instalación local en Windows

Usa una terminal **PowerShell** normal. Necesitas acceso al repositorio privado y una instalación local de PostgreSQL.

### 1. Verifica las herramientas

```powershell
git --version
py -3 --version
node --version
npm.cmd --version

$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
& $psql --version
```

Usa **Python 3.13 o 3.14**, **Node.js LTS** compatible con el Vite del proyecto y **PostgreSQL 18** como versión de referencia. Si ya tienes PostgreSQL 17, ajusta la ruta de `psql.exe` sustituyendo `18` por `17`. Django 5.2 admite Python 3.14 desde la versión 5.2.8. La instalación depende de las versiones registradas en `backend/requirements.txt`. [Compatibilidad de Django 5.2.8](https://docs.djangoproject.com/en/5.2/releases/5.2.8/) · [Requisitos de Vite](https://vite.dev/guide/)

Si te falta Git, Python o Node.js, ejecuta el comando correspondiente:

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.14 -e
winget install --id OpenJS.NodeJS.LTS -e
```

Para PostgreSQL, selecciona **PostgreSQL Server** y **Command Line Tools** en el instalador. Puedes instalar **pgAdmin 4** como interfaz gráfica. Define una contraseña para `postgres` y conserva el puerto `5432` si está disponible. Al terminar, vuelve a abrir PowerShell y comprueba las versiones. [Instalador de PostgreSQL para Windows](https://www.postgresql.org/download/windows/)

### 2. Acepta la invitación y clona el repositorio

1. Inicia sesión en GitHub con tu cuenta personal y comparte tu nombre de usuario con Romel para que pueda invitarte.
2. Abre la invitación y selecciona **Accept invitation**. Comprueba que esa cuenta pueda ver el código al abrir el repositorio en el navegador.
3. Abre PowerShell en la carpeta donde guardas tus proyectos y ejecuta estos comandos. [Repositorio `gestion-negocios`](https://github.com/romcode15/gestion-negocios)

```powershell
git clone https://github.com/romcode15/gestion-negocios.git
cd gestion-negocios
git status
```

#### Opción recomendada · Iniciar sesión en el navegador

Git para Windows incluye **Git Credential Manager**. Si aparece la ventana de autenticación al clonar, selecciona **Sign in with your browser**. Entra con la cuenta que aceptó la invitación, completa la verificación en dos pasos si se solicita y autoriza el acceso. Regresa a PowerShell para comprobar que finalizó el clon. Si ya tienes una sesión válida guardada, Git puede clonar directamente. [Git Credential Manager en Windows](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git?platform=windows)

#### Alternativa · Crear y usar un token personal

Si Git te pide `Username` y `Password` en la terminal, usa tu nombre de usuario de GitHub y un **token personal de acceso (PAT)** en `Password`. La contraseña de la cuenta se utiliza en el inicio de sesión web.

1. En GitHub, entra a **Foto de perfil → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Selecciona **Generate new token → Generate new token (classic)**.
3. Escribe un nombre identificable, por ejemplo, `Git Windows - gestion-negocios`.
4. Selecciona una fecha de expiración corta y marca el alcance **`repo`** para acceder al repositorio privado.
5. Pulsa **Generate token** y copia el valor que aparece. Guárdalo de forma segura y mantenlo fuera de la URL del repositorio, los archivos del proyecto, los chats y las capturas.
6. Ejecuta `git clone` de nuevo. En `Username`, escribe tu nombre de usuario de GitHub. En `Password`, pega el token. La terminal puede ocultar lo que pegas.

El token clásico puede abarcar otros repositorios a los que tenga acceso tu cuenta. Revócalo desde **Tokens (classic)** si se expone. [Guía de tokens de GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

Si ves **Repository not found**, revisa la URL y confirma que aceptaste la invitación con la cuenta correcta. Si el navegador tiene acceso pero Git usa otra cuenta, revisa las entradas de GitHub en **Administrador de credenciales → Credenciales de Windows** y ajusta la credencial guardada. Si aparece **Authentication failed** al usar un token, comprueba que siga vigente y tenga el alcance requerido. [Credenciales de GitHub en Windows](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git?platform=windows)

### 3. Crea la base de datos local

Desde PowerShell, abre `psql`. Cuando te pida la contraseña, usa la del usuario `postgres`. Ajusta la ruta y el puerto a tu instalación si son diferentes.

```powershell
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
& $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres
```

Dentro de `psql`, ejecuta estos comandos uno por uno. `\password gestion_app` te pedirá escribir y confirmar la contraseña que Django usará para conectarse a PostgreSQL.

```sql
CREATE ROLE gestion_app LOGIN;
\password gestion_app
CREATE DATABASE gestion_negocios OWNER gestion_app;
\q
```

Este paso se realiza una vez por entorno local. Si la base y el rol ya existen, comprueba que `gestion_app` sea propietario de `gestion_negocios`.

### 4. Configura y ejecuta el backend

Desde la raíz de `gestion-negocios`:

```powershell
cd backend
py -3 --version
py -3 -m venv .venv
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

Si `py -3` selecciona otra versión, usa `py -3.13 -m venv .venv` o `py -3.14 -m venv .venv`, según la versión instalada que elijas.

Abre `backend/.env` y completa estos valores:

| Variable | Valor local |
|---|---|
| `DJANGO_SECRET_KEY` | Clave generada por el último comando. |
| `DB_NAME` | `gestion_negocios` |
| `DB_USER` | `gestion_app` |
| `DB_PASSWORD` | Contraseña definida con `\password gestion_app`. |
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5432` o el puerto de tu instalación. |

Mantén `backend/.env` en tu equipo. El archivo que se comparte en GitHub es `backend/.env.example`.

En la misma terminal, aplica las migraciones incluidas en el repositorio y ejecuta Django:

```powershell
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py runserver
```

Abre [http://127.0.0.1:8000/admin/](http://127.0.0.1:8000/admin/). Si aparece la pantalla de inicio de sesión de Django, el servidor responde. Si falla la conexión, comprueba que PostgreSQL esté en ejecución y que los valores de `backend/.env` coincidan con tu configuración local.

### 5. Configura y ejecuta el frontend

Deja Django abierto. Abre una **segunda terminal** en la raíz de `gestion-negocios` y ejecuta:

```powershell
cd frontend
npm.cmd ci
npm.cmd run build
npm.cmd run dev
```

Abre [http://localhost:5173/](http://localhost:5173/) o la URL que indique Vite. La instalación local queda verificada cuando las migraciones se aplican en PostgreSQL, Django responde y React compila y abre en el navegador. [Documentación de npm ci](https://docs.npmjs.com/cli/commands/npm-ci/)

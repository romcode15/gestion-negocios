# Frontend · Gestión de Negocios

Aplicación de fase 1 con React, TypeScript y Vite: inicio y cierre de sesión, selección de negocio, usuarios y negocios de plataforma, roles, permisos y membresías.

## Preparar el entorno

Desde la raíz del repositorio, guardar los cambios de otra tarea en su rama antes de actualizar:

```powershell
git switch dev
git pull --ff-only origin dev
cd frontend
npm.cmd ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm.cmd run dev
```

Abrir la URL que indique Vite, normalmente `http://localhost:5173`. Reiniciar Vite después de cambiar `.env.local`. Este archivo es local y no se sube al repositorio.

## Modo simulado

Configurar en `.env.local`:

```dotenv
VITE_API_MODE=mock
```

Es el modo predeterminado; no requiere Django. Usar `plataforma`, `admin_tienda`, `admin_ferreteria`, `compartido` o `existente`, con contraseña ficticia `Demo-12345!`. Estas cuentas solo pertenecen al simulador.

Las altas y cambios se mantienen en memoria hasta recargar. Solo se conserva la identidad ficticia de una cuenta inicial en sessionStorage, sin contraseñas ni tokens. Para reiniciar datos, recargar o llamar `reiniciarMocks()`. Escenarios de errores y limitaciones: [API.md](API.md).

## Conectar con Django

1. Preparar PostgreSQL, el backend y la cuenta inicial según el [README principal](../README.md) y el [README backend](../backend/README.md). Ejecutar `preparar_accesos` para asignar el rol de plataforma.
2. Dejar Django funcionando en `http://127.0.0.1:8000`.
3. Cambiar `.env.local` a `VITE_API_MODE=http` y reiniciar Vite.
4. Abrir React e iniciar sesión con la cuenta real creada en Django.

El proxy de Vite reenvía `/api` a Django. Mantener el mismo hostname en React durante la sesión; las llamadas usan rutas relativas y cookies. El cliente obtiene CSRF antes del login y lee el token actual en cada escritura. Ante un error CSRF, permite repetir el envío manualmente.

En este modo las operaciones guardan datos reales en la base configurada en backend. Las credenciales y altas del simulador no se trasladan a PostgreSQL.

## Permisos de las pantallas

| Acción | Permiso |
|---|---|
| Listar negocios o usuarios | `listar_negocios` o `listar_usuarios`, respectivamente |
| Crear negocio o usuario | `crear_negocio` o `crear_usuario`, respectivamente |
| Listar roles | `listar_roles` |
| Crear rol y consultar permisos delegables | `crear_rol`, sin exigir `listar_roles` |
| Listar miembros | `listar_membresias` |
| Incorporar miembro | `crear_membresia` |
| Cambiar el rol de un miembro | `asignar_rol`; la tabla que permite elegir al miembro requiere `listar_membresias` |
| Consultar opciones de rol para membresías | `crear_membresia` o `asignar_rol`, sin exigir `listar_roles` |

El selector de membresías consulta `roles/asignables/`: solo ofrece roles del negocio con permisos incluidos en los del actor. Django vuelve a validar cada escritura y protege al último Administrador de negocio activo. Para probar una degradación propia permitida, debe existir otro administrador activo.

## Verificar los cambios

Desde frontend:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

Las pruebas incluyen funciones de API, sesión, rutas, formularios, paginación, cancelación, errores y restricciones del simulador. Las pruebas HTTP de esta suite sustituyen fetch y no reemplazan la integración con Django.

`npm.cmd run test:filtros-catalogo` comprueba que crear/editar categorías y
productos conserva filtros y página válida, recupera páginas que quedan fuera
de rango y limpia el estado al cambiar de negocio. También forma parte de la
suite completa. El cierre visual confirmado por Romel se registra en
[COMPONENTES.md](COMPONENTES.md#verificación-de-integración-f3-57).

Para ejecutar las pantallas de React mediante DOM con HTTP real y PostgreSQL temporal, desde backend:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py --integracion-frontend
```

Se necesitan las dependencias de ambos proyectos y PostgreSQL disponible. El comando aplica migraciones, ejecuta las pruebas del backend y el flujo de frontend contra un servidor Django y una base temporales; no usa la base de `.env`. Usa un DOM automatizado, sin abrir un navegador.

Para una revisión visual manual, usar modo HTTP: crear una cuenta administradora y dos negocios desde plataforma; iniciar sesión como administrador; crear un rol, incorporar una cuenta existente y otra nueva; comprobar errores de permisos, último administrador, recarga, cambio de negocio y cierre de sesión.

### Integración de fase 2 (#57)

El mismo comando también ejecuta los modales de categorías/productos y el flujo
saldo cero → entrada → salida → ajuste → historial, con datos persistidos.
Comprueba permisos mínimos, CSRF real, conflicto de versión, respuesta perdida
con reintento sin duplicado, inactivos, recarga y cambio de negocio/sesión con
consultas pendientes. Otra conexión consulta PostgreSQL para conciliar saldos,
versiones e historial. No usa la base de `.env` ni convierte los datos demo en
cuentas reales. Preparación, casos y resultados: [API.md](API.md#f3--integración-http-real-57).

Para revisar en navegador los mismos datos temporales, definir en la terminal
`INTEGRACION_PASSWORD` con un valor privado exclusivo de prueba y añadir
`--revision-visual` al comando. Se muestran URL y cuenta temporal; no se imprime
la contraseña. Pulsar Enter al terminar detiene los servidores y elimina la base.
La revisión visual es independiente de las pruebas DOM; su registro está en
[COMPONENTES.md](COMPONENTES.md).

En modo HTTP las pantallas de fase 2 usan las mismas funciones tipadas del mock.
Aplicar todas las migraciones para disponer de los once permisos nuevos en los
administradores predefinidos; los roles personalizados conservan sus permisos.
Las opciones de categorías requieren crear/editar producto y las de productos
algún permiso de escritura de inventario, sin exigir los listados generales.

## Documentación y trabajo en equipo

- [Fase 1](fase1.md): contrato y criterios.
- [Fase 2](fase2.md): módulos, componentes y modales; leer también el [contrato común](../fase2.md).
- [Fase 3](fase3.md): trabajo pendiente de ventas, carrito, anulación y cierre HTTP; [contrato común](../fase3.md).
- [Estructura](ESTRUCTURA.md): módulos y responsabilidades.
- [API](API.md): firmas, simulación y transporte HTTP.
- [Componentes](COMPONENTES.md): interfaces compartidas.
- [Guía de GitHub](../guiagithub.md): una rama por issue desde `dev`, PR hacia `dev` y revisión del equipo.

# Backend · Gestión de Negocios

API con Django REST Framework, PostgreSQL y sesiones de Django. Para instalar Python, preparar PostgreSQL y configurar .env, seguir el [README principal](../README.md).

## Actualizar el entorno

Swagger está configurado y versionado dentro del proyecto. No se instala globalmente en Windows. Cada integrante necesita instalar las dependencias en su propio entorno virtual, como el resto de Django; no debe repetir la configuración de Swagger.

Desde la raíz del repositorio, con tus cambios guardados en su rama:

```powershell
git switch dev
git pull --ff-only origin dev
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py check
```

Si todavía no existe .venv o .env, prepararlos primero según el README principal. Nunca sobrescribir un .env existente con valores de otro integrante.

## Preparar la cuenta inicial

```powershell
.\.venv\Scripts\python.exe manage.py createsuperuser
.\.venv\Scripts\python.exe manage.py preparar_accesos --username tu_usuario
```

Introducir las credenciales de forma interactiva. Sustituir tu_usuario por el username creado. Si la cuenta activa ya existe, ejecutar solo preparar_accesos; tener is_superuser de Django no sustituye la asignación de rol global. Detalles en [MODELOS.md](MODELOS.md).

## Abrir Swagger UI

Desde backend:

```powershell
.\.venv\Scripts\python.exe manage.py runserver
```

- [Swagger UI](http://127.0.0.1:8000/api/docs/): explorar campos, respuestas y probar endpoints.
- [Esquema OpenAPI en JSON](http://127.0.0.1:8000/api/schema/?format=json): contrato generado a partir de las vistas y serializers.

Usar siempre el mismo hostname durante la sesión. Los recursos de Swagger se sirven desde el paquete sidecar instalado, sin depender de un CDN. La documentación está habilitada cuando DEBUG=True y responde 404 cuando DEBUG=False.

### Probar el backend desde Swagger

Expandir un endpoint, pulsar **Try it out**, completar el cuerpo si corresponde y pulsar **Execute**.

1. Ejecutar GET /api/v1/auth/csrf/. Debe devolver 204 sin cuerpo y preparar la cookie CSRF. Abrir Swagger ya prepara esa cookie, pero este endpoint permite obtenerla de nuevo.
2. Ejecutar POST /api/v1/auth/login/ con username y password de tu cuenta local. Debe devolver 200 con Sesion. No usar las cuentas de demostración de frontend: pertenecen únicamente a la simulación.
3. Ejecutar GET /api/v1/auth/me/ para comprobar la sesión y permisos actuales.
4. Probar GET/POST de usuarios y negocios según los permisos de la cuenta. Para crear un negocio, usar el ID de una cuenta activa existente como administrador_id.
5. Iniciar sesión como administrador de negocio para probar roles y membresías. `roles/asignables/` devuelve solo los roles delegables y requiere `crear_membresia` o `asignar_rol`. El listado general de roles requiere `listar_roles`; crear roles requiere únicamente `crear_rol`.
6. Al incorporar miembros, enviar `password` solo para una cuenta nueva. La respuesta 201 es una `Membresia`, con usuario anidado. Probar un rol ajeno, un rol superior a los permisos del actor y la degradación del último administrador: deben rechazarse sin guardar cambios.
7. Ejecutar POST /api/v1/auth/logout/. Debe devolver 204. La siguiente consulta auth/me debe devolver 403 not_authenticated.

No necesitas pegar cookies en **Authorize**: la sesión se obtiene mediante login. El navegador conserva la cookie de sesión y Swagger lee la cookie CSRF actual antes de cada escritura, incluso después de la rotación del login. No se utiliza JWT ni se desactiva CSRF.

Las operaciones de Swagger son reales: crean o modifican datos en la base configurada en tu .env. Utilizar cuentas y negocios de desarrollo. Para comprobar rollback y concurrencia, utilizar la suite automatizada aislada.

### Interpretar errores

| Resultado | Qué revisar |
|---|---|
| 400 validation_error | Campos indicados en errors. |
| 400 invalid_credentials | Username y contraseña de tu cuenta Django local. |
| 403 not_authenticated | Iniciar sesión. |
| 403 permission_denied | Rol global o membresía y permiso de esa operación. |
| 403 csrf_failed | Ejecutar csrf y volver a enviar manualmente. Mantener el mismo hostname. |
| 404 not_found | ID/página/ruta dentro del contexto autorizado. |

No confundir un 204 correcto con un error por no mostrar JSON. Si se recibe 201, el alta se guardó. Si falla la carga de Swagger después de actualizar el código, revisar que se ejecutó pip install -r requirements.txt y reiniciar Django.

## Incorporar nuevos endpoints

No volver a instalar ni configurar Swagger para cada issue. Definir vistas, serializers y URLs del módulo indicado; el generador los incorpora. Cuando la inferencia no describa exactamente el contrato, usar extend_schema o extend_schema_view como en auth y plataforma:

- Resumen, grupo y permiso necesario en la descripción.
- Tipos de solicitud y respuesta separados cuando sean distintos.
- Respuestas paginadas, errores y estados HTTP reales. Un 204 se documenta sin contenido.
- Reutilizar ErrorSerializer de api/common/schema.py para errores comunes.
- No documentar endpoints ficticios antes de implementarlos ni cambiar permisos para que una prueba funcione.

Verificar antes del PR:

```powershell
.\.venv\Scripts\python.exe manage.py spectacular --validate --fail-on-warn
```

Probar además desde Swagger un caso permitido, otro sin permiso y, para módulos de negocio, un caso con datos ajenos. Registrar los pasos y resultados en el PR, sin credenciales. Swagger complementa las pruebas automatizadas; no las sustituye.

## Documentación y pruebas

La API de existencias de fase 2 ya está disponible: lista con `consultar_existencias` y detalle por `producto_id` con ese permiso o `ajustar_inventario`. Los resúmenes permiten consultar saldo y mínimo sin permisos de catálogo. Ver [API y seguridad](API.md) y el [contrato común](../fase2.md).

- [Fase 1](Fase1.md): contrato y criterios de cierre.
- [Fase 2](fase2.md): guía de catálogo/inventario y reparto de backend; leer también el [contrato común](../fase2.md).
- [Estructura](ESTRUCTURA.md): carpetas y responsabilidades.
- [Modelos](MODELOS.md): integridad y preparación inicial.
- [API y seguridad](API.md): sesiones, permisos, transacciones e imports compartidos.
- [Guía GitHub](../guiagithub.md): ramas, commits y revisión.

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py
node tools/verificar_swagger.mjs
```

El primer comando verifica migraciones y toda la suite en PostgreSQL temporal aislado. El segundo, opcional y con Node.js, comprueba el interceptor JavaScript de Swagger y la lectura del token rotado; no exige instalar paquetes npm ni abre un navegador.

Para ejecutar también los formularios React con HTTP real, instalar primero las dependencias de frontend (`npm.cmd ci`) y ejecutar desde backend:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py --integracion-frontend
```

La opción ejecuta las pruebas del backend y luego levanta Django y Vite en puertos temporales. Verifica los formularios con DOM automatizado contra PostgreSQL: cuentas, dos negocios, roles, altas de membresía, cambio de rol, último administrador, aislamiento, recarga y cierre de sesión. Usa cuentas y contraseña temporales; no modifica la base del `.env` ni abre un navegador. La revisión visual manual se realiza desde React en modo HTTP según el [README frontend](../frontend/README.md).

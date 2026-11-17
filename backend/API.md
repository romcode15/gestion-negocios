# Base de API y seguridad · Issue #5

La base de #5 habilita autenticación y componentes comunes; #6 incorpora los endpoints de plataforma descritos al final. Roles y membresías se implementarán en #7 a #10; sus archivos urls.py ya están incluidos, con listas de rutas vacías.

## Autenticación

Todas las rutas comienzan con `/api/v1` y terminan en `/`. Las respuestas son JSON, salvo los éxitos 204, que tienen cuerpo vacío. No se utiliza JWT ni autenticación Basic.

| Método y ruta | Entrada | Resultado |
|---|---|---|
| GET /auth/csrf/ | Sin cuerpo; pública | 204 y cookie csrftoken. |
| POST /auth/login/ | username, password; CSRF obligatorio | 200 con Sesion y sesión de Django. |
| GET /auth/me/ | Cookie de sesión | 200 con Sesion actualizada. |
| POST /auth/logout/ | Cookie de sesión y CSRF | 204; invalida la sesión. |

Sesion contiene exclusivamente usuario `{ id, username, is_active }`, permisos_globales como códigos y negocios `{ id, nombre, rol_id, permisos }`. Solo incluye negocios activos y membresías activas. Los permisos se consultan de nuevo en cada solicitud, no se copian permanentemente dentro de la sesión. Contraseñas, hashes, flags administrativos de Django y cookies no forman parte del cuerpo de respuesta.

Para el cliente:

1. Obtener `/auth/csrf/` y leer csrftoken de las cookies.
2. Enviar login con JSON y X-CSRFToken. Incluir las cookies en las solicitudes.
3. Leer nuevamente csrftoken después del login: Django rota el token. No reutilizar el anterior para logout o escrituras.
4. Recuperar la sesión mediante `/auth/me/` al cargar la aplicación.
5. Ante csrf_failed, obtener el token y permitir repetir el envío manualmente; no repetir automáticamente una mutación.

El login comprueba CSRF incluso sin sesión mediante csrf_protect. El resto de las escrituras autenticadas reutiliza AutenticacionSesion, que ejecuta la comprobación de Django con un error estable. Las respuestas de autenticación incluyen Cache-Control para impedir almacenar la sesión en cachés.

### Desarrollo con Vite

Usar el proxy `/api` que ya configura frontend/vite.config.ts, conservando el host de origen (`changeOrigin: false`). Abrir React siempre con el mismo hostname, por ejemplo localhost, y llamar la API por rutas relativas. No alternar localhost y 127.0.0.1 para manejar las cookies.

Cuando Origin y el host reenviado coinciden, no se necesita una excepción CSRF para Vite. No desactivar CSRF ni añadir orígenes arbitrarios para resolver fallos. El despliegue requiere su propia configuración de hosts, HTTPS y cookies; esta entrega no cambia esos ajustes.

## Errores

Formato común: `{ code, detail, errors }`. errors es un objeto con listas de mensajes por campo, o `{}` para errores generales.

| HTTP | Código | Tratamiento |
|---|---|---|
| 400 | validation_error | Revisar campos; JSON inválido también devuelve este código. |
| 400 | invalid_credentials | Mensaje único para usuario inexistente, contraseña incorrecta o cuenta inactiva. |
| 403 | not_authenticated | Falta una sesión válida; volver al login. |
| 403 | permission_denied | Falta permiso o acceso al contexto del negocio. |
| 403 | csrf_failed | Obtener token y permitir reenvío manual. |
| 404 | not_found | Recurso ausente dentro del contexto autorizado, página o URL API inexistentes. |

Otros errores estándar de DRF, como method_not_allowed (405) o unsupported_media_type (415), también conservan el mismo envoltorio. Django ValidationError y DRF ValidationError se normalizan; errores anidados usan rutas de campo con puntos. Las excepciones inesperadas siguen siendo errores internos y no se disfrazan como validaciones.

Imports: `api.common.errors.manejar_excepcion`, `api.common.exceptions.CsrfFailed` y `InvalidCredentials`. Los fallos CSRF del middleware y de DRF tienen el mismo código; los errores de administración Django conservan su comportamiento fuera de `/api/v1/`.

## Permisos y contexto de negocio

Por defecto las vistas DRF requieren una cuenta activa y sesión. Solo csrf/login declaran AllowAny explícitamente.

Para endpoints de plataforma:

```python
from api.common.permissions import TienePermisoGlobal

# Dentro de una vista genérica:
permission_classes = [TienePermisoGlobal]
permisos_por_metodo = {"GET": "listar_negocios", "POST": "crear_negocio"}
```

Para endpoints de negocio:

```python
from api.common.permissions import TienePermisoNegocio

# Dentro de una vista genérica cuya URL recibe negocio_id:
permission_classes = [TienePermisoNegocio]
permisos_por_metodo = {"GET": "listar_roles", "POST": "crear_rol"}
```

Una vista con una sola regla puede declarar permiso_requerido en vez del mapa. No omitir la regla para un método implementado; eso es un error de configuración. HEAD aplica el permiso de GET; OPTIONS parte del permiso de lectura o del primer método implementado y DRF filtra las acciones disponibles.

TienePermisoNegocio establece `self.contexto_negocio`, con negocio, membresia del actor y permisos. Comprueba usuario activo, negocio activo, membresía activa, rol perteneciente a ese negocio y permiso solicitado. No concede acceso por is_superuser ni por un rol global de plataforma.

Los listados deben filtrar su queryset por `self.contexto_negocio.negocio.pk`. En escrituras, asignar el negocio desde ese contexto, no desde un campo del cuerpo. Para detalles:

```python
from api.common.access import obtener_recurso_negocio

# Devuelve 404 si el ID no pertenece al negocio ya autorizado.
registro = obtener_recurso_negocio(contexto, MiModelo.objects.all(), pk=identificador)
```

El helper sirve para modelos con FK negocio, como Rol o Membresia. Nunca consultar primero el ID global y comprobar el tenant después. Un negocio inexistente, ajeno o inactivo responde 403 sin revelar su existencia; un recurso inexistente o ajeno dentro de un contexto autorizado responde 404.

Imports de consulta: `resolver_contexto_negocio(usuario, negocio_id, permiso=None)` y `permisos_globales(usuario)`. UsuarioSerializer en api/common/serializers.py es la representación reutilizable de la cuenta; no duplica ni modifica el modelo Usuario.

## Reglas de delegación y asignación

Reglas confirmadas por Romel para esta fase:

1. Solo se pueden delegar permisos de ámbito negocio que el actor posee en ese contexto.
2. Solo se pueden asignar roles del mismo negocio cuyos permisos estén incluidos en los del actor. Aplica tanto a nuevas membresías como a cambios de rol.
3. No se puede quitar el rol al último Administrador de negocio activo. Cuenta como administrador una membresía activa de una cuenta activa con el rol predefinido Administrador de negocio.

Para #7 y #8:

```python
from api.common.access import permisos_delegables, validar_permisos_delegables

queryset = permisos_delegables(contexto)  # La ruta requiere crear_rol.
ids = validar_permisos_delegables(contexto, permiso_ids)
```

El validador admite una lista vacía y rechaza IDs inexistentes, repetidos, globales o no delegables. El serializer debe validar primero que se recibe una lista de IDs numéricos.

Para el alta de membresías en #9, después de resolver y validar rol_id:

```python
from api.common.access import validar_asignacion_rol

validar_asignacion_rol(contexto, rol)
```

La ruta de alta exige crear_membresia; crear una cuenta dentro de ese flujo no exige crear_usuario de plataforma. Esta validación no sustituye el permiso de la operación ni guarda registros.

Para el cambio de rol de #10:

```python
from django.db import transaction
from api.common.role_policy import validar_cambio_rol

with transaction.atomic():
    actual = validar_cambio_rol(contexto, membresia, nuevo_rol)
    actual.rol = nuevo_rol
    actual.save(update_fields=["rol"])
```

El helper exige una transacción externa, bloquea la fila Negocio hasta el commit, consulta de nuevo la membresía y permisos actuales del actor con asignar_rol, comprueba el rol destino y protege al último administrador. Devuelve la membresía actualizada desde la base, sin guardar el nuevo rol.

**El guardado debe permanecer dentro de la misma transacción y usar la membresía devuelta.** Dos cambios concurrentes de este negocio se serializan; no pueden degradar simultáneamente a los dos últimos administradores. Todos los futuros servicios de cambio de rol deben utilizar este helper, no duplicar una comprobación de conteo sin bloqueo.

El alcance es cambio de rol; la fase no agrega operaciones de desactivación, borrado o edición de permisos de roles. Esas futuras operaciones deberán preservar también las invariantes que les correspondan.

## Paginación

PaginacionPagina en api/common/pagination.py se configura por defecto para vistas genéricas de listado: tamaño fijo **2**, orden ascendente por id, parámetro page y respuesta count/next/previous/results. Coincide con el tamaño de la simulación actual. Una página inexistente devuelve 404 not_found. Los enlaces reales son HTTP; el cliente puede seguir usando el parámetro page de sus funciones tipadas.

## Rutas y pruebas

config/urls.py incluye api/urls.py bajo api/v1/. Cada equipo modifica solo su urls.py interno. La base incluye roles y membresias bajo el mismo prefijo de negocio sin que una lista vacía impida resolver las rutas del otro módulo.

Las rutas de tests/support/api_urls.py existen solo mediante override_settings durante pruebas. No están expuestas en la aplicación.

Pruebas nuevas: api/auth/tests/test_session.py y api/common/test_security.py. Reutilizan las fábricas de #4 y tests/support/api.py, sin llamar endpoints de #6 a #10. La comprobación de concurrencia usa conexiones independientes y PostgreSQL real.

Desde backend:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py
```

El script aplica las migraciones desde cero, verifica check y ausencia de migraciones pendientes y ejecuta toda la suite, sin modificar la base habitual. La prueba del proxy comprueba cookies, host y Origin en el cliente HTTP de Django; la integración visual desde React se validará en su entrega de integración.

## API de plataforma · Issue #6

| Método y ruta bajo /api/v1 | Permiso global | Entrada | Respuesta |
|---|---|---|---|
| GET /plataforma/usuarios/ | listar_usuarios | page opcional | 200, Pagina de Usuario. |
| POST /plataforma/usuarios/ | crear_usuario | username, password | 201, Usuario. |
| GET /plataforma/negocios/ | listar_negocios | page opcional | 200, Pagina de Negocio. |
| POST /plataforma/negocios/ | crear_negocio | nombre, tipo, administrador_id | 201, Negocio. |

Usuario contiene id, username e is_active. Negocio contiene id, nombre, tipo y activo. Las listas mantienen el orden por id y páginas de dos registros. Los listados de plataforma incluyen registros activos e inactivos; la selección de administrador debe usar únicamente cuentas activas.

Las vistas ListCreateAPIView reutilizan TienePermisoGlobal y la base de sesiones/CSRF. El permiso de alta no requiere el de listado ni viceversa. El administrador de un negocio no obtiene por ello acceso a plataforma. Las rutas no incluyen detalle, edición ni eliminación.

### Creación de cuentas

El serializer declara username y password como entrada; password es write_only. La respuesta reutiliza UsuarioSerializer y nunca contiene contraseña ni hash.

El servicio crear_usuario valida los campos del modelo y normaliza username con Django. Aplica validate_password usando la cuenta candidata para comprobar también similitud con username, y guarda mediante create_user. No concede is_staff/is_superuser ni asignaciones globales o membresías.

Los errores se devuelven por username o password con validation_error. La restricción única resuelve también altas concurrentes: el error de duplicado se consulta después de salir del savepoint. Un IntegrityError inesperado no se convierte silenciosamente en un duplicado.

### Alta de negocio

Ejemplo de cuerpo (sustituir el ID por una cuenta activa existente):

```json
{ "nombre": "Tienda Central", "tipo": "tienda", "administrador_id": 12 }
```

nombre y tipo son textos requeridos, con máximos de 150 y 100 caracteres. administrador_id es numérico y debe identificar una cuenta activa existente. El alta no crea una cuenta ni cambia sus credenciales.

El serializer valida los campos. El servicio crear_negocio vuelve a comprobar y bloquea la cuenta administradora dentro de transaction.atomic(), y guarda:

1. El nuevo Negocio activo.
2. Su rol predefinido Administrador de negocio y los cinco permisos de negocio, mediante preparar_administrador_negocio de #4.
3. La Membresia activa entre esa cuenta, ese negocio y ese rol.

Si falla cualquiera de estos pasos, se revierte la operación completa, incluidas las asociaciones y los permisos de catálogo creados dentro de ella. El administrador inicial no recibe permisos de plataforma. La siguiente consulta auth/me refleja su membresía y permisos sin copiar datos obsoletos a la sesión.

Las entradas de alta solo controlan sus campos declarados: no pueden configurar IDs, flags administrativos, el estado inicial ni roles arbitrarios mediante campos adicionales.

### Archivos e imports para el equipo

- api/plataforma/views.py: UsuariosView y NegociosView.
- api/plataforma/serializers.py: entradas de creación y representación NegocioSerializer; UsuarioSerializer procede de api/common/.
- api/plataforma/services.py: crear_usuario(username, password) y crear_negocio(nombre, tipo, administrador_id). Los servicios son internos: las vistas comprueban los permisos antes de llamarlos.
- api/plataforma/urls.py: únicamente usuarios/ y negocios/. No se modifica la composición raíz ni las URLs de los compañeros.

Para probar manualmente el flujo: preparar catálogo y cuenta de plataforma según MODELOS.md, obtener CSRF, iniciar sesión, crear o elegir una cuenta activa, crear una tienda y una ferretería con esa cuenta como administrador, y consultar sus listados. Después iniciar otra sesión con las credenciales del administrador y comprobar sus dos negocios y permisos en auth/me. Cambiar de cuenta requiere volver a leer el token rotado tras cada login.

Para pruebas automatizadas independientes, Sebastián y Diego usan crear_contexto_negocio o crear_dos_negocios de tests/support/factories.py. Esas fábricas preparan modelos directamente en la base de pruebas y no dependen de estos endpoints ni de los de otro compañero.

La suite en api/plataforma/tests/test_platform.py verifica creación, lectura paginada, permisos independientes, validación de campos, CSRF, ausencia de hashes, inicialización de dos negocios, revalidación del administrador y rollback. Comprueba además un duplicado concurrente con conexiones reales separadas. La integración visual de estas operaciones desde React sigue correspondiendo a su entrega de integración.

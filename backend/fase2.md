# Fase 2 · Backend — Catálogo e inventario

Guía de desarrollo para Django/DRF y PostgreSQL. Antes de implementar, leer el [contrato común](../fase2.md), [API y seguridad existentes](API.md), [estructura de fase 1](ESTRUCTURA.md) y el issue asignado. El contrato común es la fuente de campos, tipos, rutas, permisos, filtros y estados HTTP; no duplicarlo con variantes.

## 1. Resultado esperado

Mantener la sesión y el aislamiento de fase 1 y añadir categorías, productos, existencias y movimientos por negocio. Todos los cambios de saldo pasan por un único servicio transaccional. Los endpoints, Swagger y simulación deben describir el mismo comportamiento.

No implementar ventas ni nuevas cuentas/autenticación. No modificar el rol de plataforma para darle acceso implícito al inventario. No crear un CRUD genérico que permita editar saldos o movimientos históricos.

## 2. Estructura y propiedad de archivos

Estas rutas son la **estructura por crear en B1**; después cada persona mantiene sus archivos. No crear archivos Python vacíos innecesarios. Los paquetes que se importen sí necesitan `__init__.py`.

```text
backend/
├── catalogo/                         # App de modelos: Categoria, Producto; Romel
│   ├── models.py
│   ├── migrations/
│   └── tests/
├── inventario/                       # App de modelos: Existencia, MovimientoInventario; Romel
│   ├── models.py
│   ├── migrations/
│   └── tests/
├── accesos/
│   ├── catalogo.py                   # Ampliar catálogo de permisos; Romel
│   └── migrations/                   # Nueva migración para permisos/admins existentes; Romel
├── api/
│   ├── catalogo/
│   │   ├── urls.py                   # Composición preparada en B1
│   │   ├── categorias/               # Sebastián: views, serializers, selectors, urls, tests
│   │   └── productos/                # Sebastián: incluye creación atómica y opciones
│   └── inventario/
│       ├── urls.py                   # Composición preparada en B1
│       ├── services.py               # Servicio común de movimientos; Romel
│       ├── exceptions.py             # ConflictoInventario, 409; Romel
│       ├── stock/                    # Consultas de existencias; Sebastián
│       └── movimientos/              # Entradas, salidas, ajustes e historial; Diego
└── tests/
    ├── support/fase2.py              # Fábricas y datos compartidos; Romel
    └── integration/                  # Flujo completo y concurrencia; Romel
```

Los modelos pertenecen a `catalogo`/`inventario`; `api/` continúa siendo capa HTTP. Registrar únicamente las apps de dominio en settings. No mover Usuario, Negocio ni modelos de acceso ya existentes.

B1 monta `api.catalogo.urls` y `api.inventario.urls` bajo el prefijo existente `negocios/<int:negocio_id>/`, y deja importables las composiciones por submódulo con `urlpatterns = []`. Después Sebastián y Diego completan sus `urls.py`, sin volver a editar la composición raíz. Rutas estáticas `opciones/` y detalles con `<int:...>`; no usar capturas genéricas que absorban otros módulos.

## 3. Distribución y dependencias

| Issue | Responsable | Alcance | Espera |
|---|---|---|---|
| [B1 · #40](https://github.com/romcode15/gestion-negocios/issues/40) | Romel (`romcode15`) | Modelos, restricciones, migraciones, permisos, rutas base y fábricas | Fase 1 en dev |
| [B2 · #41](https://github.com/romcode15/gestion-negocios/issues/41) | Romel (`romcode15`) | Servicio común, bloqueo, versión, idempotencia y errores 409 | B1 |
| [B3 · #48](https://github.com/romcode15/gestion-negocios/issues/48) | Romel (`romcode15`) | Integración, concurrencia, Swagger y documentación final | B2, B6, B9 |
| [B4 · #42](https://github.com/romcode15/gestion-negocios/issues/42) | Sebastián (`Sebastian25L`) | Categorías: consulta, alta, edición y opciones | B1 |
| [B5 · #43](https://github.com/romcode15/gestion-negocios/issues/43) | Sebastián (`Sebastian25L`) | Productos: consulta, alta atómica, edición y opciones | B4 |
| [B6 · #44](https://github.com/romcode15/gestion-negocios/issues/44) | Sebastián (`Sebastian25L`) | Existencias: lista, detalle, búsqueda y filtros | B5 |
| [B7 · #45](https://github.com/romcode15/gestion-negocios/issues/45) | Diego (`DiArman2`) | Entradas y salidas delegadas al servicio B2 | B2 |
| [B8 · #46](https://github.com/romcode15/gestion-negocios/issues/46) | Diego (`DiArman2`) | Ajustes delegados al mismo servicio | B7 |
| [B9 · #47](https://github.com/romcode15/gestion-negocios/issues/47) | Diego (`DiArman2`) | Historial de movimientos y filtros | B8 |

Tras la base compartida, Sebastián y Diego avanzan por sus propias cadenas. Sus pruebas usan las fábricas B1: no dependen de hacer POST al módulo del otro. B3 comprueba la integración real entre módulos.

## 4. Base común: decisiones que B1 debe entregar

- Nuevos modelos con validación de relaciones del mismo negocio y protección de datos históricos. Restricciones de unicidad para categoría/nombre, SKU normalizado, existencia por producto y clave de operación por negocio.
- Restricciones de saldo no negativo, versión no negativa, tipos de movimiento válidos, delta distinto de cero, signos de entrada/salida y relación entre delta y saldos. Complementar las validaciones que requieren comparar relaciones mediante servicios y `clean()`; una FK por sí sola no demuestra igualdad de tenant.
- Migraciones nuevas, reproducibles desde cero y sobre la base de fase 1. No editar migraciones compartidas para acomodar el modelo nuevo.
- Migración de datos de permisos con modelos históricos (`apps.get_model`), sin importar servicios/modelos actuales desde una migración. Incorporar los nuevos permisos solo a administradores de negocio predefinidos existentes; no tocar roles personalizados. Preparación idempotente actualizada para negocios nuevos.
- Los cuatro permisos de plataforma y los cinco anteriores de negocio conservan su código. Adaptar las pruebas que cuentan permisos al catálogo ampliado; mantener la comprobación de que roles restringidos no ganan permisos.
- `tests/support/fase2.py` exporta `crear_producto_prueba(negocio, **datos)` y `crear_dos_catalogos_prueba()`. Preparar categoría, producto y existencia cero, más cuentas/membresías/roles reutilizando las fábricas existentes. Ofrecer variantes de saldo y movimientos coherentes para pruebas de lectura. Los datos preparados directamente son exclusivos de tests, no un camino de escritura de producción.
- Fixtures con dos negocios y SKU/nombres repetidos entre ellos, una cuenta compartida con permisos distintos, categorías/productos inactivos y productos por unidad/kg/litro.
- Helpers comunes de validación de campos/filtros, si son necesarios, en `api/common/` y documentados antes de que los módulos los utilicen; no introducir copias incompatibles por módulo.

### Imports y uso de la base compartida

```python
from catalogo.models import Categoria, Producto
from inventario.models import Existencia, MovimientoInventario
from tests.support.fase2 import (
    crear_dos_catalogos_prueba,
    crear_movimiento_prueba,
    crear_producto_prueba,
)
```

- `crear_producto_prueba(negocio, **datos)` devuelve un `Producto`. Su fila de saldo y versión cero se consulta mediante `producto.existencias.get()`. Se puede especificar `categoria` o `categoria_id`.
- `crear_dos_catalogos_prueba()` devuelve dos `CatalogoPrueba`. Cada uno contiene `contexto`, `membresia_compartida`, `categoria`, `categoria_inactiva`, `producto`, `producto_inactivo` y `producto_fraccionario`. La cuenta compartida tiene `listar_productos` en el primer negocio y `registrar_entrada` en el segundo.
- `crear_movimiento_prueba(producto, usuario, tipo=..., cantidad=...)` recibe un delta `Decimal` con signo y actualiza en conjunto saldo, versión e historial. La huella es sintética. Para comprobar reintentos, crear la operación original con el servicio de B2 cuando esté disponible.
- B4 define rutas relativas en `api/catalogo/categorias/urls.py`, B5 en `api/catalogo/productos/urls.py` y B6 en `api/inventario/stock/urls.py`. B7–B9 comparten `api/inventario/movimientos/urls.py`, donde declaran `movimientos/` y `ajustes/`. B2 aporta el servicio de escritura; los submódulos lo consumen sin cambiar las composiciones raíz.

Las escrituras individuales validan relaciones del mismo negocio y estado mediante `save()` y `clean()`. PostgreSQL aplica unicidad, claves foráneas y restricciones de cada fila. Las operaciones masivas omiten las validaciones de modelo. Usar los bloqueos descritos en esta guía para coordinar escrituras de catálogo e inventario.

## 5. Servicio de inventario: contrato interno B2

Exportar desde `api/inventario/services.py`:

```python
registrar_movimiento(
    contexto,
    *,
    producto_id,
    tipo,
    motivo,
    clave_operacion,
    cantidad=None,
    stock_objetivo=None,
    version_esperada=None,
)
```

Devuelve `MovimientoInventario`, también en una repetición idéntica. Las vistas responden 201 con el mismo serializer. `tipo` selecciona el permiso requerido: entrada/salida/ajuste. Entradas y salidas usan cantidad positiva; ajuste usa stock objetivo y versión esperada, sin cantidad enviada.

El servicio no confía en que el contexto recibido siga vigente: vuelve a consultar actor, membresía y permiso específico. Usar `resolver_contexto_negocio` y los helpers existentes. Exigir existencia del mismo negocio e input válido. Para operaciones nuevas, producto y categoría deben estar activos; una repetición ya confirmada y autorizada devuelve su registro antes de validar ese estado actual, sin aplicar otra escritura.

La transacción bloquea la fila de Existencia antes de leer y modificar el saldo. Las modificaciones sensibles de Producto —unidad, categoría y activo— también bloquean esa fila antes de releer el producto. Mantener el mismo orden de bloqueo; no mezclar un camino producto→existencia con otro existencia→producto. La creación de producto bloquea/valida la categoría e inicializa su existencia en la misma transacción; la desactivación de categoría y altas/reactivaciones de producto coordinan el bloqueo de categoría para evitar categorías inactivas con productos activos.

Para B5, encerrar la edición sensible en `transaction.atomic()`, tomar `Existencia.objects.select_for_update()` filtrada por negocio y producto y volver a consultar el producto. Si el cambio requiere validar una categoría activa, tomar su bloqueo después del de Existencia. El alta sigue tomando el bloqueo de categoría antes de crear las filas nuevas.

Normalizar la solicitud antes de calcular su huella: mismo actor, producto, tipo, motivo recortado, cantidad/objetivo canónicos y versión esperada. La clave no forma parte de la huella. Verificar la clave dentro de la operación, y antes de rechazar una versión desactualizada, para permitir reintentos de ajustes ya confirmados. Una reutilización incompatible devuelve 409 sin revelar el movimiento de otro actor. Capturar choques de unicidad con un punto de guardado y resolver únicamente el caso esperado; no disfrazar cualquier IntegrityError de duplicado.

Definir `ConflictoInventario` como excepción DRF con `status_code=409`, `default_code="conflict"` y un mensaje legible. El manejador existente conserva `{ code, detail, errors: {} }`; no devolver un objeto distinto desde cada vista. Si se requiere ampliar un helper común, mantener sus casos de fase 1.

Guardar movimiento, saldo y versión juntos. No actualizar existencias desde views, serializers, señales, tareas externas o admin. No reimplementar este algoritmo en entradas/salidas y ajustes. Una excepción posterior a cambiar saldo debe revertirlo todo.

### Uso desde B7 y B8

```python
from api.inventario.services import registrar_movimiento

# En POST /movimientos/, tipo se valida como entrada o salida.
movimiento = registrar_movimiento(contexto, **serializer.validated_data)

# En POST /ajustes/, la vista fija tipo y el serializer recibe el stock y la versión.
movimiento = registrar_movimiento(contexto, tipo="ajuste", **serializer.validated_data)
```

Los serializers validan la forma JSON del contrato y pasan `Decimal` para cantidades u objetivos y `UUID` para la clave. La salida se envía con una cantidad positiva. En un reintento autorizado se conserva la clave y la entrada original, incluida la versión del ajuste. La vista responde 201 tanto para una operación nueva como para una repetición idéntica. El manejador común convierte `ConflictoInventario` al 409 acordado.

## 6. Implementación de endpoints

### Categorías y productos — Sebastián

- Reutilizar vistas genéricas de DRF, campos explícitos y selectores filtrados por el contexto autorizado. POST/PATCH rechazan campos desconocidos y PATCH vacío según el contrato.
- Separar serializers de entrada, salida y opciones. `categoria_nombre` se resuelve con `select_related`, sin requerir listar categorías. No añadir campos de saldo a Producto.
- Categorías: consultar, crear, editar/desactivar y listar opciones activas con permisos independientes. Bloquear la categoría al comprobar desactivación y evitar carreras con altas/reactivaciones de producto.
- Productos: SKU canónico y único por negocio; validar precio/stock mínimo como cadenas decimales y unidad. Crear Producto+Existencia cero con rollback. La edición respeta unidad inmutable tras primer movimiento y el bloqueo compartido; nunca cambia stock.
- Las opciones de producto se consultan con los permisos de entrada/salida/ajuste, sin exigir listar productos ni consultar existencias. Solo devuelven activos del negocio y los campos `ProductoOpcion`.
- Existencias: lecturas sin efectos laterales. El detalle usa `producto_id` como lookup, no el ID de la fila Existencia. El permiso de ajuste habilita solo el detalle necesario para leer versión/saldo; no concede la lista completa.
- Filtros, paginación y nombre de categoría según el contrato; evitar N+1. No añadir parámetros de orden ni tamaños de página propios.

### Movimientos — Diego

- POST `/movimientos/` valida que tipo sea entrada/salida, exige el permiso correspondiente y delega en B2. No aceptar ajuste, saldo, actor o tenant en el cuerpo.
- POST `/ajustes/` recibe objetivo, versión, motivo y UUID. Devuelve Movimiento, no Existencia. No hacer una consulta de saldo fuera del bloqueo para tomar la decisión final.
- GET `/movimientos/` usa su propio permiso, no el de escritura. Filtrar por negocio autorizado y aplicar producto/tipo/fechas/búsqueda en queryset; conservar historial de inactivos y orden determinista.
- Las respuestas anidan producto y usuario en campos acordados, sin exponer huella interna, contraseñas ni flags de Django. Precargar relaciones.
- Solo implementar métodos del contrato. Evitar `ModelViewSet` con update/delete accidentalmente habilitados.

## 7. Reglas obligatorias de desarrollo

| Tema | Requerido | Evitar |
|---|---|---|
| Tenant | Contexto validado, querysets y relaciones del mismo negocio | Buscar productos por ID global o confiar en tenant del cuerpo |
| Autorización | Código exacto por operación; alternativas mediante helpers compartidos | Exigir listados generales para crear o conceder permisos para que pase una prueba |
| Cantidades | Decimal, escala y unidad del contrato; saldos bajo bloqueo | float, redondeo silencioso, saldo negativo o stock mutable por PATCH |
| Transacciones | Movimiento+saldo+versión atómicos y servicio B2 único | Guardados parciales, validación de saldo sin bloqueo o señales esenciales |
| Historial | Inmutable, actor/fecha del servidor, FK protegidas | Editar/eliminar movimientos o aceptar auditoría del cliente |
| Compatibilidad | Nuevas migraciones y pruebas de fase 1 conservadas | Reescribir migraciones o eliminar pruebas de seguridad para acomodar permisos |
| Errores/OpenAPI | Envoltorio común; solicitudes/respuestas explícitas y 409 documentado | Responses ficticias, `fields="__all__"` o capturar toda excepción |
| Archivos | Un dueño por módulo; coordinar modelos/servicios con Romel | Cambios paralelos en la misma migración o lógica duplicada |

No ampliar dependencias del proyecto por rutina. Reutilizar las bibliotecas y patrones existentes; cualquier necesidad adicional se explica en el PR.

## 8. Pruebas y criterios de cierre

Cada issue verifica éxito, validación, permiso ausente, cuenta/membresía/negocio inactivo, CSRF en escrituras y datos de otro negocio. Para entradas/ajustes usar las fábricas; no esperar APIs de catálogo para comenzar.

B2 prueba Decimal/unidad, entrada/salida/ajuste, salida sin saldo, versión antigua, objetivo idéntico, mismo UUID/misma solicitud, mismo UUID/solicitud distinta, otro actor, misma clave en negocios distintos, carrera de clave entre productos y rollback al fallar el guardado del movimiento. B3 añade conexiones PostgreSQL separadas: dos salidas no sobregiran el saldo; dos ajustes con la misma versión no se pisan; dos entradas válidas se acumulan.

B4/B5 verifican unicidad por negocio, normalización, desactivación/reactivación y edición de unidad después de un movimiento. B6/B9 verifican todos los filtros, sus combinaciones inválidas, orden y páginas vacías/fuera de rango.

Swagger debe describir exclusivamente rutas implementadas, con serializers de entrada/salida separados, decimales como cadenas, catálogos de opciones, paginación y errores. Mantener guardas `swagger_fake_view` cuando no exista contexto real al generar el esquema. Actualizar la prueba que compara el conjunto de rutas; no eliminarla.

Desde backend, con el entorno preparado:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py
.\.venv\Scripts\python.exe manage.py spectacular --validate --fail-on-warn
node tools/verificar_swagger.mjs
```

Al estar listo F3, ampliar y ejecutar también `tools/verificar_postgres.py --integracion-frontend` con dependencias de frontend instaladas. B3 puede cerrar sus pruebas de API sin esperar F3; el cierre global exige ambos. No se debe crear una dependencia circular entre B3 y F3.

PR hacia `dev`, relacionado con el issue, con preparación, pasos, respuestas y comandos reales. No publicar contraseñas, cookies ni tokens. Romel revisa backend y coordina las modificaciones compartidas. El issue se cierra después de integrar y verificar, no al subir la rama.

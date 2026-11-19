# Fase 2 · Catálogo e inventario básico

Este documento define el **contrato común por implementar**. La guía de [backend](backend/fase2.md) y la de [frontend](frontend/fase2.md) indican dónde desarrollar y cómo repartir el trabajo. Leer los tres documentos y el issue antes de comenzar. La fase 1 integrada en `dev` es la base; estos documentos no afirman que la fase 2 esté implementada.

## 1. Objetivo y alcance

Cada negocio podrá organizar categorías y productos, consultar sus existencias y registrar entradas, salidas y ajustes con historial. Se utilizarán los usuarios, membresías, permisos, sesiones y negocio activo de fase 1.

Las decisiones de esta entrega son:

- Una existencia por producto y negocio; sin bodegas, lotes ni transferencias.
- Cantidades con hasta tres decimales para admitir unidades, kilogramos y litros. Dinero con dos decimales.
- Los saldos comienzan en cero y nunca pueden ser negativos. El stock inicial se registra como entrada.
- Cada cambio de saldo genera un movimiento inmutable, con actor y fecha del servidor.
- Creación y edición de categorías/productos mediante formularios en modales reutilizables.
- Ventas, compras a proveedores, facturación, impuestos, recetas, vencimientos y valoración de inventario corresponden a entregas posteriores. `precio_venta` es un dato de catálogo, no un módulo de ventas.

## 2. Datos, precisión e integridad

Los IDs son enteros. Los textos se recortan en sus extremos. Los booleanos son JSON `true`/`false`. Fechas de respuesta: ISO 8601 con zona horaria, generadas por Django; guardar en UTC.

### Categoría

| Campo | Tipo y regla |
|---|---|
| `id` | Autogenerado. |
| `negocio_id` | FK al negocio; obligatorio, asignado por el servidor e inmutable. |
| `nombre` | Texto requerido, máximo 150. Único por negocio tras recortar espacios; la comparación de esta fase distingue mayúsculas. |
| `descripcion` | Texto opcional, máximo 500, predeterminado `""`. |
| `activo` | Booleano, predeterminado `true`. |

Se utiliza desactivación mediante PATCH, sin borrado físico. No desactivar una categoría que tenga productos activos. La creación o reactivación de un producto exige categoría activa del mismo negocio.

Al cambiar `categoria_id`, la categoría nueva también debe estar activa. Un PATCH de otros campos de un producto inactivo puede conservar su categoría inactiva actual; para reactivar el producto primero debe existir una categoría activa válida.

### Producto

| Campo | Tipo y regla |
|---|---|
| `id`, `negocio_id` | ID autogenerado y negocio inmutable asignado por el servidor. |
| `categoria_id` | FK obligatoria a una categoría del mismo negocio; proteger su borrado. |
| `sku` | Texto requerido, máximo 50; recortar y convertir a mayúsculas antes de validar. Patrón `[A-Z0-9][A-Z0-9._-]{0,49}`. Único por negocio. |
| `nombre` | Texto requerido, máximo 150; no es identificador único. |
| `descripcion` | Texto opcional, máximo 500, predeterminado `""`. |
| `unidad` | Uno de `unidad`, `kg`, `litro`. |
| `precio_venta` | Decimal(12,2), requerido y mayor o igual a cero. |
| `stock_minimo` | Decimal(14,3), mayor o igual a cero; predeterminado `"0.000"`. |
| `activo` | Booleano, predeterminado `true`. |

Crear Producto y su Existencia con saldo cero en una transacción. No admitir stock inicial en el cuerpo de producto. Después del primer movimiento no se puede cambiar `unidad`. Cambiar precio, nombre, categoría o stock mínimo no modifica el saldo ni el historial. Desactivar un producto conserva su saldo e historial; para moverlo se debe reactivar.

### Existencia

| Campo de modelo | Tipo y regla |
|---|---|
| `id`, `negocio_id`, `producto_id` | Producto del mismo negocio; combinación negocio/producto única. |
| `cantidad` | Decimal(14,3), predeterminado cero, nunca negativo. |
| `version` | Entero no negativo, predeterminado cero; aumenta en uno por movimiento confirmado. |

No habrá POST/PATCH de existencias. Se modifican únicamente mediante el servicio transaccional de inventario.

### MovimientoInventario

| Campo de modelo | Tipo y regla |
|---|---|
| `id`, `negocio_id`, `producto_id` | IDs y relaciones del mismo negocio; proteger relaciones históricas. |
| `usuario_id` | Actor autenticado, asignado por el servidor y protegido frente a borrado. |
| `tipo` | `entrada`, `salida` o `ajuste`. |
| `cantidad` | Decimal(14,3), **delta con signo** distinto de cero. Entrada positiva; salida negativa; ajuste positivo o negativo. |
| `saldo_anterior`, `saldo_posterior` | Decimal(14,3), ambos no negativos; posterior = anterior + cantidad. |
| `motivo` | Texto requerido, máximo 255. |
| `clave_operacion` | UUID obligatorio, único por negocio; permite repetir una solicitud sin aplicar otro movimiento. |
| `huella_solicitud` | Texto interno SHA-256 de la entrada normalizada y actor; no se expone en la API. |
| `creado_en` | Fecha/hora del servidor al crear. |

No editar ni borrar movimientos desde API ni habilitar su edición directa en administración. Las correcciones se registran con un nuevo movimiento, conservando el anterior.

### Decimales y unidades

Enviar cantidades y precios como **cadenas decimales**, sin coma, separadores de miles, notación exponencial ni valores no finitos. Rechazar números JSON en esos campos para conservar el contrato exacto. Se acepta, por ejemplo, `"5"`, `"5.0"` o `"5.000"` para cantidades; la respuesta normaliza a tres posiciones. Precios se normalizan a dos. Rechazar exceso de precisión; no redondear silenciosamente.

Para `unidad`, cantidades, stock objetivo y stock mínimo deben ser enteros, aunque se serialicen como `"5.000"`. Para `kg` y `litro` se admiten tres decimales. Los límites son los del Decimal declarado; rechazar también un saldo resultante fuera de rango.

Backend utiliza `Decimal`. Frontend conserva cadenas en tipos, formularios y respuestas. La simulación opera con enteros escalados/`bigint` internos y devuelve cadenas: nunca calcula saldos mediante coma flotante ni expone `bigint` en JSON.

## 3. Respuestas compartidas

Los campos indicados son el conjunto exacto de respuesta; no añadir información por conveniencia de una pantalla sin actualizar el contrato.

```text
Categoria = { id, negocio_id, nombre, descripcion, activo }
CategoriaOpcion = { id, negocio_id, nombre }
Producto = { id, negocio_id, categoria_id, categoria_nombre, sku, nombre,
             descripcion, unidad, precio_venta, stock_minimo, activo }
ProductoOpcion = { id, negocio_id, sku, nombre, unidad }
ProductoResumen = { id, negocio_id, sku, nombre, unidad, activo,
                    categoria_id, categoria_nombre }
Existencia = { id, negocio_id, producto: ProductoResumen, cantidad,
               stock_minimo, bajo_minimo, version }
Movimiento = { id, negocio_id, producto: ProductoOpcion, usuario: Usuario,
               tipo, cantidad, saldo_anterior, saldo_posterior, motivo,
               clave_operacion, creado_en }
```

`Usuario` conserva `{ id, username, is_active }` de fase 1. `categoria_nombre` y los objetos anidados se resuelven en el servidor sin exigir al usuario otros listados. `bajo_minimo` es `cantidad < stock_minimo`; igualdad no cuenta como bajo mínimo. El stock mínimo de Existencia se obtiene del Producto, no se duplica como columna. El resumen de producto muestra sus datos actuales; los saldos y el delta históricos no cambian.

Listas: `Pagina<T> = { count, next, previous, results }`, tamaño inicial **2**, con el paginador existente. No seguir URLs `next` con fetch arbitrario: incrementar `page` en la misma función tipada. Listados de categorías/productos: `id` ascendente; existencias: `producto_id` ascendente; movimientos: `-creado_en, -id`. No permitir orden arbitrario en esta entrega.

## 4. API y permisos

Todas las rutas de la tabla se añaden a **`/api/v1/negocios/{negocio_id}`** y conservan barra final. Requieren sesión, cuenta/negocio/membresía activos. Reutilizar autorización y errores de fase 1. POST/PATCH requieren CSRF. Un permiso de creación no exige su permiso de listado general.

| Método y ruta | Entrada | Éxito | Permiso de negocio |
|---|---|---|---|
| GET `/categorias/` | Filtros y page | 200, `Pagina<Categoria>` | `listar_categorias` |
| POST `/categorias/` | `{ nombre, descripcion? }` | 201, Categoria | `crear_categoria` |
| GET `/categorias/{categoria_id}/` | — | 200, Categoria | `listar_categorias` o `editar_categoria` |
| PATCH `/categorias/{categoria_id}/` | `{ nombre?, descripcion?, activo? }` | 200, Categoria | `editar_categoria` |
| GET `/categorias/opciones/` | `search`, `page` | 200, `Pagina<CategoriaOpcion>` activa | `crear_producto` o `editar_producto` |
| GET `/productos/` | Filtros y page | 200, `Pagina<Producto>` | `listar_productos` |
| POST `/productos/` | `{ categoria_id, sku, nombre, descripcion?, unidad, precio_venta, stock_minimo? }` | 201, Producto | `crear_producto` |
| GET `/productos/{producto_id}/` | — | 200, Producto | `listar_productos` o `editar_producto` |
| PATCH `/productos/{producto_id}/` | Campos editables de producto, incluido `activo` | 200, Producto | `editar_producto` |
| GET `/productos/opciones/` | `search`, `page` | 200, `Pagina<ProductoOpcion>` activa | `registrar_entrada` o `registrar_salida` o `ajustar_inventario` |
| GET `/existencias/` | Filtros y page | 200, `Pagina<Existencia>` | `consultar_existencias` |
| GET `/existencias/{producto_id}/` | — | 200, Existencia | `consultar_existencias` o `ajustar_inventario` |
| POST `/movimientos/` | `{ producto_id, tipo, cantidad, motivo, clave_operacion }` | 201, Movimiento | `registrar_entrada` si entrada; `registrar_salida` si salida |
| POST `/ajustes/` | `{ producto_id, stock_objetivo, version_esperada, motivo, clave_operacion }` | 201, Movimiento tipo ajuste | `ajustar_inventario` |
| GET `/movimientos/` | Filtros y page | 200, `Pagina<Movimiento>` | `listar_movimientos` |

En POST movimientos, `tipo` solo admite `entrada` y `salida`, y `cantidad` de entrada es siempre positiva: el servidor calcula el signo almacenado. No enviar un ajuste a esa ruta. PATCH solo admite los campos editables indicados; rechazar PATCH vacío y campos desconocidos. En POST no aceptar `activo`, `negocio_id`, `usuario_id`, saldos, versión ni campos de auditoría, salvo `version_esperada` en ajustes. Rechazar campos desconocidos con 400 y error por campo. Categoria/Product POST crean activos.

No existe DELETE en esta fase: responder 405 con el envoltorio común. Un ID de ruta fuera del negocio autorizado devuelve 404; una relación enviada (`categoria_id` o `producto_id`) inválida, inactiva o de otro negocio devuelve 400 en ese campo sin revelar su existencia.

### Filtros

- Comunes a listas: `page` entero positivo y `search` texto recortado de máximo 150.
- Categorías: `search` sobre nombre y `activo=true|false`; omitido incluye ambos estados.
- Productos: `search` sobre nombre o SKU, `categoria_id` y `activo`; omitido incluye ambos estados.
- Opciones: siempre activos, `search` por nombre y, en productos, SKU. No exigen el permiso del listado general.
- Existencias: `search` sobre nombre/SKU, `categoria_id`, `activo` del producto y `bajo_minimo=true|false`; sin filtros incluye productos inactivos para no ocultar saldos.
- Movimientos: `search` sobre nombre/SKU del producto, `producto_id`, `tipo`, `desde`, `hasta`. Tipo admite los tres valores. Fechas ISO 8601 con zona; límite inferior inclusivo y superior exclusivo, `desde < hasta`. Sin filtro muestra todo el historial del negocio, también de productos inactivos.
- Validar booleanos, IDs, fechas y combinaciones. Un `categoria_id`/`producto_id` de filtro ajeno o inexistente devuelve 400 en el filtro; una opción válida sin coincidencias devuelve lista vacía. Parámetros no declarados devuelven 400; no introducir aliases distintos en cada módulo. `page` inválida o fuera de rango conserva el 404 del paginador existente.

### Catálogo de permisos y compatibilidad

Agregar los **11 códigos** de la tabla: tres de categorías, tres de productos, uno de existencias, tres de movimientos de escritura y uno de historial. Todos son de ámbito `negocio`. Mantener los cinco códigos anteriores y los cuatro de plataforma.

Una migración de datos nueva prepara estos permisos y los asigna a los Administradores de negocio predefinidos **existentes**. La preparación idempotente también debe cubrir negocios nuevos. No ampliar roles personalizados ni el Superadministrador, ni otorgarle acceso implícito a datos de negocio. No editar migraciones ya aplicadas. Las pruebas que suponían cinco permisos de negocio se actualizan al nuevo catálogo sin eliminar casos de acceso denegado.

## 5. Operaciones de inventario

1. Validar entrada y resolver contexto y permiso específico. Nunca confiar en tenant/actor del cuerpo.
2. Dentro de `transaction.atomic()`, bloquear la Existencia del producto y negocio con bloqueo de fila. Volver a leer producto, estado y autorización persistida antes de guardar. Las ediciones sensibles de Producto utilizan el mismo bloqueo.
3. Consultar la clave de operación. Una repetición del mismo actor y entrada normalizada devuelve el movimiento original con 201, sin modificar cantidad, versión ni fecha. Una clave reutilizada con otro actor o contenido devuelve **409 `conflict`**. La repetición sigue exigiendo autorización actual, pero se resuelve antes de validar versión/saldo/estado activo del producto: si ya se confirmó y después se desactivó, solo devuelve el registro, no aplica otra escritura.
4. Calcular con Decimal. Salida mayor al saldo: 400 en `cantidad`. Producto/categoría inactivos: 400 en `producto_id`. Fallo o desbordamiento: no guardar saldo ni movimiento.
5. Ajuste: exigir `version_esperada` igual a la versión bloqueada; si cambió, 409 `conflict`. Calcular delta = stock_objetivo − saldo actual. Objetivo negativo/inválido o delta cero: 400 en `stock_objetivo`.
6. Guardar saldo, incrementar versión y registrar el movimiento en la misma transacción. La restricción única de clave por negocio cubre también carreras entre productos distintos: resolver el choque como repetición/conflicto, nunca como 500.

No repetir automáticamente una escritura por fallos de red ni CSRF. Frontend conserva la misma clave y los mismos datos al reintentar manualmente una operación cuyo resultado no pudo confirmar. Si cambia la entrada, es otra operación y usa otra clave. Tras un conflicto de ajuste, volver a consultar la existencia y solicitar un nuevo envío con la versión actual; no sobrescribir automáticamente.

### Errores

Se conserva `{ code, detail, errors }`: 400 `validation_error` por campo, 403 `not_authenticated`/`permission_denied`/`csrf_failed`, 404 `not_found` y 405 `method_not_allowed`. Se añade 409 `conflict`, con mensaje legible y `errors: {}`; el cliente ofrece revisión de la operación y actualización del saldo cuando corresponda. No convertir excepciones inesperadas en validaciones ni ocultar errores 500.

Ejemplo de solicitud de salida, con cantidad positiva:

```json
{
  "producto_id": 12,
  "tipo": "salida",
  "cantidad": "2.000",
  "motivo": "Entrega de mercadería",
  "clave_operacion": "d87023cc-30b8-41a7-a547-9e4d2571f633"
}
```

Con saldo anterior `"7.000"`, Movimiento devuelve `cantidad: "-2.000"`, saldo posterior `"5.000"` y la existencia aumenta su versión en uno. El UUID del ejemplo no debe reutilizarse para otras operaciones.

## 6. Orden de trabajo y responsables

Los códigos B/F son identificadores de planificación; cada uno enlaza su issue real. Cada issue incluye sus pruebas y documentación. Los cierres finales complementan esas pruebas.

| Código | Responsable | Entrega | Bloqueado por |
|---|---|---|---|
| [B1 · #40](https://github.com/romcode15/gestion-negocios/issues/40) | Romel | Modelos, migraciones, permisos, rutas base y fábricas | Base de fase 1 en dev |
| [B2 · #41](https://github.com/romcode15/gestion-negocios/issues/41) | Romel | Servicio transaccional común de inventario | B1 |
| [B3 · #48](https://github.com/romcode15/gestion-negocios/issues/48) | Romel | Integración y cierre backend | B2, B6, B9 |
| [B4 · #42](https://github.com/romcode15/gestion-negocios/issues/42) | Sebastián | API de categorías | B1 |
| [B5 · #43](https://github.com/romcode15/gestion-negocios/issues/43) | Sebastián | API de productos y opciones | B4 |
| [B6 · #44](https://github.com/romcode15/gestion-negocios/issues/44) | Sebastián | Consulta de existencias y filtros | B5 |
| [B7 · #45](https://github.com/romcode15/gestion-negocios/issues/45) | Diego | Entradas y salidas | B2 |
| [B8 · #46](https://github.com/romcode15/gestion-negocios/issues/46) | Diego | Ajustes de inventario | B7 |
| [B9 · #47](https://github.com/romcode15/gestion-negocios/issues/47) | Diego | Historial de movimientos | B8 |
| [F1 · #49](https://github.com/romcode15/gestion-negocios/issues/49) | Henry | Componentes, modales y estructura compartida | Base de fase 1 en dev |
| [F2 · #50](https://github.com/romcode15/gestion-negocios/issues/50) | Henry | Tipos, funciones API y simulación de fase 2 | F1 |
| [F3 · #57](https://github.com/romcode15/gestion-negocios/issues/57) | Henry | Integración real y cierre frontend | F6, F9, B3 |
| [F4 · #51](https://github.com/romcode15/gestion-negocios/issues/51) | Diana | Categorías: listado y modales | F2 |
| [F5 · #52](https://github.com/romcode15/gestion-negocios/issues/52) | Diana | Productos: listado y modales | F4 |
| [F6 · #53](https://github.com/romcode15/gestion-negocios/issues/53) | Diana | Existencias: consulta y filtros | F5 |
| [F7 · #54](https://github.com/romcode15/gestion-negocios/issues/54) | Kelvin | Modales de entradas y salidas | F2 |
| [F8 · #55](https://github.com/romcode15/gestion-negocios/issues/55) | Kelvin | Modal de ajustes | F7 |
| [F9 · #56](https://github.com/romcode15/gestion-negocios/issues/56) | Kelvin | Historial y filtros | F8 |

Frontend F1/F2 y los módulos con simulación **no dependen de endpoints backend**: consumen este contrato. La comprobación real de frontend F3 sí espera el cierre backend B3. Backend prepara fábricas con modelos para que Diego no dependa de llamar a los endpoints de Sebastián ni viceversa.

## 7. Reglas del equipo y cierre

- Una rama por issue desde `dev` actualizada; PR hacia `dev`. Seguir [guiagithub.md](guiagithub.md). La documentación de esta fase no autoriza integrar entregas a `main`.
- Comenzar una dependencia solo cuando su PR esté integrado y verificado, no solo porque el issue se marque cerrado. Las dependencias de GitHub orientan el orden; los revisores deben comprobarlo.
- Romel mantiene modelos, migraciones y servicio compartido; Henry mantiene componentes, contratos, transportes y rutas compartidas. Coordinar cambios a esos archivos; cada módulo conserva archivos propios según las guías de área.
- Cambiar un contrato exige actualizar este documento, sus tipos, simulación, OpenAPI y pruebas. No inventar campos/rutas por separado.
- Para cerrar: dos negocios, una cuenta compartida con permisos distintos, categorías/productos homónimos/SKU iguales permitidos entre negocios, filtros, activos/inactivos, saldo cero, fracciones, entradas/salidas, ajuste, delegación, CSRF, idempotencia, rollback y concurrencia. Sin regresiones de fase 1.
- El cierre frontend demuestra el flujo con formularios React y HTTP real hacia Django/PostgreSQL; registrar también la revisión visual de modales, teclado, carga, errores y pantallas pequeñas.

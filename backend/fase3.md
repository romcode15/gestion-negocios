# Fase 3 · Backend — Base y desarrollo de ventas

Leer el [contrato común](../fase3.md), el issue y [guiagithub.md](../guiagithub.md).
El contrato fija campos, rutas, permisos, filtros, escalas, errores, redondeo y
operaciones de inventario. Esta guía fija dónde implementar y qué reutilizar.

## 1. Estado y alcance de B1/B2 (#80/#81)

La app `ventas` está registrada y cuenta con modelos/migración, permisos,
serializers de salida, fixtures y composición de URLs vacía. B2 implementa
`ventas.services.confirmacion.confirmar_venta`. **No hay todavía endpoints de
ventas ni servicio de anulación de producción.**
Swagger conserva exclusivamente las rutas implementadas de fases 1 y 2.

B4–B9 implementan los módulos pendientes. No construir ventas llamando por
HTTP a movimientos manuales, ni conceder `registrar_salida` o `registrar_entrada`
a quien únicamente puede registrar o anular ventas.

## 2. Estructura y propiedad

```text
backend/
├── ventas/
│   ├── models.py                       # Venta, DetalleVenta, AnulacionVenta, VinculoMovimientoVenta
│   ├── decimales.py                    # Validación Decimal y subtotal HALF_UP
│   ├── migrations/                    # Romel; no crear migraciones paralelas
│   ├── services/
│   │   ├── common.py                  # Huellas canónicas de registro/anulación
│   │   ├── confirmacion.py            # B2, Romel: implementado
│   │   └── anulacion.py               # B7, Diego: por implementar
│   └── tests/                         # Modelos y pruebas de dominio
├── inventario/operaciones.py            # Primitivas internas compartidas, Romel
├── api/ventas/
│   ├── urls.py                        # Composición; no duplicarla por módulo
│   ├── serializers.py                 # Salidas comunes de B1
│   ├── opciones/                      # B4, Sebastián
│   ├── registro/                      # B5, Sebastián
│   ├── consultas/                     # B6, Sebastián; mixins.py preparado
│   ├── anulaciones/                   # B7, Diego
│   └── trazabilidad/                  # B8, Diego
└── tests/
    ├── support/fase3.py                # Fixtures independientes de APIs
    └── integration/                    # B9 carreras; B3 cierre global
```

`ventas` contiene el dominio; `api/ventas` no es una app adicional. Romel mantiene
modelos, migraciones, primitivas y confirmación; Sebastián y Diego desarrollan
sus submódulos y coordinan ampliaciones del esquema con Romel. Cada issue añade
sus pruebas y documentación. No sustituirlas por los issues de cierre.

## 3. Modelos e invariantes

| Modelo | Garantías de la base |
|---|---|
| Venta | Clave única por negocio, estado válido, total no negativo, huella SHA-256, actor del negocio y encabezado conservado. |
| DetalleVenta | Producto/venta/negocio coherentes, una línea por producto/venta, cantidades positivas y enteras para unidad, snapshot inmutable y subtotal HALF_UP. |
| AnulacionVenta | Una por venta, UUID único por negocio dentro de anulaciones, motivo requerido, actor del negocio e inmutabilidad. |
| VinculoMovimientoVenta | Un movimiento por vínculo, una operación por detalle, coherencia de negocio/producto/delta/tipo y actor de venta/anulación. |

Todas las relaciones históricas usan `PROTECT`. No registrar ventas, detalles,
anulaciones o vínculos en un CRUD editable de administración. El modelo bloquea
actualizaciones individuales de los históricos y borrados de instancias.
`QuerySet.update`, `bulk_create`, `bulk_update` y SQL omiten validaciones de modelo:
no usarlos para evitar las reglas. PostgreSQL protege unicidad, rangos/signos,
estados, SKU/unidad y cálculo de subtotal por fila; la coherencia entre filas y
la confirmación completa corresponden a la transacción del servicio.

Durante la transacción de confirmación puede existir un encabezado aún sin líneas.
B2 valida el conjunto final de 1–100 productos distintos y total igual a suma de
subtotales; no confundir la preparación transitoria del modelo con una venta
completa autorizada. B7 crea auditoría y reposiciones antes de guardar
`venta.estado = Venta.Estado.ANULADA` y `venta.save(update_fields=["estado"])` dentro
de la misma transacción. El encabezado no admite volver a confirmada ni cambiar
total, vendedor, clave, observaciones o fecha.

Los datos de `DetalleVenta` son snapshots, no propiedades que sigan al catálogo.
Una edición posterior del producto conserva las líneas y totales anteriores.
Actor/fecha/negocio y precios se resuelven en servidor. No recibirlos libremente
desde un serializer de entrada.

## 4. Primitivas de inventario

```python
from inventario.operaciones import bloquear_existencias, aplicar_delta_bloqueado
from ventas.decimales import calcular_subtotal
from ventas.services.common import huella_venta, huella_anulacion
```

Firmas disponibles:

```python
bloquear_existencias(negocio_id, producto_ids, *, using="default")  # dict producto_id → Existencia
aplicar_delta_bloqueado(contexto, existencia, *, tipo, delta, motivo,
                       clave_operacion, huella_solicitud, campo="cantidad")  # MovimientoInventario
calcular_subtotal(cantidad, precio_unitario)  # Decimal; entradas Decimal exactas
huella_venta(vendedor_id, detalles, observaciones="")  # líneas ya validadas
huella_anulacion(usuario_id, venta_id, motivo)
```

1. El servicio resuelve autorización y valida entradas. Una vista nunca llama
   directamente a las primitivas para eludir permisos.
2. Entrar en `transaction.atomic()` externo; ambas primitivas lo exigen.
3. Bloquear TODO el conjunto con `bloquear_existencias`, que filtra por negocio,
   ordena por `producto_id` y evita joins que bloqueen categorías/productos sin
   necesidad. El mapa puede omitir IDs inexistentes/ajenos: el servicio traduce
   esos faltantes al error por línea del contrato, antes de escribir.
4. Releer autorización persistida y producto/precio/estado después de esperar.
   B2 exige productos/categorías activos; B7 permite restitución de inactivos.
5. Aplicar deltas en ese mismo orden. Cada aplicación relee la existencia bajo
   bloqueo, valida signo, precisión, unidad, saldo/rango y versión segura, y guarda
   saldo + versión + movimiento en un savepoint. Un error no deja saldo parcial.
6. El servicio confirma encabezado, detalles, movimientos y vínculos en la misma
   transacción externa. Una excepción revierte el conjunto completo.

La primitiva **no** decide permisos, actividad, idempotencia de ventas, precio,
saldo objetivo de un ajuste o significado comercial del motivo. Esas decisiones
permanecen en el servicio autorizado. `api/inventario/services.registrar_movimiento`
conserva su firma, permisos por tipo, reintentos, versión esperada y errores de
fase 2; ahora reutiliza las primitivas. No ampliar ese endpoint para vender.

Las huellas reciben líneas con `producto_id` y Decimal en `cantidad` y
`precio_unitario_esperado`. Ordenan por producto, normalizan a 3/2 posiciones y
recortan observaciones/motivo. Validar precisión ANTES de calcular la huella:
el formateo no sustituye la validación. Los UUID de movimientos son independientes
de la clave de venta, uno por detalle/operación.

## 5. Servicio de confirmación — B2 (#81)

```python
from ventas.services.confirmacion import confirmar_venta

venta = confirmar_venta(
    contexto,
    clave_operacion=clave_uuid,
    observaciones="Nota opcional",
    detalles=[{
        "producto_id": producto_id,
        "cantidad": "1.250",
        "precio_unitario_esperado": "2.50",
    }],
)
```

Devuelve un modelo `Venta`; B5 responde con `VentaDetalleSerializer` y 201 tanto
al crear como al repetir. El servicio abre su transacción y exige únicamente
`registrar_venta`, releyendo usuario/membresía/rol/negocio persistidos. No requiere
permisos manuales de stock ni listado. No importar fixtures para confirmar una
venta real.

Validación del servicio:

- Detalles es una lista de 1–100 objetos, con campos exactos, sin productos
  repetidos. ID entero JSON positivo seguro; cantidad/precio son strings o
  Decimal ya validados por el serializer. Float, int y bool se rechazan en esos
  campos. El serializer de B5 debe verificar el tipo JSON original ANTES de
  convertirlo a Decimal; no confiar en la coerción de un DecimalField genérico.
- Validar UUID, observaciones recortadas de hasta 500 y caracteres válidos;
  no redondear entradas ni aceptar coma/exponente/precisión excesiva.
- Los errores usan claves planas con el índice ORIGINAL del envío, por ejemplo
  `detalles.1.cantidad`, aunque el bloqueo y guardado se ordenen por producto.
- Precio esperado diferente del catálogo: `ConflictoVenta` (409 `conflict`,
  errors vacío). El precio persistido y los totales se calculan con los valores
  del servidor. Stock insuficiente y subtotal/total fuera de rango: 400, sin
  guardar una venta parcial.

Secuencia transaccional:

1. Revalidar permiso actual, normalizar entradas y calcular huella canónica.
   Consultar una confirmación anterior antes de validar stock/precio/actividad.
2. Bloquear todas las Existencias por producto_id ascendente y volver a resolver
   autorización. Consultar de nuevo la clave por si otro intento confirmó
   mientras se esperaba el bloqueo.
3. Releer productos/categorías/precios; validar todas las líneas y el total antes
   de escribir. Calcular con contexto Decimal suficiente y HALF_UP por línea.
4. En un savepoint, crear encabezado, detalles/snapshots, salidas y vínculos;
   versiones aumentan una vez por línea. UUID de cada movimiento independiente
   de la clave de venta y motivo del servidor con venta/detalle. Volver a
   comprobar autorización antes de confirmar el conjunto: un INSERT también
   puede esperar por unicidad/FK y permitir cambios de acceso durante la espera.
5. Un error revierte el conjunto. Solo una colisión identificada de
   `venta_clave_unica_por_negocio` se concilia tras rollback y nueva autorización.
   Se cubre tanto UniqueViolation PostgreSQL como la detección previa de
   `full_clean`; otros errores de persistencia conservan su excepción original.

Misma clave/actor/entrada normalizada devuelve la venta existente sin otra
escritura; otra entrada/actor produce 409. Las líneas reordenadas o cantidades
equivalentes son la misma entrada. Una repetición autorizada después de anular
devuelve la misma venta con su estado/anulación actuales y detalles originales;
no confirma otra venta. No bloquear la Venta después de sus existencias durante
la lectura de repetición: la anulación usa el orden Venta → Existencias.

### Componentes comunes disponibles para B7

Desde `ventas.services.common`:

| Componente | Uso |
|---|---|
| `ConflictoVenta(detail)` | Conflicto 409 con el envoltorio común existente. |
| `revalidar_contexto_ventas(contexto, permiso)` | Releer usuario y autorización persistida antes/después de esperas. |
| `normalizar_uuid(valor)` | UUID interno o string canónico; error en clave_operacion. |
| `normalizar_texto(valor, campo=..., maximo=..., obligatorio=False)` | Texto recortado, longitud, nul/surrogates y obligatoriedad. |
| `normalizar_decimal(valor, campo=..., digitos=..., escala=..., positivo=False)` | Decimal exacto con precisión validada antes de normalizar escala. |
| `es_colision_clave(error, modelo, restriccion)` | Identificar únicamente la unicidad de negocio/clave del modelo indicado. |
| `huella_anulacion(usuario_id, venta_id, motivo)` | Huella propia de anulación, independiente de registro. |
| `huella_movimiento_venta(usuario_id, detalle_id, operacion)` | Huella interna para salida/reposición; operacion venta/anulacion. |

B7 implementa su módulo `services/anulacion.py`, no modifica confirmacion.py.
Sus nuevas claves y su restricción de unicidad se concilian contra
`AnulacionVenta`; nunca devolver una confirmación para resolver una anulación.

Las pruebas del servicio están en `ventas/tests/test_confirmacion.py`, incluyendo
conexiones PostgreSQL separadas, orden inverso de carritos, respuesta repetida,
colisiones de claves entre productos disjuntos y revocación/precio cambiado
durante espera. No sustituyen las pruebas HTTP de B5/B9 ni el cierre B3.

## 6. URLs y serializers compartidos

La composición monta todos los submódulos bajo el prefijo común de negocio.
Sus `urlpatterns = []` no publican endpoints ni documentación ficticia.

**GET y POST de `ventas/` comparten una sola vista de colección.** B5 publica la
ruta relativa `""` desde `registro/urls.py` y compone
`api.ventas.consultas.mixins.ListadoVentasMixin` con su vista de creación. Dejar
`get/head/post/options` admitidos; B6 implementa `get()` en el mixin y publica
únicamente `<int:venta_id>/` en consultas. No registrar dos `path("")` esperando
que Django elija por método: la primera ruta absorbería ambas solicitudes.
B5/B6 coordinan serializers/permisos por método y OpenAPI, sin permitir el GET
de listado con `registrar_venta` o `anular_venta`.

Importar las salidas de `api.ventas.serializers`:
`VentaProductoOpcionSerializer`, `VentaResumenSerializer`,
`VentaDetalleSerializer`, `DetalleVentaSerializer`, `AnulacionVentaSerializer`
y `MovimientoVentaSerializer`. Son de solo lectura, campos exactos y decimales
string. El queryset de opciones aportará `disponible`; no modificar
`ProductoOpcionSerializer` de fase 2. Los futuros módulos definen sus propios
serializers de entrada estrictos y no exponen `huella_solicitud`.

Cada módulo añade documentación de sus rutas realmente implementadas y coordina
la actualización del comparador global OpenAPI. Conservar sus pruebas existentes;
no eliminar el comparador porque todavía haya módulos pendientes.

El paginador base de fase 1 fuerza `id` ascendente. Para B6 y B8 conservar el
orden de sus selectores con una subclase que delegue en
`PageNumberPagination.paginate_queryset`, como hace el historial de fase 2;
no perder `-creado_en,-id` de ventas ni el orden cronológico de vínculos.

## 7. Fixtures independientes de endpoints

```python
from decimal import Decimal
from tests.support.factories import crear_contexto_negocio
from tests.support.fase3 import (
    crear_producto_venta_prueba, crear_venta_confirmada_prueba,
    crear_dos_escenarios_ventas, anular_venta_prueba,
)

ctx = crear_contexto_negocio()
producto = crear_producto_venta_prueba(
    ctx.negocio, usuario=ctx.administrador, saldo=Decimal("5.000"),
    sku="PRUEBA-01", precio_venta=Decimal("2.50"),
)
venta = crear_venta_confirmada_prueba(
    ctx.negocio, ctx.administrador,
    detalles=[(producto, Decimal("2.000"))],
)
```

Firmas:

- `crear_producto_venta_prueba(negocio, *, saldo=Decimal("0.000"), usuario=None, **datos)`:
  crea producto/existencia; saldo positivo exige actor explícito y registra una
  entrada coherente. Saldo cero no crea movimiento. Son datos de prueba; la API
  de productos sigue sin aceptar stock inicial.
- `crear_venta_confirmada_prueba(negocio, vendedor, *, detalles=None,
  clave_operacion=None, observaciones="")`: recibe pares Producto/Decimal. El stock
  de líneas explícitas debe existir y ser suficiente; no lo inventa al vender.
  Sin líneas explícitas prepara un producto con saldo 2 y vende 1.
- `anular_venta_prueba(venta, usuario, *, motivo="Anulación de prueba",
  clave_operacion=None)`: prepara una anulación coherente para pruebas de lectura.
- `crear_dos_escenarios_ventas()`: devuelve dos `EscenarioVentas` con `contexto`,
  `membresia_compartida`, `producto`, `producto_fraccionario`, `producto_inactivo`,
  `venta` y `venta_anulada`. Comparte una cuenta con registrar en una empresa y
  listar/anular en otra; SKU iguales entre negocios, kg/litro, snapshots y stock
  conciliados. Las cuentas tienen contraseña inutilizable.

Estas fábricas no reemplazan los servicios ni verifican permisos comerciales. Existen
solo en `tests/support`, usan modelos/primitivas y no endpoints de compañeros.
Para probar autenticación real se prepara una contraseña ficticia expresamente
y se inicia sesión por API con CSRF. Nunca importar factories en vistas,
servicios de producción o comandos de operación del negocio.

## 8. Distribución y verificación

| Issue | Responsable | Entrega |
|---|---|---|
| [#80](https://github.com/romcode15/gestion-negocios/issues/80) | Romel | B1 base de esta guía |
| [#81](https://github.com/romcode15/gestion-negocios/issues/81) | Romel | B2 confirmación |
| [#88](https://github.com/romcode15/gestion-negocios/issues/88) | Romel | B3 integración backend |
| [#82](https://github.com/romcode15/gestion-negocios/issues/82) | Sebastián | B4 opciones |
| [#83](https://github.com/romcode15/gestion-negocios/issues/83) | Sebastián | B5 registro HTTP |
| [#84](https://github.com/romcode15/gestion-negocios/issues/84) | Sebastián | B6 listado/detalle |
| [#85](https://github.com/romcode15/gestion-negocios/issues/85) | Diego | B7 anulación |
| [#86](https://github.com/romcode15/gestion-negocios/issues/86) | Diego | B8 trazabilidad |
| [#87](https://github.com/romcode15/gestion-negocios/issues/87) | Diego | B9 concurrencia HTTP |

Las dependencias completas están en el [contrato común](../fase3.md#orden-de-trabajo-y-responsables).
B3 espera B6/B9 y no espera F3. El cierre frontend F3 sí espera B3.

Desde backend, con dependencias y PostgreSQL disponibles:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py
.\.venv\Scripts\python.exe manage.py spectacular --validate --fail-on-warn
node tools/verificar_swagger.mjs
```

Para una comprobación acotada de la base, pasar `ventas`,
`inventario.tests.test_operaciones` y `accesos.tests.test_migracion_fase3` como
etiquetas al verificador temporal. Antes de integrar, ejecutar la suite completa
y `--integracion-frontend` para las regresiones reales de fases 1/2.

Registrar casos, comandos y resultados en el PR hacia `dev`; cerrar después de
integrar y verificar. No aplicar migraciones de pruebas a la base habitual ni
editar migraciones ya publicadas. Instalación y upgrade: [README](README.md).

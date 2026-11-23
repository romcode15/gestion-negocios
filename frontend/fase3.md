# Fase 3 · Frontend — Ventas, carrito y anulación

Leer el [contrato común](../fase3.md), el issue y los contratos de
[componentes](COMPONENTES.md) y [transporte/API](API.md). Esta guía describe
trabajo pendiente: B1 prepara el backend base; F1–F9 implementan frontend.
El contrato está disponible antes de los endpoints y permite trabajo paralelo.

## 1. Rutas y responsabilidad

| Ruta exacta | Acceso | Composición |
|---|---|---|
| `/negocio/nueva-venta` | registrar_venta | NuevaVentaPage y VentaDraftProvider de Henry; componentes F4/F5/F6 de Diana. |
| `/negocio/ventas` | registrar_venta, listar_ventas o anular_venta | VentasPage de Kelvin: listado autorizado, detalle por selección/ID y anulación. |

Henry amplía una vez el registro de rutas y su unión de tipos existentes. No
añadir una dependencia de router ni rutas dinámicas por rutina. El detalle es
un panel y la anulación un único modal; no anidar diálogos. Mantener los
formularios y rutas de fases 1/2 en sus módulos actuales.

```text
src/features/ventas/
├── types.ts                         # Henry/F2; contrato común exacto
├── api.ts                           # Henry/F2; mismas funciones mock/HTTP
├── draft/                           # Henry/F1/F2; borrador por contexto
├── pages/
│   ├── NuevaVentaPage.tsx            # Henry compone, Diana completa sus piezas
│   └── VentasPage.tsx                # Kelvin desde F7
└── components/
    ├── shared/                      # Henry, solo controles realmente necesarios
    ├── nueva/
    │   ├── SelectorProductosVenta.tsx # Diana/F4
    │   ├── CarritoVenta.tsx           # Diana/F5
    │   └── ConfirmarVenta.tsx         # Diana/F6
    └── consulta/
        ├── ListaVentas.tsx           # Kelvin/F7
        ├── DetalleVentaPanel.tsx     # Kelvin/F8
        ├── MovimientosVenta.tsx      # Kelvin/F8
        └── AnularVentaModal.tsx      # Kelvin/F9
```

Henry define props/callbacks del borrador y composición en F1 antes de módulos.
Diana/Kelvin no cambian rutas, tipos, transporte, mocks o provider compartidos
para resolver una necesidad local; coordinan esa ampliación con Henry.

## 2. API y cantidades

F2 implementa `listarProductosVentaOpciones`, `obtenerProductoVenta`,
`registrarVenta`, `listarVentas`, `obtenerVenta`, `anularVenta` y
`listarMovimientosVenta` bajo `features/ventas/api.ts`. Reciben negocio e
inputs/ID/filtros y opciones con `signal`, usando cliente/contexto/query
existentes. No llamar `fetch` desde pantallas ni importar datos semilla.

Los tipos de creación son distintos de las respuestas. Inputs estrictos del
contrato: clave, observaciones opcionales y detalles con producto_id, cantidad
y precio_unitario_esperado; anular recibe clave/motivo. No enviar actor, tenant,
subtotal, total, estado ni auditoría. Mapear errores planos `detalles.N.campo`
al índice del snapshot enviado, aunque el carrito visible se haya reordenado.

Cantidades/precios/importes siguen siendo strings. F2 amplía helpers exactos
con BigInt escalado, HALF_UP una vez por línea y suma de subtotales. Validar
precisión/unidad/rango; no sumar con Number/float. El cálculo mostrado es
informativo: mostrar el resultado persistido de Django tras confirmar.

Opciones de venta tienen precio y disponible; son distintas de las opciones
de movimientos de fase 2. Registrar por sí solo permite consultarlas, sin
listar productos/categorías/existencias. Mostrar stock cero como tal. El
disponible no reserva stock ni garantiza una venta posterior.

## 3. Carrito y confirmación — Diana

- F4 busca productos por nombre/SKU en servidor y pagina conservando selección.
  Usa únicamente opciones de ventas; no filtra solo la página descargada.
- F5 mantiene una fila por producto; añadir repetido incrementa cantidad,
  quitar/vaciar son acciones claras. Cantidad positiva, unidad entera y máximo
  100 líneas distintas. Mostrar precio esperado, subtotal y total exactos.
- F6 revisa carrito/observaciones y confirma con clave por operación. Bloquea
  doble submit sincrónicamente y congela el payload enviado para reintento
  manual. Un éxito muestra ID/estado/total canónicos y limpia una sola vez.

Conservar carrito ante validación, red, saldo insuficiente y conflicto. Un 409
por precio requiere revisar opciones actuales y confirmar de nuevo con nueva
clave; no aceptar ni enviar un precio nuevo automáticamente. El precio esperado
no autoriza un descuento. Reintento idéntico incierto conserva clave/payload.
Si devuelve una venta ya anulada, mostrar ese estado sin afirmar otra venta.

El carrito es local al negocio y sesión. Limpiar al cambiar/salir y descartar
respuestas tardías, incluso si el transporte ignora AbortSignal. Un abort no
demuestra que Django haya revertido una operación confirmada.

## 4. Consulta y anulación — Kelvin

- F7 consulta el listado solo con listar_ventas; muestra ID, fecha, vendedor,
  estado y total. Filtros search/estado/desde/hasta/page del contrato, con zona
  y límite superior exclusivo. Conservar filtros al refrescar y recuperar una
  página válida si queda fuera de rango.
- F8 abre detalle desde selección o ID conocido. Sin listar_ventas, registrar
  o anular permiten detalle por ID sin lanzar un GET de listado prohibido.
  Mostrar snapshots históricos, observaciones, fecha y anulación auditada;
  la trazabilidad tiene su propia paginación y no exige listar_movimientos.
- F9 abre un FormModal solo con anular_venta y venta confirmada. Motivo 1–255,
  confirmación de devolución total, clave propia, busy y envío único. Tras
  éxito refresca detalle/vínculos/listado permitido con filtros conservados.

La anulación no se calcula ni aplica desde frontend. Conservar motivo ante
error, usar misma clave/payload en retry manual y nueva clave cuando cambie la
operación. Una venta ya anulada con otra clave produce 409: consultar su estado
mediante acción explícita, sin repetir ni devolver stock automáticamente.

## 5. Simulación e integración — Henry

F2 conecta ventas al mismo inventario y almacenamiento de identidad mock de
fase 2: no crear un segundo saldo. Semilla con dos negocios, homónimos/SKU
repetidos, unidades, ventas/anulaciones/vínculos coherentes y roles mínimos.
Copias de estado se publican juntas tras validar toda la operación; errores
no dejan saldos, líneas o vínculos parciales. La simulación no acredita
bloqueos PostgreSQL ni integración real.

Los tres nuevos permisos se agregan a administradores predefinidos del mock
cuando F2 lo implemente. Backend B1 ya prepara 19 permisos de negocio; los
roles personalizados/globales conservan los suyos. No asumir IDs o conteos
antiguos en pruebas: buscar códigos y usar las respuestas reales.

F3 espera F6/F9 y B3, comprueba el flujo completo con formularios y HTTP real
hacia PostgreSQL temporal. Se concilian ventas/total/snapshots/stock/versiones
y movimientos desde otra conexión. Probar faltantes en una línea, precio409,
CSRF, permisos mínimos separados, producto inactivo al anular, respuesta
perdida tras commit, reintento, doble submit y cambio rápido de contexto.

Registrar aparte revisión visual en navegador de carrito, panel y modal:
teclado/foco, etiquetas, scroll/fondo, errores, busy y móvil. jsdom no mide
layout. Conservar regresiones visuales y funcionales de fases 1/2.

## 6. Issues y verificación

| Responsable | Cadena |
|---|---|
| Henry | [F1 #89](https://github.com/romcode15/gestion-negocios/issues/89) → [F2 #90](https://github.com/romcode15/gestion-negocios/issues/90); [F3 #97](https://github.com/romcode15/gestion-negocios/issues/97) cierra tras F6/F9/B3. |
| Diana | [F4 #91](https://github.com/romcode15/gestion-negocios/issues/91) → [F5 #92](https://github.com/romcode15/gestion-negocios/issues/92) → [F6 #93](https://github.com/romcode15/gestion-negocios/issues/93), desde F2. |
| Kelvin | [F7 #94](https://github.com/romcode15/gestion-negocios/issues/94) → [F8 #95](https://github.com/romcode15/gestion-negocios/issues/95) → [F9 #96](https://github.com/romcode15/gestion-negocios/issues/96), desde F2. |

Cada issue verifica éxito, errores, acceso mínimo/denegado, tenant ajeno,
inactivos y contextos pendientes. Los módulos prueban su lógica además del
componente Modal; incluir verificadores en la suite común coordinando con Henry.

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

F3 amplía la ejecución desde backend:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py --integracion-frontend
```

Una rama por issue desde `dev`, PR hacia `dev`, revisión y cierre después de
integrar/verificar. El cierre backend B3 no espera F3. La fase completa exige
ambos; no introducir dependencias circulares ni cerrar por funcionar en mock.

# Fase 3 · Ventas e integración con inventario

Fuente acordada: [issue #80](https://github.com/romcode15/gestion-negocios/issues/80). B1 prepara modelos, permisos, serializers de salida, fixtures y composición vacía. B2 implementa el servicio interno de confirmación; la anulación corresponde a B7. **Las siete operaciones HTTP de ventas de esta guía siguen por implementar en B4–B8**; no se publican aún ni aparecen como endpoints disponibles en Swagger.

Este contrato común permite comenzar frontend sin esperar la implementación backend. Leer también las guías de [backend](backend/fase3.md) y [frontend](frontend/fase3.md) y el issue asignado. Una modificación posterior se coordina con Romel y Henry y actualiza contrato, tipos, simulación, OpenAPI y pruebas.

### Alcance
Ventas confirmadas de contado y anulación total por negocio. Flujo: productos → carrito → confirmar → salida de inventario → consulta → anular → entrada compensatoria. El stock de desarrollo es ficticio y persistido en PostgreSQL; la simulación permite desarrollar frontend en paralelo. El cierre exige HTTP real.

Esta entrega no incluye pagos o pasarelas, cambio/vuelto, clientes/identificación tributaria, impuestos, facturación fiscal, descuentos, crédito, devoluciones parciales, compras/proveedores ni apertura/cierre de caja. El precio de catálogo es el precio final aplicado en esta fase. Una venta confirmada no se edita ni borra; corregir mediante anulación completa y nueva venta. No hay borradores persistidos ni reservas de stock: el carrito es local al contexto.

### Datos y representaciones exactas
- `Venta`: negocio protegido; vendedor autenticado; `estado=confirmada|anulada`; observaciones opcionales, recortadas, máximo 500 y predeterminado `""`; total Decimal(14,2); UUID de registro y huella SHA-256 interna; fecha del servidor. UUID único por negocio. Total/detalles/actor/fecha de confirmación se conservan tras anular.
- `DetalleVenta`: venta, negocio y producto coherentes y protegidos; cantidad Decimal(14,3) positiva; precio unitario Decimal(12,2) no negativo; subtotal Decimal(14,2). Snapshot inmutable de `sku`, `nombre` y `unidad` aplicado al confirmar. Una fila por producto, única por venta/producto. Entre 1 y 100 productos distintos; rechazar repetidos, no consolidarlos silenciosamente en backend.
- `AnulacionVenta`: una por venta; negocio, usuario, motivo recortado de 1–255, UUID, huella interna y fecha de servidor; relaciones protegidas. UUID único por negocio dentro de anulaciones. Registro y anulación tienen espacios de claves separados; el mismo UUID en negocios distintos es válido.
- `VinculoMovimientoVenta`: negocio, detalle, `operacion=venta|anulacion`, movimiento protegido. Movimiento único en esta relación y combinación detalle/operación única. Cada detalle confirmado tiene una salida; tras anular tiene además una entrada. Mantener delta y auditoría del inventario existente.

```text
Usuario = { id, username, is_active }                       # fase 1
VentaProductoOpcion = { id, negocio_id, sku, nombre, unidad, precio_venta, disponible }
VentaResumen = { id, negocio_id, estado, total, vendedor: Usuario, creado_en }
DetalleVenta = { id, producto_id, sku, nombre, unidad, cantidad, precio_unitario, subtotal }
AnulacionVenta = { id, usuario: Usuario, motivo, clave_operacion, creado_en }
VentaDetalle = { ...VentaResumen, clave_operacion, observaciones,
                 detalles: DetalleVenta[], anulacion: AnulacionVenta|null }
MovimientoVenta = { detalle_id, operacion, movimiento: Movimiento }  # Movimiento de fase 2, intacto
```

IDs: enteros JSON positivos seguros para JavaScript; nunca booleanos ni cadenas en cuerpos. Cantidades, precios, subtotales, disponibles y totales: cadenas decimales; sin float, coma, exponente, NaN o redondeo silencioso de entradas. Cantidad hasta 3 decimales y entera para `unidad`; precio hasta 2. Respuestas normalizadas a 3 y 2 respectivamente. Validar límite de cada campo y de suma/saldo resultante. No cambiar escala de fase 2.

`subtotal = cantidad × precio_unitario`, redondeado UNA vez por línea a 2 decimales con `ROUND_HALF_UP`. `total = suma de subtotales ya redondeados`. Backend usa Decimal; mock/frontend enteros escalados/BigInt. Para valores no negativos: cantidad escalada 1000 × precio escalado 100; subtotal en centavos = `(producto + 500) // 1000`. El frontend muestra cálculo informativo; la persistencia usa siempre el cálculo Django. Permitir precio/total cero por compatibilidad con productos gratuitos. No aceptar precio elegido libremente, subtotal ni total del cliente.

### API
Prefijo común `/api/v1/negocios/{negocio_id}/`, barra final, sesión/CSRF, cuenta/membresía/negocio activos, tenant validado desde ruta. Tres permisos nuevos de negocio: `registrar_venta`, `listar_ventas`, `anular_venta`. Migración nueva para administradores predefinidos existentes y preparación idempotente de nuevos; conservar 16 permisos previos, roles personalizados y plataforma sin acceso implícito.

| Método/ruta relativa | Resultado | Permiso |
|---|---|---|
| GET `ventas/productos/opciones/` | 200 Pagina<VentaProductoOpcion> | registrar_venta |
| GET `ventas/productos/{producto_id}/` | 200 VentaProductoOpcion | registrar_venta |
| POST `ventas/` | 201 VentaDetalle | registrar_venta |
| GET `ventas/` | 200 Pagina<VentaResumen> | listar_ventas |
| GET `ventas/{venta_id}/` | 200 VentaDetalle | cualquiera de los tres |
| POST `ventas/{venta_id}/anulacion/` | 200 VentaDetalle con estado anulada | anular_venta |
| GET `ventas/{venta_id}/movimientos/` | 200 Pagina<MovimientoVenta> | cualquiera de los tres |

No hay PATCH/DELETE de ventas/detalles/anulaciones; 405 común. Las opciones no exigen listar_productos, consultar_existencias ni listar_ventas. Solo productos Y categorías activos; incluir disponibles cero, sin filtrar la búsqueda sobre la página descargada. El detalle de opción inactivo/ajeno/inexistente responde 404. El stock mostrado es informativo, no una reserva.

Registro:
```json
{"clave_operacion":"UUID","observaciones":"","detalles":[{"producto_id":12,"cantidad":"1.250","precio_unitario_esperado":"2.50"}]}
```
Anulación: `{"clave_operacion":"UUID","motivo":"Error de registro"}`. Cada línea exige precio esperado leído de las opciones, usado SOLO para detectar cambio de precio; Django captura el precio actual. Una diferencia devuelve 409 `conflict` y no confirma ni cobra un precio distinto silenciosamente. Tras revisar precios, la persona confirma de nuevo con nueva clave. No añadir una API de cotización en esta fase.

Todas las entradas son estrictas, también las líneas: rechazar campos desconocidos, cuerpos no objeto, listas vacías/más de 100 y nulos no permitidos. No aceptar tenant, vendedor, estado, stock, impuestos, auditoría ni relaciones completas. Errores `{code,detail,errors}` existentes. 400 `validation_error`; para errores por línea usar claves planas explícitas `detalles.0.producto_id`, `detalles.0.cantidad`, `detalles.0.precio_unitario_esperado` compatibles con `Record<string,string[]>`; no depender de que el manejador actual enumere listas anidadas. 403 not_authenticated/permission_denied/csrf_failed; 404 por recurso de otro negocio/no existente; 409 conflict con `errors:{}`. Una relación ajena del cuerpo devuelve 400 sin revelar el otro negocio. Fallos inesperados mantienen 500 y rollback.

Listas: envoltorio y tamaño 2 de fase 2; `page` entero positivo, inválida/fuera de rango 404; parámetros desconocidos/repetidos 400. Opciones: `search` recortado hasta 150 por nombre/SKU, orden id ascendente. Ventas: `search` hasta 150 sobre observaciones o snapshot nombre/SKU, `estado`, `desde`, `hasta`; sin filtros ambos estados, sin duplicar venta por joins. Fechas ISO 8601 con zona, desde inclusivo/hasta exclusivo, desde<hasta. Ventas orden `-creado_en,-id`; detalles orden id; vínculos orden movimiento `creado_en,id`, conservando salida antes de reversión. No introducir filtros/rutas alternativos por módulo. Consultas de vínculos admiten solo page.

### Transacciones, autorización e idempotencia
1. Registrar exige SOLO registrar_venta, anular SOLO anular_venta; jamás conceder permisos de movimientos manuales para hacer funcionar ventas. Resolver acceso actual antes y después de esperar bloqueos, con relectura de actividad y rol persistidos.
2. Venta completa: una transacción para encabezado, todas las líneas, saldos, versiones, salidas y vínculos. Bloquear todas las Existencias en producto_id ascendente y revalidar productos/precios/saldos bajo bloqueo. Coordinar con ediciones de producto y movimientos de fase 2. Cada línea aumenta versión en 1. Falta de stock en una sola línea/desbordamiento/fallo de guardado revierte TODO.
3. B1 extrae primitivas internas de bloqueo/aplicación de delta sin alterar las firmas públicas de fase 2; B2 confirma ventas y B7 anula en servicios separados. No llamar al endpoint manual de movimientos ni saltar permisos globalmente. Las primitivas son internas, se invocan únicamente dentro de servicios autorizados y transacciones; no se exponen como vistas.
4. Misma clave de registro, mismo actor y entrada normalizada (líneas ordenadas por producto, cantidades/precios normalizados, observaciones recortadas): misma venta, 201 y sin nueva escritura. Distinto actor/contenido: 409. Consultar repetición autorizada antes de validar precio/stock/estado de producto actual. Una repetición después de anular devuelve la misma venta con su estado/anulación actuales y detalles originales, sin crear otra salida. Resolver también carreras de clave entre carritos con productos distintos mediante restricción/savepoint; nunca 500 ni cambios parciales.
5. Anular bloquea primero Venta y luego todas sus Existencias en producto_id ascendente. Restaura cantidades originales con entradas nuevas y vínculos; total/detalles/salidas previas siguen intactos. Se permite restituir productos/categorías posteriormente inactivos; cuenta/membresía/negocio y permiso actuales siguen siendo obligatorios. Reversión fuera de rango revierte toda la anulación.
6. Misma clave de anulación, actor y motivo normalizado devuelve el resultado existente, 200; distinto contenido/actor o una nueva clave para una venta ya anulada: 409. Solo una anulación confirmada incluso con peticiones simultáneas. Claves de movimientos internos son UUID independientes, uno por detalle/operación, persistidos con vínculos; no reutilizar el UUID de la venta para todas las líneas.
7. Frontend conserva clave y payload congelado de un envío incierto para reintento MANUAL. Cambiar entrada crea operación y clave nuevas. Bloquear doble envío sincrónicamente. No reintentar POST automáticamente ni por CSRF. Tras un 409 no cambiar precios/saldo ni confirmar sin nueva revisión explícita. Un abort/cambio de negocio no demuestra rollback de una venta ya confirmada.

### Flujo frontend y propiedad
Rutas exactas del router existente: `/negocio/nueva-venta` (registrar_venta) y `/negocio/ventas` (cualquiera de los tres). Henry registra rutas/composición una vez, sin añadir dependencias de router por rutina. NuevaVentaPage compone SelectorProductosVenta (Diana/F4), CarritoVenta (Diana/F5) y ConfirmarVenta (Diana/F6) sobre VentaDraftProvider de Henry. Kelvin mantiene VentasPage, ListaVentas, DetalleVentaPanel y AnularVentaModal. El detalle es un panel, de modo que anular puede abrir un único modal sin anidar diálogos. Sin listar_ventas se ofrece detalle por ID conocido, sin GET de listado; después de registrar se muestra confirmación/ID aunque no se pueda listar.

Carrito local por negocio/sesión, una fila por producto; añadir de nuevo incrementa cantidad respetando unidad/rango; máximo 100. Limpiar al cambiar contexto/salir; no transportar un carrito al otro negocio. Conservarlo ante validación, falta de stock, red y conflicto. En éxito mostrar VentaDetalle canónica e identificar la venta, limpiar una sola vez al confirmar el éxito. Componentes de fase 2 reutilizados; foco, teclado, loading/busy/error/vacío/móvil, filtros conservados y descarte de respuestas tardías.

### Pruebas y entregas
Cada issue tiene sus propias pruebas. Fixtures compartidas crean dos negocios, productos homónimos/SKU iguales entre tenants, unidades distintas, roles mínimos y cuentas inactivas; no depender de llamar los endpoints de otro módulo para comenzar. B1 proporciona helpers estables con datos coherentes.

B3 verifica API completa y PostgreSQL concurrente, sin esperar F3. F3 espera B3 y módulos frontend, prueba formularios reales con PostgreSQL temporal y registra revisión visual por separado. No cerrar por funcionar solo en mock; no crear ciclo B3↔F3. Mantener regresiones completas de fases 1/2 y documentación Swagger real.

## Orden de trabajo y responsables

| Código/issue | Responsable | Entrega | Bloqueado por |
|---|---|---|---|
| [B1 · #80](https://github.com/romcode15/gestion-negocios/issues/80) | Romel | Base, modelos, permisos y primitivas | Fases 1/2 en dev |
| [B2 · #81](https://github.com/romcode15/gestion-negocios/issues/81) | Romel | Confirmación transaccional | B1 |
| [B3 · #88](https://github.com/romcode15/gestion-negocios/issues/88) | Romel | Integración backend | B6, B9 |
| [B4 · #82](https://github.com/romcode15/gestion-negocios/issues/82) | Sebastián | Opciones para vender | B1 |
| [B5 · #83](https://github.com/romcode15/gestion-negocios/issues/83) | Sebastián | API de registro | B4, B2 |
| [B6 · #84](https://github.com/romcode15/gestion-negocios/issues/84) | Sebastián | Listado/detalle | B5 |
| [B7 · #85](https://github.com/romcode15/gestion-negocios/issues/85) | Diego | Anulación transaccional y API | B2 |
| [B8 · #86](https://github.com/romcode15/gestion-negocios/issues/86) | Diego | Trazabilidad | B7 |
| [B9 · #87](https://github.com/romcode15/gestion-negocios/issues/87) | Diego | Concurrencia por API | B8, B5 |
| [F1 · #89](https://github.com/romcode15/gestion-negocios/issues/89) | Henry | Composición y componentes | Fases 1/2 en dev |
| [F2 · #90](https://github.com/romcode15/gestion-negocios/issues/90) | Henry | Tipos, API y mock | F1 |
| [F3 · #97](https://github.com/romcode15/gestion-negocios/issues/97) | Henry | Cierre HTTP y visual | F6, F9, B3 |
| [F4 · #91](https://github.com/romcode15/gestion-negocios/issues/91) | Diana | Selector de productos | F2 |
| [F5 · #92](https://github.com/romcode15/gestion-negocios/issues/92) | Diana | Carrito y cantidades | F4 |
| [F6 · #93](https://github.com/romcode15/gestion-negocios/issues/93) | Diana | Confirmación | F5 |
| [F7 · #94](https://github.com/romcode15/gestion-negocios/issues/94) | Kelvin | Listado de ventas | F2 |
| [F8 · #95](https://github.com/romcode15/gestion-negocios/issues/95) | Kelvin | Detalle y movimientos | F7 |
| [F9 · #96](https://github.com/romcode15/gestion-negocios/issues/96) | Kelvin | Modal de anulación | F8 |

## Trabajo con ramas y cierre

Seguir [guiagithub.md](guiagithub.md). Actualizar `dev`, crear una rama `tipo/NUMERO-descripcion`, implementar y verificar, hacer commits y abrir PR hacia `dev`. Comprobar las dependencias integradas, no solo issues cerrados. Cerrar la tarea tras integrar y verificar. B3 no espera F3; F3 sí espera B3. Una entrega a `main` requiere una decisión posterior de Romel.

Cada módulo incluye sus pruebas, éxito/validación/permiso mínimo y denegado/tenant ajeno/inactivos/CSRF, además de sus casos de dominio. No modificar contratos para simplificar una pantalla ni publicar credenciales.

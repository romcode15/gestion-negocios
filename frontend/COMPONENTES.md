# Componentes y estilos compartidos

## Composición de ventas · F1 de fase 3 (#89)

`NuevaVentaPage` compone `SelectorProductosVenta`, `CarritoVenta` y
`ConfirmarVenta` dentro de `VentaDraftProvider`, sin agregar otro router ni
modificar los formularios de fases 1/2. Las tres piezas son stubs informativos
que Diana completará en F4–F6; todavía no consultan, reservan ni confirman ventas.
`VentasPage` reserva la entrada de Kelvin/F7–F9. El detalle será un panel y
la anulación un único FormModal, sin diálogos o formularios anidados.

### Borrador compartido

Importar `VentaDraftProvider`, `useVentaDraft` y sus tipos desde
`features/ventas/draft`. El provider necesita el proveedor de sesión existente,
cuenta activa, negocio autorizado y `registrar_venta`. Es local al montaje de
la página: cambiar negocio, revisión de sesión, usuario o ruta descarta el
borrador. No usa localStorage, sessionStorage ni una API de borradores.

`draft` contiene `{ lineas, observaciones }`; cada línea contiene
`{ producto, cantidad, precio_unitario_esperado }`. El producto local conserva
ID/negocio/SKU/nombre/unidad/precio/disponible procedentes de una opción
autorizada. F2 definirá el tipo exacto `VentaProductoOpcion` y sus servicios.
Cantidades, precios y disponibles son cadenas, normalizadas con los helpers
de fase 2; las sumas de cantidades usan enteros escalados, sin float.

| Propiedad o acción | Contrato |
|---|---|
| `negocioId`, `draft`, `busy` | Contexto actual, copia del estado y bloqueo compartido |
| `agregar(producto, cantidad = '1')` | Una fila por ID; repetido suma cantidad; máximo 100 distintos |
| `cambiarCantidad(id, cantidad)` | Cantidad positiva, rango Decimal(14,3), entera para unidad |
| `revisarProducto(producto)` | Acción explícita para actualizar opción/precio esperado; no aceptar un precio nuevo al añadir repetido |
| `quitar(id)`, `vaciar()` | Cambios locales; vaciar también limpia observaciones |
| `cambiarObservaciones(texto)` | Texto editable hasta 500; el payload posterior lo recorta según contrato |
| `snapshot()` | Copia profunda independiente; no es un payload HTTP |
| `iniciarEnvio()` | Bloqueo síncrono y snapshot; rechaza carrito vacío y segundo envío |
| `terminarEnvio(false)` | Libera bloqueo conservando datos ante validación, red o conflicto |
| `terminarEnvio(true)` | Solo tras éxito canónico: limpia y libera una vez; una llamada duplicada sin envío es inocua |

Las acciones validan antes de publicar cambios. IDs ajenos, cantidades inválidas,
exceso de líneas o errores no dejan cambios parciales. Disponible cero sigue
siendo informativo: el borrador no reserva stock y Django valida saldo/precio.
Mientras `busy`, se rechaza editar/agregar/quitar/vaciar; la composición transmite
el bloqueo al selector, carrito y confirmación. Referencias/callbacks del contexto
anterior rechazan con AbortError incluso si la respuesta llegó tarde.

F6 mantiene el payload y UUID del envío incierto mediante los helpers de F2,
con bloqueo local síncrono además de `busy`. No reintenta POST desde efectos.
Al capturar errores debe conservar el snapshot enviado para mapear líneas;
un 409 exige revisión explícita, sin actualizar precio ni reenviar automáticamente.
Antes de aplicar resultados usar `store.enContexto` y cancelar al desmontar.
Abortar HTTP no demuestra rollback de un commit. Un éxito usa la respuesta
canónica de Django; el provider no inventa una VentaDetalle.

### Props y exportaciones de las piezas

Contratos importables en `features/ventas/components/shared/contracts.ts`:

| Pieza | Props/callbacks | Responsable |
|---|---|---|
| `SelectorProductosVenta` | `onAgregar`, `busy?` | Diana/F4 |
| `CarritoVenta` | `draft`, `onCambiarCantidad`, `onQuitar`, `onVaciar`, `busy?`, `error?`, `snapshotEnviado?` | Diana/F5 |
| `ConfirmarVenta` | `draft`, `busy`, `onCambiarObservaciones`, `onRevisarProducto`, `onIniciarEnvio`, `onTerminarEnvio` | Diana/F6 |
| `ListaVentasProps<Resumen>` | `seleccionadoId`, `refreshKey`, `onSeleccionar(venta)` | Kelvin/F7 |
| `DetalleVentaPanelProps<Detalle>` | `ventaId`, `refreshKey`, `onCargada(venta|null)`, `onSolicitarAnulacion(venta)` | Kelvin/F8 |
| `AnularVentaModalProps<Detalle>` | `venta`, `onClose`, `onAnulada(venta)` | Kelvin/F9 |

Los genéricos de consulta se concretan con `VentaResumen`/`VentaDetalle` de F2,
sin duplicar sus modelos. Kelvin mantiene selección y refrescos locales, solo
consulta el listado con `listar_ventas` y permite detalle por ID con cualquiera
de los tres permisos. Abrir anulación exige `anular_venta` y venta confirmada;
su formulario mantiene pending, cancelación, foco y errores mediante FormModal.

`erroresLineaVenta(errors, snapshotEnviado, productoId)` traduce
`detalles.N.campo` a errores de una fila según el orden enviado, aunque la vista
esté reordenada. Los errores generales `detalles` siguen en ApiFeedback.
Ejemplo: `erroresLineaVenta(error.errors, enviado, linea.producto.id).cantidad`.

Reutilizar TextField/SelectField y etiquetas visibles; enfocar el primer campo
inválido. Modal conserva foco/Tab/Shift+Tab, cierre Escape/fondo solo sin busy,
restauración de foco y scroll, y contenido desplazable en móvil. No contiene
lógica de venta, importes, endpoints o inventario. F1 no añade métodos a la API,
modifica OpenAPI ni desactiva CSRF: todavía no realiza escrituras.

### Verificación de la base

`verificar-ventas-base.mjs`, incluido en `npm.cmd test`, comprueba límites,
decimales/unidad, duplicados, conservación de precios, snapshots/errores por
línea, bloqueo síncrono, éxito/error, aislamiento por negocio/sesión, inactivos,
solicitud tardía, rutas con permisos mínimos/alternativos y ausencia de llamadas
HTTP de los placeholders. Un consumidor de prueba usa FormModal para verificar
foco, Tab/Escape/busy y desmontaje; no se presenta como confirmación funcional.
`verificar-modales.mjs` incluye los permisos nuevos y conserva las regresiones.
Las pruebas DOM no sustituyen revisión visual ni integración de ventas; F3 (#97)
validará HTTP/PostgreSQL y navegador tras los módulos correspondientes.

Resultados del 24/11/2026: `npm.cmd run test:ventas-base`,
`npm.cmd run test:modales`, `npm.cmd run lint`, `npm.cmd run build` y
`npm.cmd test`: correctos. La suite completa conserva regresiones de fases 1/2.
Se corrigió una espera fija en `verificar-flujos.mjs`: ahora espera el catálogo
de permisos paginado antes de comprobar sus nombres, sin retirar la validación.
No se ejecutó integración HTTP/PostgreSQL de ventas ni revisión visual nueva:
esta entrega es la base de composición, no los módulos F2/F4–F9.

Las pantallas de #14 y #15 usan los mismos componentes desde src/components/ui:

| Componente | Interfaz y uso |
| --- | --- |
| Button | Props nativas, pending y pendingLabel. type=button por defecto; guardar usa submit. |
| TextField | Props de input, label visible, hint y errors por campo. |
| SelectField | Props de select, label y errors. Genera IDs y vincula los mensajes. |
| Pagination | page, count, next, previous, pending, disabled, onPage y label. Solo emite números de página; no sigue enlaces. |
| DataTable<T> | rows, columns (key/header/render), rowKey y caption. Encabezados semánticos y región desplazable con teclado. |
| PaginatedTable<T> | Tabla, carga, vacío, error, reintento y paginación con presentación común. |
| Navbar | children y label accesible. Los enlaces/los permisos se componen en app/layouts/AppShell. |
| Footer | Pie de página común para paneles. |

Los mensajes generales siguen usando ApiFeedback y los estados Loading, EmptyState y AccessDenied. Los módulos no duplican fetch, transporte ni selección de modo.

src/index.css centraliza colores, bordes, radios, espaciado, campos, foco, controles deshabilitados, tablas, navegación y pie de página. Usar estas clases/componentes en siguientes módulos; evitar estilos inline de tablas o implementaciones propias de paginación.

Las páginas exportan contenido del módulo. AppShell aporta header, selector de negocio, navegación, main y footer; no anidar otro layout de panel dentro de una página ya montada por el router.

Contexto: useSesion y usePermiso están en app/providers/SessionContext. useConsultaContexto recibe una función estable con useCallback para lecturas. Las mutaciones se envuelven en store.enContexto y propagan signal a las funciones api.ts. El router remonta los módulos al cambiar revision para limpiar formularios/selecciones.

Pruebas: npm.cmd test. jsdom es una dependencia de desarrollo para ejecutar eventos reales del DOM; no sustituye la verificación visual en navegador.

Mantenimiento separado: npm audit informa 5 alertas altas en la cadena de desarrollo Vite/picomatch. La actualización compatible de picomatch no las resuelve; no se aplicó el downgrade mayor propuesto por npm. El informe no señala jsdom. Coordinar la actualización de herramientas fuera del contrato de #14/#15.

## Base de fase 2 — #49

Parte de `origin/dev` en `79dc82c`. La corrección #38 está integrada mediante el PR #39 (`a3f6eb6`); se incluyen las regresiones de esa base. Esta entrega no añade contratos API, tipos de catálogo, simulación de inventario ni formularios de dominio: corresponden a #50 y a los módulos posteriores.

### Modal

Import: `components/ui/Modal`.

| Prop | Tipo | Comportamiento |
| --- | --- | --- |
| open | boolean | Controlado; false desmonta el diálogo y limpia efectos. |
| title | string | Título visible y nombre accesible obligatorio. |
| description | string opcional | Descripción visible asociada mediante aria-describedby. |
| busy | boolean, false por defecto | Deshabilita cerrar por botón, Escape o fondo. |
| onClose | () => void | Solicita cierre; el consumidor actualiza open. |
| children | ReactNode | Contenido; el componente no conoce dominio ni endpoints. |
| initialFocusRef | RefObject<HTMLElement o null> opcional | Referencia estable al primer control; si no es válido, enfoca el primer control disponible o el diálogo. |

Portal en document.body, role=dialog y aria-modal. Atrapa Tab/Shift+Tab, redirige el foco externo y restaura el elemento que lo abrió si sigue montado. El fondo queda inert y se bloquea el scroll de body; atributos, estilos y listeners se restauran al cerrar o desmontar, incluso con busy. También se aíslan nodos de fondo agregados mientras está abierto.

Solo se admite un modal a la vez; no anidar modales ni montar dos abiertos simultáneamente. Los diálogos simultáneos generan un error explícito. Mantener estable initialFocusRef con useRef. El padre puede cerrar/desmontar por cambio de negocio/sesión aunque busy impida el cierre voluntario.

Modal.css limita la altura al viewport, permite desplazar el cuerpo y conserva cabecera y acciones. Los controles de acción se envuelven en móvil. El portal evita heredar el estilo de formularios de los paneles de fase 1.

### FormModal

Import: `components/ui/FormModal`. Hereda open/title/description/onClose/children/initialFocusRef de Modal. Sustituye busy por pending y añade:

- onSubmit: manejador de FormEvent<HTMLFormElement>.
- actionText: texto obligatorio del botón submit.
- pendingText: texto durante envío; predeterminado Guardando….
- cancelText: texto del botón type=button; predeterminado Cancelar.

Incluye exactamente un form con noValidate, fieldset deshabilitado durante pending, botón submit explícito y botón cancelar. Los children son controles/errores; **no incluir otro form**. No cierra ni limpia datos automáticamente al enviar: el módulo decide qué hacer tras validación, éxito o error. Pending impide el envío desde el componente, pero **el consumidor debe además usar un bloqueo síncrono (useRef) en su manejador**, porque dos eventos pueden llegar antes del siguiente render.

Ejemplo de composición genérica (sin endpoints ni datos de inventario):

```tsx
const [open, setOpen] = useState(false)
const [pending, setPending] = useState(false)
const [value, setValue] = useState('')
const [errors, setErrors] = useState<Record<string, string[]>>({})
const saving = useRef(false)
const firstField = useRef<HTMLInputElement>(null)

async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (saving.current) return
  if (!value.trim()) {
    setErrors({ nombre: ['Este campo es requerido.'] })
    firstField.current?.focus()
    return
  }
  saving.current = true
  setPending(true)
  try {
    // persistir es una función del consumidor, no de FormModal.
    // store.enContexto descarta respuestas anteriores y pasa AbortSignal.
    await store.enContexto(({ signal }) => persistir(value, signal))
    setOpen(false)
    setValue('')
    setErrors({})
    // Refrescar únicamente el listado que el actor puede consultar.
  } catch (error) {
    if (isAbortError(error)) return
    if (error instanceof ApiException) setErrors(error.errors)
    // Conservar value, mantener abierto y mostrar ApiFeedback para error general.
    // Tras renderizar errores de campo, enfocar el primer control inválido.
  } finally {
    saving.current = false
    setPending(false)
  }
}

<FormModal open={open} title="Formulario" description="Revisa los datos antes de guardar."
  pending={pending} actionText="Guardar" onSubmit={submit}
  onClose={() => setOpen(false)} initialFocusRef={firstField}>
  <TextField ref={firstField} name="nombre" label="Nombre" value={value}
    onChange={(event) => setValue(event.target.value)} errors={errors.nombre} />
</FormModal>
```

Usar los controles existentes TextField/SelectField y ApiFeedback, sin duplicarlos. Los errores por campo permanecen junto al control; un error no debe cerrar el modal. Un aborto HTTP no garantiza revertir una escritura ya confirmada en el servidor. Transacciones, decimales exactos y errores sin cambios parciales se verifican en #50 y en los módulos de dominio; #49 no hace escrituras.

### Rutas y ownership

Henry mantiene `app/routes/modules.ts`, `types.ts`, componentes, transportes y tipos/API compartidos. No exige permisos de listado para abrir páginas cuyo permiso alternativo sea solo crear/editar.

| Carpeta/página exportada | Ruta | Permisos alternativos | Responsable de página/componentes |
| --- | --- | --- | --- |
| features/categorias/pages → CategoriasPage | /negocio/categorias | listar_categorias, crear_categoria, editar_categoria | Diana |
| features/productos/pages → ProductosPage | /negocio/productos | listar_productos, crear_producto, editar_producto | Diana |
| features/existencias/pages → ExistenciasPage | /negocio/existencias | consultar_existencias | Diana |
| features/movimientos/pages → MovimientosPage | /negocio/movimientos | listar_movimientos, registrar_entrada, registrar_salida, ajustar_inventario | Kelvin |

Cada carpeta incluye components/ reservado. Las páginas actuales son stubs informativos, no consultan datos ni afirman que el módulo funcione. El catálogo de permisos de mocks no se amplía en #49: lo hace #50. Las pruebas de acceso usan sesiones de prueba con códigos del contrato, sin elevar permisos reales ni modificar la semilla. AppRoutes ya remonta el contenido por revisión de contexto; los módulos deben mantener el modal y su estado dentro de ese contenido.

### Verificación reproducible de #49

Desde frontend: `npm.cmd run test:modales`, `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`.

`verificar-modales.mjs` usa DOM en jsdom y comprueba portal/ARIA, foco inicial, Tab/Shift+Tab, Escape, fondo/clic interno, botón, busy, restauración de overflow/inert, limpieza de listeners, StrictMode, un solo formulario, cancelar/submit, validación visible, bloqueo síncrono del consumidor y desmontaje forzoso. Comprueba cada permiso alternativo, acceso denegado y datos/contexto de otro negocio, con descarte de respuestas viejas. No ejecuta escrituras ni prueba reglas de inventario ajenas al componente.

El caso de tamaño pequeño monta el formulario con viewport de prueba 320×568 y comprueba su DOM; **jsdom no mide el layout ni sustituye una revisión visual**. En la entrega #49 la revisión visual quedó pendiente y todavía no se declaraba integración con Django/PostgreSQL. Los resultados posteriores de integración y el cierre visual se registran al final de este documento.

Mantener todos los formularios de fase 1 en su ubicación actual. A petición del equipo, esta rama también incorpora los cambios visuales locales: login centrado, tema claro/oscuro, iconos, marco compartido y notificaciones. Se combinaron con la corrección #38 conservando el catálogo de roles asignables y las pruebas de permisos mínimos.

Resultados ejecutados en esta entrega: `npm.cmd run test:modales`, `npm.cmd test`, `npm.cmd run lint` y `npm.cmd run build`: correctos, código de salida 0. Lint sin advertencias. Las regresiones incluyen la corrección #38. No se ejecutaron pruebas visuales en navegador ni conexión con Django/PostgreSQL.


## Presentación común de módulos

`AppShell` organiza la barra lateral, cabecera de cuenta y contexto activo. En móvil la navegación pasa a la parte superior. Las operaciones, permisos y consultas permanecen en sus módulos.

- `PageHeading`: título y descripción uniformes.
- `StatusBadge`: estado activo/inactivo con texto y color.
- `ModuleIcon`: iconos de navegación SVG sin dependencias externas.
- `PaginatedTable`: cabecera, contador y presentación de tablas compartidos.

Los estilos de módulos están limitados a `.app-workspace` y `.workspace-content`; el inicio de sesión usa su propio layout. No se muestran métricas ni acciones que no existan en el contrato.

Los selectores de cuentas y roles reúnen automáticamente las páginas autorizadas de la API y muestran una sola lista de opciones. `Pagination` se presenta únicamente en tablas; no debe colocarse dentro de formularios ni repetirse en cada fila.

### Notificaciones toast

`ToastProvider` se monta una vez en `App`. Desde cualquier componente dentro del proveedor, importar `useToast` de `components/feedback/ToastContext` y llamar `notify({ type: 'success' | 'info' | 'warning' | 'error', title: 'Título', message: 'Detalle opcional' })`. El toast aparece arriba, admite cierre manual y desaparece tras 7 segundos; pausa el cierre al pasar el cursor o enfocar. `duration: 0` mantiene la notificación hasta cerrarla. Hay un máximo de cuatro avisos visibles y estilos para ambos temas.

La expiración de una sesión activa muestra un único toast de advertencia. Abrir la aplicación sin sesión es un estado normal y no genera esa notificación. Los errores de validación de campos continúan junto a sus controles.

## Verificación de integración F3 (#57)

El registro anterior de #49 corresponde a aquella entrega. En F3 se ejecutan
los componentes de los módulos ya integrados contra Django/PostgreSQL real,
sin trasladar lógica de dominio a Modal/FormModal ni migrar formularios de fase 1.

`verificar-integracion.mjs` conserva las regresiones de fase 1 y abre los modales
de categorías, productos, entradas, salidas y ajustes. Comprueba validación
visible con entradas conservadas, cierre tras éxito, busy, dos submit síncronos,
Escape bloqueado durante la espera y limpieza al desmontar por negocio/sesión.
El escenario tardío entrega una respuesta real del contexto anterior después
del cambio; no deben reaparecer sus opciones ni abrirse su modal.

El formulario sigue siendo responsable del bloqueo síncrono mediante ref,
además del estado `pending`. Las operaciones de inventario conservan su UUID
en un reintento manual idéntico; el modal no genera claves ni reenvía peticiones.
Las pruebas de persistencia verifican que un doble submit y una respuesta perdida
no produzcan movimientos duplicados. Abortar una solicitud no revierte una
escritura que Django ya confirmó.

Comprobación automatizada del 23/11/2026: `npm.cmd run lint`,
`npm.cmd run build`, `npm.cmd test` y el flujo HTTP real desde
`tools/verificar_postgres.py --integracion-frontend`, correctos.
Preparación y casos reproducibles: [API.md](API.md#f3--integración-http-real-57).

Revisión visual en navegador: **completada por Romel**, según su confirmación
del 23/11/2026 y el cierre del [issue #78](https://github.com/romcode15/gestion-negocios/issues/78).
Esta confirmación cierra el pendiente de teclado/foco, etiquetas, fondo/scroll,
errores, pending y móvil de #57. El registro corresponde a la revisión manual
del responsable; las pruebas DOM no acreditan el layout. Para repetirla con
datos temporales, usar `--revision-visual`, descrito en el [README](README.md).

## Conservación de filtros del catálogo (#78)

Guardar una categoría o producto actualiza su listado sin desmontarlo. Se
conservan búsqueda, estado, categoría y página válida; un registro que no cumple
el filtro no se fuerza dentro de la tabla. Si una edición deja fuera de rango
la página actual, se vuelve a la primera página con los mismos filtros.
Cambiar de negocio continúa desmontando el módulo y limpiando su estado.

`useConsultaContexto(cargar, refresco?)` admite un contador opcional para volver
a consultar sin reiniciar el estado del componente. Una respuesta anterior al
refresco no se presenta como actual; se mantienen cancelación y aislamiento.
Los consumidores existentes pueden seguir pasando únicamente `cargar`.

`npm.cmd run test:filtros-catalogo` verifica ambos módulos mediante formularios
React: edición en la segunda página, desactivación de su última fila, alta fuera
del filtro y limpieza al cambiar a otro negocio autorizado. Se incluye en
`npm.cmd test`.

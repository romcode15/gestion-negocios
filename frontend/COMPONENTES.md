# Componentes y estilos compartidos

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

El caso de tamaño pequeño monta el formulario con viewport de prueba 320×568 y comprueba su DOM; **jsdom no mide el layout ni sustituye una revisión visual**. Revisión visual en navegador a 320×568 y escritorio: pendiente. Revisar cuerpo desplazable, acciones visibles, foco/teclado, errores largos y zoom antes de aprobar el PR. No se declara integración con Django/PostgreSQL.

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

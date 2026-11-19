# Fase 2 · Frontend — Catálogo, inventario y modales

Guía de desarrollo de React/TypeScript. Leer el [contrato común](../fase2.md), [API de fase 1](API.md), [componentes existentes](COMPONENTES.md), esta guía y el issue. Los campos, rutas, filtros, permisos y reglas de saldo se fijan en el contrato común; frontend no define variantes.

## 1. Objetivo y reglas de interfaz

Crear páginas para categorías, productos, existencias y movimientos del negocio activo. Los listados y filtros permanecen en las páginas; los formularios de **creación y edición de catálogo, entradas, salidas y ajustes se presentan en modales reutilizables**.

Reutilizar la sesión, la selección de negocio, los tipos comunes, el cliente HTTP, los mensajes y las tablas de fase 1. Henry amplía los componentes necesarios; Diana y Kelvin desarrollan los componentes de sus módulos. No construir por adelantado controles que ninguna pantalla necesite ni reemplazar toda la base existente.

## 2. Estructura y responsabilidad

Estas rutas son la estructura que Henry prepara en F1/F2. Los módulos funcionales no deben modificar componentes, transportes, datos simulados ni rutas compartidas para resolver una necesidad local.

```text
src/
├── app/routes/                       # Registro y permisos de las páginas; Henry
├── api/                              # Transporte/contexto existentes; Henry
├── components/
│   ├── ui/Modal.tsx                  # Presentación y accesibilidad compartidas
│   ├── ui/FormModal.tsx              # Contenedor de formulario modal
│   ├── ui/                           # Button, TextField, SelectField, tablas existentes
│   └── feedback/                     # Carga, validación y errores; reutilizar
├── mocks/
│   ├── data/fase2.ts                 # Semilla de catálogo/inventario; Henry
│   └── services/fase2.ts             # Rutas/reglas simuladas; Henry
├── features/
│   ├── categorias/                   # Tipos/API: Henry; componentes/página: Diana
│   ├── productos/                    # Tipos/API: Henry; componentes/página: Diana
│   ├── existencias/                  # Tipos/API: Henry; componentes/página: Diana
│   └── movimientos/                  # Tipos/API: Henry; componentes/página: Kelvin
└── lib/decimales.ts                  # Validación/formato exactos compartidos; Henry
```

Cada módulo tiene `types.ts`, `api.ts`, `components/` y una exportación desde `pages/index.tsx`. Reutilizar `Pagina`, `Usuario`, `ApiException`, `useConsultaContexto` y `store.enContexto`. No copiar sus definiciones ni crear un segundo proveedor de sesión.

Henry registra una sola vez estas páginas de negocio:

| Ruta React | Exportación | Permisos alternativos para abrir |
|---|---|---|
| `/negocio/categorias` | `CategoriasPage` | listar_categorias, crear_categoria, editar_categoria |
| `/negocio/productos` | `ProductosPage` | listar_productos, crear_producto, editar_producto |
| `/negocio/existencias` | `ExistenciasPage` | consultar_existencias |
| `/negocio/movimientos` | `MovimientosPage` | listar_movimientos, registrar_entrada, registrar_salida, ajustar_inventario |

El acceso a una página no concede todas sus acciones. No consultar listados sin su permiso. Si alguien solo puede editar catálogo, ofrecer en esa página un control para abrir el registro por un ID conocido y cargar su detalle autorizado; no inventar un listado adicional. Si solo puede crear, mostrar el botón de creación sin exigir listado. Los usuarios normales con listar+editar seleccionan desde la tabla.

## 3. Distribución y dependencias

| Issue | Responsable | Entrega | Espera |
|---|---|---|---|
| [F1 · #49](https://github.com/romcode15/gestion-negocios/issues/49) | Henry (`HenryPaul11`) | Componentes, modales y composición compartida | Fase 1 en dev |
| [F2 · #50](https://github.com/romcode15/gestion-negocios/issues/50) | Henry (`HenryPaul11`) | Tipos, API tipada, opciones, decimales y simulación | F1 |
| [F3 · #57](https://github.com/romcode15/gestion-negocios/issues/57) | Henry (`HenryPaul11`) | Integración HTTP real y cierre frontend | F6, F9 y backend B3 |
| [F4 · #51](https://github.com/romcode15/gestion-negocios/issues/51) | Diana (`Diana1Illescas`) | Categorías: tabla, filtros y modales | F2 |
| [F5 · #52](https://github.com/romcode15/gestion-negocios/issues/52) | Diana (`Diana1Illescas`) | Productos: tabla, filtros y modales | F4 |
| [F6 · #53](https://github.com/romcode15/gestion-negocios/issues/53) | Diana (`Diana1Illescas`) | Existencias: consulta y filtros | F5 |
| [F7 · #54](https://github.com/romcode15/gestion-negocios/issues/54) | Kelvin (`KelvinQuezada`) | Entradas/salidas en modales | F2 |
| [F8 · #55](https://github.com/romcode15/gestion-negocios/issues/55) | Kelvin (`KelvinQuezada`) | Ajustes en modal | F7 |
| [F9 · #56](https://github.com/romcode15/gestion-negocios/issues/56) | Kelvin (`KelvinQuezada`) | Historial, filtros y paginación | F8 |

Diana y Kelvin avanzan con simulación desde F2, sin esperar los endpoints Django. Las entregas propias siguen su cadena para evitar ramas sobre bases todavía no integradas. El catálogo/stock de Diana y los movimientos de Kelvin tienen páginas separadas: no comparten `pages/index.tsx` ni se editan mutuamente sus formularios.

## 4. Contrato de los componentes compartidos — Henry

### Modal

Crear un componente controlado con `open`, `title`, `description?`, `busy?`, `onClose`, `children` e `initialFocusRef?`. No decide qué endpoint llamar ni conoce campos de catálogo/inventario.

- Montar en un portal y anunciar título/descripción mediante diálogo accesible y `aria-modal`.
- Al abrir, mover foco al control inicial; mantenerlo dentro del diálogo y devolverlo al botón que lo abrió al cerrar, si continúa montado.
- Cerrar con botón visible, Escape o fondo solo cuando `busy=false`; un clic dentro del contenido no cierra. Bloquear scroll de fondo y limpiar listeners/estilos al desmontar.
- Diseño adaptable a móvil; contenido con desplazamiento interno y controles visibles. No permitir modales anidados en esta fase.
- Un cambio de negocio o expiración de sesión desmonta el modal aunque estuviera ocupado. Cancelar solicitudes del contexto; no afirmar que abortar HTTP revierte una operación ya confirmada en el servidor.

### FormModal y controles

`FormModal` compone Modal con un único `<form>`, `onSubmit`, `onClose`, `pending`, texto de acción y espacio para errores/children. Usa botón submit explícito y cancelar tipo button. Los campos y reglas específicas permanecen en el módulo; no anidar formularios ni ejecutar escrituras desde efectos.

Reutilizar Button/TextField/SelectField/PaginatedTable/ApiFeedback. Ampliar sus props únicamente cuando exista un caso concreto. La validación muestra mensajes junto a campos, enfoca el primero inválido y conserva datos ante error. Guardar una sola vez por envío mediante bloqueo síncrono y estado pending; deshabilitar acciones mientras espera. Al éxito, cerrar, confirmar en la página y refrescar el listado permitido conservando filtros válidos.

No mover los formularios de fase 1 a modales en estos issues: el alcance nuevo es fase 2. Sus regresiones deben seguir pasando.

## 5. Tipos, API y simulación — Henry

Definir una vez los tipos del contrato común. Cantidades/precios son `string`; `version` es `number`; fecha es `string`; unidad/tipo son uniones cerradas. Separar tipos de creación/PATCH/respuesta y no enviar objetos anidados cuando se requiere un ID.

Funciones públicas mínimas:

| Módulo `api.ts` | Funciones |
|---|---|
| categorias | listarCategorias, obtenerCategoria, crearCategoria, actualizarCategoria, listarCategoriasOpciones |
| productos | listarProductos, obtenerProducto, crearProducto, actualizarProducto, listarProductosOpciones |
| existencias | listarExistencias, obtenerExistencia |
| movimientos | listarMovimientos, registrarMovimiento, registrarAjuste |

Las funciones reciben `negocioId`, input/ID/filtros según corresponda y opciones con `signal`; listados añaden `page`/filtros declarados. Reutilizar `request`, `contextoNegocio`, `rutaPagina` y ampliar la construcción de querystrings con `URLSearchParams`. No romper firmas de fase 1 ni concatenar filtros sin escapar. Las pantallas importan estas funciones, nunca fetch ni datos semilla.

Los selectores de producto/categoría acumulan todas las páginas o permiten paginar sin perder selección, limitan datos al negocio y respetan su búsqueda. Los formularios de producto usan categorías/opciones con crear/editar_producto; los de movimientos usan productos/opciones con el permiso de escritura. No exigir permisos de listados generales para cargar esas opciones.

La simulación contiene dos negocios, productos/unidades distintos, nombres/SKU repetidos entre negocios, estados inactivos, saldos e historial coherentes. Mantener el mismo almacenamiento de identidad ficticia de fase 1. Integrar el servicio de fase 2 con `mockTransport` y sus escenarios existentes, sin dos estados de inventario independientes.

Ampliar los códigos de negocio de la semilla conservando los anteriores y la restricción de delegación. No conceder nuevos permisos a roles limitados existentes. Actualizar pruebas con conteos antiguos de permisos; preferir encontrar IDs por código a asumir IDs fijos.

El mock aplica precisión/unidad, opciones por permiso, filtros, claves de operación, versiones, conflictos, saldo insuficiente y último administrador de fase 1. Una repetición idéntica devuelve el mismo movimiento; un fallo no deja saldo ni historial parcial. El conflicto es 409 con el mismo envoltorio. No simular éxito cuando Django debe rechazarlo.

Generar un UUID por nueva operación de inventario; conservarlo y conservar la entrada al reintentar manualmente tras fallo de red. Mantener separadas entradas nuevas y reintentos, y no repetir escrituras automáticamente. La capa común conserva CSRF/cookies/204 y añade presentación de conflicto sin alterar el formato del error.

## 6. Módulos de Diana

### Categorías — F4

Tabla con nombre, descripción y estado; búsqueda, filtro de activo, páginas y estados de carga/vacío/error. Botón Crear solo con crear_categoria, incluso sin listar. Modal con nombre y descripción; edición/desactivación solo con editar_categoria, usando detalle autorizado. Mostrar el error del servidor al intentar desactivar una categoría con productos activos. No eliminar físicamente.

### Productos — F5

Tabla con SKU, nombre, categoría, unidad, precio, mínimo y estado. Filtros según contrato; no hacer búsquedas únicamente sobre la página descargada. Modal con SKU, nombre, categoría, descripción, unidad, precio y mínimo; categorías desde opciones autorizadas. SKU se normaliza de forma consistente; el servidor vuelve a validar. La UI de edición respeta las reglas de unidad e inactivos y muestra el error si ya existe un movimiento. No ofrecer un campo de stock inicial ni cambiar saldo con PATCH.

Para filtrar categorías sin permiso para sus opciones/listado, utilizar los IDs/nombres ya recibidos o un ID conocido; no lanzar una consulta denegada. Esta misma regla se aplica al filtro de categoría de Existencias. No presentar ese subconjunto local como si fuera un catálogo completo.

### Existencias — F6

Tabla con producto/SKU, categoría, unidad, saldo, mínimo, indicador bajo mínimo y estado; filtros y paginación de servidor. Mostrar cero explícitamente. Etiquetar cantidades según unidad y conservar exactitud decimal. No incorporar botones que escriban stock ni editar los formularios de Kelvin. La consulta no exige listar_productos ni listar_categorias: recibe los resúmenes necesarios en Existencia.

## 7. Módulos de Kelvin

### Entradas y salidas — F7

En MovimientosPage, botones independientes para entrada y salida según sus permisos. Abrir FormModal con producto activo, cantidad positiva y motivo; el tipo lo fija la acción seleccionada. Opciones desde productos/opciones; mostrar unidad junto a cantidad. Enviar `registrarMovimiento`, con UUID por operación. No requiere consultar_existencias ni listar_movimientos para registrar. Mostrar error por saldo insuficiente en cantidad; la existencia se decide en Django.

### Ajustes — F8

Botón Ajustar con ajustar_inventario. Elegir producto desde opciones y cargar `obtenerExistencia` con ese mismo permiso. Mostrar saldo actual y unidad; capturar stock objetivo y motivo; enviar la versión leída y UUID. Diferenciar objetivo final de cantidad que se suma/resta. Un 409 mantiene el objetivo/motivo y ofrece actualizar saldo/versión para un nuevo envío explícito; nunca transforma el ajuste en una entrada/salida ni sobrescribe automáticamente.

### Historial — F9

Agregar a su misma MovimientosPage una tabla solo con listar_movimientos: fecha/hora, tipo, producto/SKU/unidad, delta con signo, saldo anterior/posterior, actor y motivo. Filtros producto/tipo/fechas/búsqueda y páginas del contrato. Con solo permiso de historial, el selector de producto usa los IDs/resúmenes que el usuario ya recibe y permite filtrar por un ID conocido; no consulta productos/opciones, que requiere escritura, ni inventa otro permiso. El filtro por nombre/SKU también permite localizar historial sin ese catálogo.

Los movimientos de inactivos siguen visibles. No editar/borrar filas. Después de una escritura, refrescar el historial si tiene permiso; si no, mostrar la confirmación sin lanzar consultas denegadas.

## 8. Reglas y comprobación

| Tema | Regla |
|---|---|
| Negocio activo | Tomar ID de sesión; limpiar modales, filtros dependientes, selección y datos al cambiar. Descartar respuestas tardías. |
| Estado | Formularios locales; sesión/contexto compartidos. Guardar desde submit, no desde efectos. |
| Permisos | Cada acción consulta su permiso. Ocultar un botón no sustituye autorización del backend. |
| Errores | Reutilizar ApiFeedback y errores de campo. Conservar datos; no cerrar modal por un error. |
| Decimales | Cadenas exactas y helper central; sin sumas/restas con float ni redondeo silencioso. |
| Reutilización | Base UI de Henry, dominio de cada responsable; cambios compartidos coordinados. |
| HTTP | Modo central mock/http; sesión+CSRF; no retries automáticos de mutaciones. |
| Contrato | No añadir campos a respuestas ni convertir resúmenes en modelos completos. |

Cada issue incluye pruebas: permiso mínimo y ausente, éxito/error en modal, foco y teclado, doble envío, carga/vacío, filtros/páginas, cambio de negocio con modal abierto y solicitud pendiente. F1 verifica el componente modal; F2 verifica contratos/reglas del mock; los módulos prueban sus formularios y tablas, sin limitarse a comprobar que un componente se renderiza.

Desde frontend:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

F3 amplía `verificar-integracion.mjs` y la ejecución existente desde backend:

```powershell
.\.venv\Scripts\python.exe tools/verificar_postgres.py --integracion-frontend
```

Debe usar formularios React contra HTTP real, no sustituir fetch con respuestas inventadas. Probar categorías, productos, saldo inicial cero, entrada, salida, ajuste/versiones, reintento sin duplicado, historial, permisos mínimos, dos negocios, recarga y logout. Las pruebas DOM no sustituyen la revisión visual: registrar por separado modales en navegador, foco/teclado, errores y tamaño móvil.

No considerar cerrada la integración porque funcione en mock. Registrar datos de preparación, pasos/resultados y comandos reales en el PR hacia `dev`, sin credenciales. Henry revisa frontend; la entrega a `main` requiere una decisión posterior de Romel.

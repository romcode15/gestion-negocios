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

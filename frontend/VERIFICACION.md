# Verificación de la base frontend

## Alcance

Base visual y de tipos. No usa mocks ni hace solicitudes a Django. No se ha verificado integración con Django/PostgreSQL. No hay autenticación ni autorización real.

## Comprobaciones reproducibles

Desde frontend:

1. `npm.cmd ci`
2. `npm.cmd run lint`
3. `npm.cmd run build`
4. `npm.cmd run dev`: abrir `/`, `/plataforma`, `/negocio/roles` y `/negocio/membresias`. Cada entrada debe indicar que está pendiente. Una ruta desconocida muestra página no disponible.
5. Revisar a 320px y 1280px; las tarjetas se ajustan y el texto permanece legible. Tab enfoca el enlace Saltar al contenido y muestra el foco.

## Componentes compartidos

Para revisar componentes aislados, componer temporalmente una página local con los imports de ESTRUCTURA.md y retirar la composición al finalizar:

- Normal: TextField con label y Button. Pulsar la etiqueta enfoca el input; Tab/Shift+Tab recorren controles y Enter/Espacio activan el botón.
- Carga: Loading y Button pending. Se muestra Guardando…, aria-busy es true y el botón está deshabilitado.
- Validación: TextField errors={['Campo requerido.']}. Mensaje vinculado mediante aria-describedby y aria-invalid=true. El formulario que lo integre será responsable del foco al fallar el envío.
- Vacío: EmptyState sin datos. Debe mostrar No hay resultados.
- Error general: ErrorMessage con un mensaje legible y role=alert.
- Falta de acceso: AccessDenied muestra el mensaje de permiso. No constituye una comprobación de permisos contra servidor.
- Éxito de una operación: pendiente del issue que implemente el formulario y su API; esta base no simula guardados.

Los pasos manuales son una guía; no deben presentarse como ejecutados hasta probarlos en navegador.

## PR hacia dev

Vincular el número real del issue, adjuntar resultados de lint/build y los escenarios manuales efectivamente ejecutados. Solicitar revisión a Romel para la base. Tras integrar a dev comprobar el cierre manual del issue y actualizar el tablero. No declarar cerrada la tarea por disponer de código local.

## Resultados ejecutados

- `npm.cmd ci`: correcto, 28 paquetes instalados, 0 vulnerabilidades informadas.
- `npm.cmd run lint`: correcto, código de salida 0.
- `npm.cmd run build`: correcto, TypeScript y Vite compilan (24 módulos).
- `node verificar-componentes.mjs`: correcto. Comprueba render SSR de botón normal/pending, asociación etiqueta/campo/errores, carga, vacío, error y falta de acceso. No prueba eventos de teclado ni apariencia visual.
- Revisión manual de navegador y Django/PostgreSQL: pendientes.

## Capa de datos intercambiable

Guía de firmas, configuración y escenarios en [API.md](API.md).

Comprobaciones ejecutadas para esta issue:

- `npm.cmd run test:api`: correcto. Servicios simulados y cliente HTTP con fetch sustituido; incluye selección de modo, rutas y payloads de cada módulo.
- `npm.cmd run lint`: correcto.
- `npm.cmd run build`: correcto.

No se implementaron pantallas en esta issue. No se comprobó integración contra Django/PostgreSQL. La revisión e integración de #11 en dev siguen siendo una dependencia del PR, cuyo desarrollo continúa por autorización del equipo.

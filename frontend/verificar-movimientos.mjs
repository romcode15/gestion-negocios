import assert from 'node:assert/strict'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' })
const originals = new Map()
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
  'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle',
  'sessionStorage', 'localStorage']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name],
  })
}
originals.set('requestAnimationFrame', Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'))
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => setTimeout(fn, 0) })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const root = createRoot(document.getElementById('root'))
const h = React.createElement
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { await pause(10) }) }
async function render(component) { await act(async () => root.render(component)) }
async function click(element) { assert.ok(element); await act(async () => element.click()); await flush() }
async function change(element, value) {
  assert.ok(element)
  const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  await flush()
}
async function submit(twice = false) {
  const form = document.querySelector('[role="dialog"] form')
  assert.ok(form, 'No hay formulario en el diálogo.')
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    if (twice) form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
}
async function key(value, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
  await act(async () => document.activeElement.dispatchEvent(event))
}
function boton(etiqueta, exigir = true) {
  const encontrado = [...document.querySelectorAll('button')]
    .find((item) => item.textContent.trim() === etiqueta || item.getAttribute('aria-label') === etiqueta)
  if (exigir) assert.ok(encontrado, 'No existe el botón ' + etiqueta)
  return encontrado ?? null
}
function campo(name) {
  const elemento = document.querySelector('[role="dialog"] [name="' + name + '"]')
  assert.ok(elemento, 'No existe el campo ' + name)
  return elemento
}
function dialogo() { return document.querySelector('[role="dialog"]') }
function titulo(dialog) { return document.getElementById(dialog.getAttribute('aria-labelledby')).textContent }

let mock
let originalTransportRequest
let EVENTO_HISTORIAL_ACTUALIZADO
let peticiones = []
let manipulador = null
let listener = null
let notificaciones = []
let eventosHistorial = []

try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  mock = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const productos = await load('features/productos/api.ts')
  const existencias = await load('features/existencias/api.ts')
  const movimientos = await load('features/movimientos/api.ts')
  const { ApiException } = await load('api/errors.ts')
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { ToastContext } = await load('components/feedback/ToastContext.ts')
  const { MovimientosPage } = await load('features/movimientos/pages/index.tsx')
  const moduloEventos = await load('features/movimientos/components/eventos.ts')
  EVENTO_HISTORIAL_ACTUALIZADO = moduloEventos.EVENTO_HISTORIAL_ACTUALIZADO

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  originalTransportRequest = mock.mockTransport.request

  function posts() {
    return peticiones.filter((item) => item.method === 'POST' && item.path.endsWith('/movimientos/'))
  }
  async function abrir(etiqueta) {
    await click(boton(etiqueta))
    const dialog = dialogo()
    assert.ok(dialog, 'El botón no abrió el modal.')
    assert.equal(document.activeElement.id, 'producto_id', 'El foco inicial debe estar en el producto.')
    return dialog
  }
  async function preparar({ permisos, negocio = 1, username = 'admin_tienda', productosExtra = 0, negocioAdicional = null } = {}) {
    if (listener) window.removeEventListener(EVENTO_HISTORIAL_ACTUALIZADO, listener)
    mock.reiniciarMocks()
    mock.configurarMocks({ latencia: 0 })
    await auth.iniciarSesion({ username, password: 'Demo-12345!' })
    if (productosExtra) {
      for (let index = 0; index < productosExtra; index++) {
        await productos.crearProducto(negocio, {
          categoria_id: negocio === 1 ? 1 : 3,
          sku: 'EXTRA-' + index,
          nombre: 'Producto extra ' + index,
          unidad: index % 2 ? 'kg' : 'litro',
          precio_venta: '1',
        })
      }
    }
    const base = await auth.obtenerSesion()
    const session = {
      ...base,
      negocios: base.negocios.map((item) => item.id === negocio ? { ...item, permisos: permisos ?? item.permisos } : item),
    }
    if (negocioAdicional !== null && !session.negocios.some((item) => item.id === negocioAdicional)) {
      session.negocios.push({ id: negocioAdicional, nombre: 'Negocio adicional', rol_id: 2, permisos: [] })
    }
    const store = crearSessionStore({
      obtenerSesion: async () => session,
      iniciarSesion: async () => session,
      cerrarSesion: async () => {},
    })
    await store.restaurar()
    if (store.getSnapshot().negocioId !== negocio) store.cambiarNegocio(negocio)
    peticiones = []
    manipulador = null
    notificaciones = []
    eventosHistorial = []
    listener = (event) => eventosHistorial.push(event.detail)
    window.addEventListener(EVENTO_HISTORIAL_ACTUALIZADO, listener)
    mock.mockTransport.request = async (request) => {
      peticiones.push({ method: request.method, path: request.path, body: request.body })
      return manipulador ? manipulador(request, originalTransportRequest) : originalTransportRequest(request)
    }
    function Proveedor() {
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      return h(ToastContext.Provider, { value: { notify: (notice) => notificaciones.push(notice) } },
        h(SessionContext.Provider, { value: { ...state, store } }, h(MovimientosPage, { key: state.revision })))
    }
    await render(h(Proveedor))
    return store
  }

  // 1. Permiso mínimo de entrada, opciones paginadas, foco, decimales y éxito.
  await preparar({ permisos: ['registrar_entrada'], productosExtra: 2 })
  assert.ok(boton('Entrada'))
  assert.equal(boton('Salida', false), null)
  assert.equal(peticiones.some((item) => item.path.includes('/movimientos/') || item.path.includes('/existencias/')), false)
  let dialog = await abrir('Entrada')
  assert.equal(titulo(dialog), 'Registrar entrada')
  assert.ok(peticiones.some((item) => item.path.includes('/productos/opciones/?page=1')))
  assert.ok(peticiones.some((item) => item.path.includes('/productos/opciones/?page=2')))
  assert.equal(campo('producto_id').options.length, 5, 'Se acumularon las dos páginas de opciones activas.')
  await key('Tab', true)
  assert.equal(dialog.contains(document.activeElement), true)
  await submit()
  assert.match(dialog.textContent, /Selecciona un producto activo del negocio activo/)
  assert.match(dialog.textContent, /La cantidad es requerida/)
  assert.match(dialog.textContent, /El motivo es requerido/)
  assert.equal(document.activeElement.id, 'producto_id')
  assert.equal(posts().length, 0)
  await change(campo('producto_id'), '1')
  await change(campo('cantidad'), '1.5')
  await change(campo('motivo'), 'Recepción')
  await submit()
  assert.match(dialog.textContent, /requiere cantidades enteras/)
  await change(campo('producto_id'), '2')
  await change(campo('cantidad'), '1.0001')
  await submit()
  assert.match(dialog.textContent, /precisión decimal/)
  await change(campo('cantidad'), '1.250')
  await submit(true)
  assert.equal(posts().length, 1, 'El bloqueo síncrono evita el doble envío.')
  const entrada = posts()[0].body
  assert.deepEqual(Object.keys(entrada).sort(), ['cantidad', 'clave_operacion', 'motivo', 'producto_id', 'tipo'])
  assert.equal(entrada.producto_id, 2)
  assert.equal(entrada.tipo, 'entrada')
  assert.equal(entrada.cantidad, '1.250')
  assert.equal(entrada.motivo, 'Recepción')
  assert.match(entrada.clave_operacion, UUID)
  assert.equal(dialogo(), null)
  assert.match(document.body.textContent, /Entrada registrada correctamente/)
  assert.equal(notificaciones.length, 1)
  assert.equal(notificaciones[0].title, 'Movimiento registrado')
  assert.equal(eventosHistorial.length, 0, 'Sin listar_movimientos no se notifica refresco.')
  assert.equal((await existencias.obtenerExistencia(1, 2)).cantidad, '1.250')
  console.log('OK F7 entrada mínima: opciones paginadas, foco/teclado, validación, precisión, doble envío y éxito.')

  // 2. Permiso mínimo de salida, saldo insuficiente sin cambios parciales.
  await preparar({ permisos: ['registrar_salida'] })
  assert.equal(boton('Entrada', false), null)
  assert.ok(boton('Salida'))
  dialog = await abrir('Salida')
  assert.equal(titulo(dialog), 'Registrar salida')
  await change(campo('producto_id'), '1')
  await change(campo('cantidad'), '9')
  await change(campo('motivo'), 'Entrega')
  const saldoAntes = await existencias.obtenerExistencia(1, 1)
  const historialAntes = await movimientos.listarMovimientos(1)
  await submit()
  assert.match(dialog.textContent, /Saldo insuficiente/)
  assert.equal(campo('cantidad').getAttribute('aria-invalid'), 'true')
  assert.ok(dialogo(), 'Un error no cierra el modal.')
  assert.equal(campo('cantidad').value, '9')
  assert.equal(campo('motivo').value, 'Entrega')
  assert.equal(boton('Reintentar', false), null, 'Un error de validación no ofrece reenvío ciego.')
  assert.equal((await existencias.obtenerExistencia(1, 1)).cantidad, saldoAntes.cantidad)
  assert.equal((await movimientos.listarMovimientos(1)).count, historialAntes.count)
  await change(campo('cantidad'), '2')
  await submit()
  assert.equal(posts().length, 2)
  assert.equal(posts()[1].body.tipo, 'salida')
  assert.equal(posts()[1].body.cantidad, '2.000')
  assert.equal((await existencias.obtenerExistencia(1, 1)).cantidad, '3.000')
  assert.equal((await movimientos.listarMovimientos(1, { producto_id: 1 })).results[0].cantidad, '-2.000')
  console.log('OK F7 salida mínima: saldo insuficiente conserva datos y no muta; la salida válida descuenta por la API.')

  // 3. Ausencia de permisos: no hay botones ni consultas de opciones.
  await preparar({ permisos: [] })
  assert.equal(boton('Entrada', false), null)
  assert.equal(boton('Salida', false), null)
  assert.match(document.body.textContent, /No tienes permiso para registrar entradas ni salidas/)
  assert.equal(peticiones.some((item) => item.path.includes('/productos/opciones/')), false)
  assert.equal(posts().length, 0)
  console.log('OK F7 sin permisos: no se muestran acciones ni se consultan opciones.')

  // 4. Contexto de otro negocio: un producto ajeno inyectado en el DOM es rechazado.
  await preparar({ permisos: ['registrar_entrada'], negocio: 2, username: 'admin_ferreteria' })
  dialog = await abrir('Entrada')
  const selector = campo('producto_id')
  assert.ok(![...selector.options].some((option) => option.value === '1'))
  const ajena = document.createElement('option')
  ajena.value = '1'
  ajena.textContent = 'Artículo del otro negocio'
  selector.appendChild(ajena)
  await change(selector, '1')
  await change(campo('cantidad'), '1')
  await change(campo('motivo'), 'Intento ajeno')
  await submit()
  assert.match(dialog.textContent, /producto activo del negocio activo/)
  assert.equal(posts().length, 0)
  selector.removeChild(ajena)
  await change(selector, '4')
  await submit()
  assert.equal(posts()[0].body.producto_id, 4)
  assert.equal((await existencias.obtenerExistencia(2, 4)).cantidad, '4.500')
  console.log('OK F7 tenant: opciones del negocio activo y rechazo de producto ajeno sin escritura.')

  // 5. Respuesta incierta: sin reenvío automático; el reintento conserva clave y datos.
  await preparar({ permisos: ['registrar_entrada'] })
  let primeraIncierta = true
  manipulador = async (request, original) => {
    if (request.method === 'POST' && primeraIncierta) {
      primeraIncierta = false
      await original(request)
      throw new ApiException('network_error', 'No se pudo confirmar la respuesta.', {}, 0)
    }
    return original(request)
  }
  dialog = await abrir('Entrada')
  await change(campo('producto_id'), '1')
  await change(campo('cantidad'), '1')
  await change(campo('motivo'), 'Recepción incierta')
  const versionInicial = (await existencias.obtenerExistencia(1, 1)).version
  const movimientosIniciales = (await movimientos.listarMovimientos(1)).count
  await submit()
  assert.match(dialog.textContent, /No se pudo conectar/)
  assert.equal(posts().length, 1, 'No hubo reenvío automático.')
  assert.equal(campo('cantidad').value, '1')
  assert.equal(campo('motivo').value, 'Recepción incierta')
  const primera = posts()[0].body
  await click(boton('Reintentar'))
  assert.equal(posts().length, 2)
  assert.deepEqual(posts()[1].body, primera, 'El reintento conserva UUID y payload.')
  assert.equal((await existencias.obtenerExistencia(1, 1)).version, versionInicial + 1)
  assert.equal((await movimientos.listarMovimientos(1)).count, movimientosIniciales + 1)
  console.log('OK F7 reintento manual: una sola operación, misma clave y sin duplicado.')

  // 6. Conflicto: mensaje visible, datos conservados y reenvío manual explícito.
  await preparar({ permisos: ['registrar_entrada'] })
  dialog = await abrir('Entrada')
  await change(campo('producto_id'), '1')
  await change(campo('cantidad'), '1')
  await change(campo('motivo'), 'Conflicto de prueba')
  const saldoConflicto = (await existencias.obtenerExistencia(1, 1)).cantidad
  mock.configurarMocks({ escenario: 'conflict' })
  await submit()
  assert.match(dialog.textContent, /conflict/i)
  assert.match(dialog.textContent, /conservan/)
  assert.ok(dialogo())
  assert.equal(campo('motivo').value, 'Conflicto de prueba')
  assert.ok(boton('Reintentar'))
  assert.equal(posts().length, 1)
  assert.equal((await existencias.obtenerExistencia(1, 1)).cantidad, saldoConflicto)
  console.log('OK F7 conflicto: error visible, modal abierto y sin cambios parciales.')

  // 7. Cambiar la entrada crea otra operación con otra clave.
  await preparar({ permisos: ['registrar_entrada'] })
  manipulador = async (request, original) => {
    if (request.method === 'POST') {
      await original(request)
      throw new ApiException('network_error', 'Sin confirmación.', {}, 0)
    }
    return original(request)
  }
  dialog = await abrir('Entrada')
  await change(campo('producto_id'), '1')
  await change(campo('cantidad'), '1')
  await change(campo('motivo'), 'Primera')
  await submit()
  const clavePrimera = posts()[0].body.clave_operacion
  await change(campo('motivo'), 'Segunda')
  manipulador = null
  await submit()
  assert.equal(posts().length, 2)
  assert.notEqual(posts()[1].body.clave_operacion, clavePrimera)
  assert.equal(posts()[1].body.motivo, 'Segunda')
  console.log('OK F7 clave por operación: editar datos cambia el UUID; el reintento no lo cambia.')

  // 8. Cambio de negocio con solicitud pendiente cancela y desmonta el modal.
  const storeCompartido = await preparar({ permisos: ['registrar_entrada'], negocioAdicional: 2 })
  let senalPendiente = null
  let abortada = false
  manipulador = (request, original) => {
    if (request.method !== 'POST' || !request.path.endsWith('/movimientos/')) return original(request)
    return new Promise((resolve, reject) => {
      senalPendiente = request.signal
      request.signal?.addEventListener('abort', () => {
        abortada = true
        reject(new DOMException('Cancelado', 'AbortError'))
      }, { once: true })
    })
  }
  dialog = await abrir('Entrada')
  await change(campo('producto_id'), '1')
  await change(campo('cantidad'), '1')
  await change(campo('motivo'), 'Solicitud pendiente')
  const formularioPendiente = document.querySelector('[role="dialog"] form')
  assert.ok(formularioPendiente, 'No hay formulario en el diálogo.')
  await act(async () => {
    formularioPendiente.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await pause(10)
  })
  assert.ok(senalPendiente && !senalPendiente.aborted, 'La petición quedó pendiente.')
  assert.ok(dialogo(), 'La solicitud pendiente mantiene el modal abierto.')
  await act(async () => storeCompartido.cambiarNegocio(2))
  await act(async () => { await pause(10) })
  assert.equal(senalPendiente.aborted, true, 'El cambio de negocio canceló la señal de la petición.')
  assert.equal(abortada, true, 'La petición pendiente recibió la cancelación.')
  assert.equal(dialogo(), null)
  assert.equal((await existencias.obtenerExistencia(1, 1)).cantidad, '5.000', 'Una solicitud cancelada no escribe.')
  console.log('OK F7 contexto: cambio de negocio desmonta el modal y cancela la solicitud pendiente.')

  // 9. Con listar_movimientos se notifica el refresco del historial de F9.
  await preparar({ permisos: ['registrar_entrada', 'listar_movimientos'] })
  dialog = await abrir('Entrada')
  await change(campo('producto_id'), '1')
  await change(campo('cantidad'), '2')
  await change(campo('motivo'), 'Reposición')
  await submit()
  assert.equal(eventosHistorial.length, 1)
  assert.deepEqual(eventosHistorial[0], { negocioId: 1 })
  assert.equal(dialogo(), null)
  console.log('OK F7 historial: la confirmación notifica el refresco solo cuando el actor puede listar.')

  await render(null)
} finally {
  await act(async () => root.unmount())
  await server.close()
  if (originalTransportRequest) mock.mockTransport.request = originalTransportRequest
  if (listener) window.removeEventListener(EVENTO_HISTORIAL_ACTUALIZADO, listener)
  dom.window.close()
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
}

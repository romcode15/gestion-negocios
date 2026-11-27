import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
    return peticiones.filter((item) => item.method === 'POST' && item.path.endsWith('/ajustes/'))
  }
  function saldos() {
    return peticiones.filter((item) => item.method === 'GET' && /\/existencias\/\d+\/$/.test(item.path))
  }
  async function abrir() {
    await click(boton('Ajustar'))
    const dialog = dialogo()
    assert.ok(dialog, 'El botón no abrió el modal.')
    assert.equal(titulo(dialog), 'Ajustar inventario')
    assert.equal(document.activeElement.id, 'producto_id', 'El foco inicial debe estar en el producto.')
    return dialog
  }
  async function preparar({ permisos, negocio = 1, username = 'admin_tienda', productosExtra = 0, negocioAdicional = null } = {}) {
    if (listener) window.removeEventListener(EVENTO_HISTORIAL_ACTUALIZADO, listener)
    mock.reiniciarMocks()
    mock.configurarMocks({ latencia: 0 })
    await auth.iniciarSesion({ username, password: 'Demo-12345!' })
    for (let index = 0; index < productosExtra; index++) {
      await productos.crearProducto(negocio, {
        categoria_id: negocio === 1 ? 1 : 3,
        sku: 'EXTRA-' + index,
        nombre: 'Producto extra ' + index,
        unidad: index % 2 ? 'kg' : 'litro',
        precio_venta: '1',
      })
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

  // 1. Permiso mínimo: opciones paginadas, foco, carga de saldo, validación y objetivo final.
  await preparar({ permisos: ['ajustar_inventario'], productosExtra: 2 })
  assert.ok(boton('Ajustar'))
  assert.equal(boton('Entrada', false), null)
  assert.equal(boton('Salida', false), null)
  assert.equal(peticiones.some((item) => item.path.includes('/movimientos/') || item.path.includes('/existencias/')), false)
  let dialog = await abrir()
  assert.ok(peticiones.some((item) => item.path.includes('/productos/opciones/?page=1')))
  assert.ok(peticiones.some((item) => item.path.includes('/productos/opciones/?page=2')))
  assert.equal(campo('producto_id').options.length, 5, 'Se acumularon las dos páginas de opciones activas.')
  await key('Tab', true)
  assert.equal(dialog.contains(document.activeElement), true)
  await submit()
  assert.match(dialog.textContent, /Selecciona un producto activo del negocio activo/)
  assert.match(dialog.textContent, /El stock objetivo es requerido/)
  assert.match(dialog.textContent, /El motivo es requerido/)
  assert.equal(saldos().length, 0, 'Sin producto no se consulta saldo.')
  assert.equal(posts().length, 0)
  await change(campo('producto_id'), '1')
  assert.ok(saldos().some((item) => item.path.endsWith('/negocios/1/existencias/1/')))
  assert.match(dialog.textContent, /Saldo actual: 5\.000 unidad\. Versión: 1\./)
  await change(campo('stock_objetivo'), '-1')
  await submit()
  assert.match(dialog.textContent, /no puede ser negativo/)
  await change(campo('stock_objetivo'), '5')
  await submit()
  assert.match(dialog.textContent, /debe cambiar el saldo/)
  await change(campo('stock_objetivo'), '1.5')
  await submit()
  assert.match(dialog.textContent, /requiere cantidades enteras/)
  await change(campo('stock_objetivo'), '1.0001')
  await submit()
  assert.match(dialog.textContent, /precisión decimal/)
  assert.equal(posts().length, 0)
  await change(campo('stock_objetivo'), '3')
  await change(campo('motivo'), 'Conteo físico')
  await submit(true)
  assert.equal(posts().length, 1, 'El bloqueo síncrono evita el doble envío.')
  const ajuste = posts()[0].body
  assert.deepEqual(Object.keys(ajuste).sort(), ['clave_operacion', 'motivo', 'producto_id', 'stock_objetivo', 'version_esperada'])
  assert.equal(ajuste.producto_id, 1)
  assert.equal(ajuste.stock_objetivo, '3.000')
  assert.equal(ajuste.version_esperada, 1)
  assert.equal(ajuste.motivo, 'Conteo físico')
  assert.match(ajuste.clave_operacion, UUID)
  assert.equal(dialogo(), null)
  assert.match(document.body.textContent, /Ajuste registrado correctamente/)
  assert.equal(notificaciones.length, 1)
  assert.equal(notificaciones[0].title, 'Movimiento registrado')
  assert.equal(eventosHistorial.length, 0, 'Sin listar_movimientos no se notifica refresco.')
  assert.equal((await existencias.obtenerExistencia(1, 1)).cantidad, '3.000')
  const historial = await movimientos.listarMovimientos(1)
  assert.equal(historial.results[0].tipo, 'ajuste')
  assert.equal(historial.results[0].cantidad, '-2.000', 'El objetivo final no se envía como delta.')
  console.log('OK F8 ajuste mínimo: opciones, saldo, validación, objetivo final, doble envío y éxito.')

  // 2. Sin permiso: no hay botón ni consultas de opciones/saldo.
  await preparar({ permisos: [] })
  assert.equal(boton('Ajustar', false), null)
  assert.match(document.body.textContent, /No tienes permiso para registrar entradas ni salidas/)
  assert.equal(peticiones.some((item) => item.path.includes('/productos/opciones/')), false)
  assert.equal(saldos().length, 0)
  assert.equal(posts().length, 0)
  console.log('OK F8 sin permiso: no se muestra Ajustar ni se consultan opciones o saldos.')

  // 3. Tenant: un producto ajeno inyectado en el DOM no carga saldo ni escribe.
  await preparar({ permisos: ['ajustar_inventario'], negocio: 2, username: 'admin_ferreteria' })
  dialog = await abrir()
  const selector = campo('producto_id')
  assert.ok(![...selector.options].some((option) => option.value === '1'))
  const ajena = document.createElement('option')
  ajena.value = '1'
  ajena.textContent = 'Artículo del otro negocio'
  selector.appendChild(ajena)
  await change(selector, '1')
  await change(campo('stock_objetivo'), '1')
  await change(campo('motivo'), 'Intento ajeno')
  await submit()
  assert.match(dialog.textContent, /producto activo del negocio activo/)
  assert.equal(saldos().some((item) => item.path.endsWith('/existencias/1/')), false)
  assert.equal(posts().length, 0)
  selector.removeChild(ajena)
  await change(selector, '4')
  assert.ok(saldos().some((item) => item.path.endsWith('/negocios/2/existencias/4/')))
  const versionFerreteria = (await existencias.obtenerExistencia(2, 4)).version
  await change(campo('stock_objetivo'), '4')
  await submit()
  assert.equal(posts()[0].body.producto_id, 4)
  assert.equal(posts()[0].body.version_esperada, versionFerreteria)
  assert.equal((await existencias.obtenerExistencia(2, 4)).cantidad, '4.000')
  console.log('OK F8 tenant: opciones y saldo del negocio activo; producto ajeno sin escritura.')

  // 4. Respuesta incierta: reintento idéntico conserva clave, sin duplicado.
  await preparar({ permisos: ['ajustar_inventario'] })
  let primeraIncierta = true
  manipulador = async (request, original) => {
    if (request.method === 'POST' && request.path.endsWith('/ajustes/') && primeraIncierta) {
      primeraIncierta = false
      await original(request)
      throw new ApiException('network_error', 'No se pudo confirmar la respuesta.', {}, 0)
    }
    return original(request)
  }
  dialog = await abrir()
  await change(campo('producto_id'), '1')
  await change(campo('stock_objetivo'), '4')
  await change(campo('motivo'), 'Conteo incierto')
  const versionAntes = (await existencias.obtenerExistencia(1, 1)).version
  const movimientosAntes = (await movimientos.listarMovimientos(1)).count
  await submit()
  assert.match(dialog.textContent, /No se pudo conectar/)
  assert.equal(posts().length, 1, 'No hubo reenvío automático.')
  assert.equal(campo('stock_objetivo').value, '4')
  assert.equal(campo('motivo').value, 'Conteo incierto')
  const primera = posts()[0].body
  await click(boton('Reintentar'))
  assert.equal(posts().length, 2)
  assert.deepEqual(posts()[1].body, primera, 'El reintento conserva UUID y payload.')
  assert.equal((await existencias.obtenerExistencia(1, 1)).version, versionAntes + 1)
  assert.equal((await movimientos.listarMovimientos(1)).count, movimientosAntes + 1)
  console.log('OK F8 reintento idéntico: una sola operación, misma clave y sin duplicado.')

  // 5. Conflicto de versión: conserva datos, ofrece actualizar y exige nuevo envío.
  await preparar({ permisos: ['ajustar_inventario'] })
  dialog = await abrir()
  await change(campo('producto_id'), '1')
  await change(campo('stock_objetivo'), '3')
  await change(campo('motivo'), 'Ajuste tras conflicto')
  await movimientos.registrarMovimiento(1, {
    producto_id: 1, tipo: 'entrada', cantidad: '1', motivo: 'Escritura concurrente', clave_operacion: randomUUID(),
  })
  const saldoConcurrente = await existencias.obtenerExistencia(1, 1)
  assert.equal(saldoConcurrente.cantidad, '6.000')
  assert.equal(saldoConcurrente.version, 2)
  const movimientosConflicto = (await movimientos.listarMovimientos(1)).count
  await submit()
  assert.match(dialog.textContent, /La operación o el saldo cambió/)
  assert.match(dialog.textContent, /Actualiza el saldo/)
  assert.ok(dialogo(), 'El conflicto no cierra el modal.')
  assert.equal(campo('stock_objetivo').value, '3')
  assert.equal(campo('motivo').value, 'Ajuste tras conflicto')
  assert.equal(boton('Reintentar', false), null, 'Un conflicto no ofrece reenvío ciego.')
  assert.ok(boton('Actualizar saldo'))
  assert.equal(posts().length, 1)
  assert.equal((await existencias.obtenerExistencia(1, 1)).cantidad, '6.000')
  const numeroSaldos = saldos().length
  await click(boton('Actualizar saldo'))
  assert.ok(saldos().length > numeroSaldos, 'Actualizar saldo vuelve a consultar la existencia.')
  assert.match(dialog.textContent, /Saldo actual: 6\.000 unidad\. Versión: 2\./)
  assert.equal(campo('stock_objetivo').value, '3')
  await submit()
  assert.equal(posts().length, 2)
  assert.notEqual(posts()[1].body.clave_operacion, posts()[0].body.clave_operacion, 'La nueva entrada usa otra clave.')
  assert.equal(posts()[1].body.version_esperada, 2)
  assert.equal(posts()[1].body.stock_objetivo, '3.000')
  assert.equal((await existencias.obtenerExistencia(1, 1)).cantidad, '3.000')
  assert.equal((await movimientos.listarMovimientos(1)).count, movimientosConflicto + 1)
  console.log('OK F8 conflicto: saldo desactualizado visible, actualización explícita y nueva clave.')

  // 6. Cambio rápido de producto: se cancela la consulta anterior y no se reusa su versión.
  await preparar({ permisos: ['ajustar_inventario'] })
  let senalProductoUno = null
  manipulador = (request, original) => {
    if (request.method === 'GET' && request.path.endsWith('/negocios/1/existencias/1/')) {
      return new Promise((resolve, reject) => {
        senalProductoUno = request.signal
        request.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true })
      })
    }
    return original(request)
  }
  dialog = await abrir()
  await change(campo('producto_id'), '1')
  await act(async () => { await pause(10) })
  assert.ok(senalProductoUno && !senalProductoUno.aborted, 'La consulta del primer producto quedó pendiente.')
  assert.match(dialog.textContent, /Cargando saldo actual/)
  await change(campo('producto_id'), '2')
  assert.equal(senalProductoUno.aborted, true, 'El cambio de producto canceló la consulta anterior.')
  assert.match(dialog.textContent, /Saldo actual: 0\.000 kg\. Versión: 0\./)
  await change(campo('stock_objetivo'), '1.5')
  await change(campo('motivo'), 'Producto por peso')
  await submit()
  assert.equal(posts().length, 1)
  assert.equal(posts()[0].body.producto_id, 2)
  assert.equal(posts()[0].body.version_esperada, 0, 'No se conserva la versión del producto anterior.')
  assert.equal(posts()[0].body.stock_objetivo, '1.500')
  assert.equal((await existencias.obtenerExistencia(1, 2)).cantidad, '1.500')
  console.log('OK F8 cambio de producto: consulta cancelada, saldo correcto y versión no heredada.')

  // 7. Cambio de negocio: cancela la consulta pendiente y desmonta el modal.
  const storeContexto = await preparar({ permisos: ['ajustar_inventario'], negocioAdicional: 2 })
  let senalContexto = null
  let abortada = false
  manipulador = (request, original) => {
    if (request.method === 'GET' && request.path.endsWith('/negocios/1/existencias/1/')) {
      return new Promise((resolve, reject) => {
        senalContexto = request.signal
        request.signal?.addEventListener('abort', () => {
          abortada = true
          reject(new DOMException('Cancelado', 'AbortError'))
        }, { once: true })
      })
    }
    return original(request)
  }
  dialog = await abrir()
  await change(campo('producto_id'), '1')
  await act(async () => { await pause(10) })
  assert.ok(senalContexto && !senalContexto.aborted)
  await act(async () => storeContexto.cambiarNegocio(2))
  await act(async () => { await pause(10) })
  assert.equal(senalContexto.aborted, true)
  assert.equal(abortada, true)
  assert.equal(dialogo(), null)
  manipulador = null
  assert.equal((await existencias.obtenerExistencia(1, 1)).version, 1, 'Una consulta cancelada no escribe.')
  console.log('OK F8 contexto: cambio de negocio cancela la consulta y desmonta el modal.')

  // 8. Con listar_movimientos se notifica el refresco del historial de F9.
  await preparar({ permisos: ['ajustar_inventario', 'listar_movimientos'] })
  dialog = await abrir()
  await change(campo('producto_id'), '1')
  await change(campo('stock_objetivo'), '4')
  await change(campo('motivo'), 'Reposición')
  await submit()
  assert.equal(eventosHistorial.length, 1)
  assert.deepEqual(eventosHistorial[0], { negocioId: 1 })
  assert.equal(dialogo(), null)
  console.log('OK F8 historial: la confirmación notifica el refresco solo cuando el actor puede listar.')

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

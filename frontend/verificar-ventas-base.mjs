import assert from 'node:assert/strict'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'http://localhost:5173/negocio/nueva-venta' })
const originals = new Map()
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'PopStateEvent', 'MutationObserver', 'getComputedStyle', 'localStorage', 'sessionStorage', 'CustomEvent']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] })
}
const nativeFetch = globalThis.fetch
let calls = 0
globalThis.fetch = async () => { calls++; throw new Error('F1 no debe llamar endpoints pendientes.') }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const root = createRoot(document.getElementById('root'))
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const h = React.createElement
async function render(element) { await act(async () => root.render(element)) }
async function click(element) { assert.ok(element); await act(async () => element.click()) }
async function key(value, shiftKey = false) {
  await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })))
}
const domErrors = []
window.addEventListener('error', (event) => domErrors.push(event.error))
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const state = await load('features/ventas/draft/state.ts')
  const { VentaDraftProvider, useVentaDraft } = await load('features/ventas/draft/index.ts')
  const { erroresLineaVenta } = await load('features/ventas/components/shared/erroresLinea.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  const { AppRoutes } = await load('app/routes/AppRoutes.tsx')
  const { navegar } = await load('app/routes/navigation.ts')
  const { modules } = await load('app/routes/modules.ts')
  const { puedeAcceder } = await load('app/routes/access.ts')
  const { ToastProvider } = await load('components/feedback/ToastProvider.tsx')
  const { FormModal } = await load('components/ui/FormModal.tsx')
  const { TextField } = await load('components/ui/TextField.tsx')
  const { ApiFeedback } = await load('components/feedback/ApiFeedback.tsx')
  const { ApiException } = await load('api/errors.ts')
  const producto = (id = 1, overrides = {}) => ({ id, negocio_id: 1, sku: 'PR-' + id, nombre: 'Producto ' + id, unidad: 'kg', precio_venta: '1.25', disponible: '0.000', ...overrides })
  const invalid = (fn, field) => assert.throws(fn, (e) => e.code === 'validation_error' && (!field || Array.isArray(e.errors[field])))
  let cart = state.agregarLinea(state.draftVacio(), 1, producto(), '0.125')
  cart = state.agregarLinea(cart, 1, producto(), '0.125')
  assert.equal(cart.lineas.length, 1)
  assert.equal(cart.lineas[0].cantidad, '0.250')
  assert.equal(cart.lineas[0].precio_unitario_esperado, '1.25')
  assert.equal(cart.lineas[0].producto.disponible, '0.000', 'Stock cero es informativo, no una reserva.')
  const before = structuredClone(cart)
  for (const quantity of ['0', '-1', '1.0001', '1e3', '1,2', '100000000000', 1]) {
    invalid(() => state.cambiarCantidadLinea(cart, 1, quantity), 'cantidad')
    assert.deepEqual(cart, before)
  }
  invalid(() => state.agregarLinea(cart, 1, producto(2, { negocio_id: 2 })), 'producto_id')
  invalid(() => state.agregarLinea(cart, 1, producto(2, { unidad: 'unidad' }), '0.5'), 'cantidad')
  invalid(() => state.agregarLinea(cart, 1, producto(2, { precio_venta: 3 })), 'precio_unitario_esperado')
  invalid(() => state.agregarLinea(cart, 1, producto(2, { precio_venta: '1.234' })), 'precio_unitario_esperado')
  invalid(() => state.cambiarObservacionesDraft(cart, 'x'.repeat(501)), 'observaciones')
  invalid(() => state.cambiarCantidadLinea(cart, 99, '1'), 'producto_id')
  assert.deepEqual(cart, before)
  cart = state.agregarLinea(cart, 1, producto(1, { precio_venta: '5.00' }))
  assert.equal(cart.lineas[0].precio_unitario_esperado, '1.25', 'Añadir repetido no acepta otro precio silenciosamente.')
  cart = state.revisarProductoLinea(cart, 1, producto(1, { precio_venta: '5.00' }))
  assert.equal(cart.lineas[0].precio_unitario_esperado, '5.00')
  let full = state.draftVacio()
  for (let id = 1; id <= 100; id++) full = state.agregarLinea(full, 1, producto(id))
  invalid(() => state.agregarLinea(full, 1, producto(101)), 'detalles')
  assert.equal(full.lineas.length, 100)
  assert.equal(state.agregarLinea(full, 1, producto(100)).lineas[99].cantidad, '2.000')
  const overflow = state.agregarLinea(state.draftVacio(), 1, producto(), '99999999999.999')
  invalid(() => state.agregarLinea(overflow, 1, producto(), '0.001'), 'cantidad')
  assert.equal(overflow.lineas[0].cantidad, '99999999999.999')
  const sent = state.agregarLinea(before, 1, producto(2))
  const errors = { 'detalles.0.cantidad': ['Cantidad inválida'], 'detalles.1.producto_id': ['No disponible'], detalles: ['General'] }
  assert.deepEqual(erroresLineaVenta(errors, sent, 2), { producto_id: ['No disponible'] })
  assert.deepEqual(erroresLineaVenta(errors, sent, 99), {})
  assert.deepEqual([...sent.lineas].reverse().map((line) => erroresLineaVenta(errors, sent, line.producto.id)),
    [{ producto_id: ['No disponible'] }, { cantidad: ['Cantidad inválida'] }])
  console.log('OK borrador: cadenas exactas, unidad/rango, máximo 100, duplicados, revisión explícita de precio, errores por snapshot y rollback local.')

  const fixture = (permisos = ['registrar_venta'], userId = 1, active = true) => ({
    usuario: { id: userId, username: 'fixture_ventas', is_active: active }, permisos_globales: [],
    negocios: [{ id: 1, nombre: 'Tienda', rol_id: 1, permisos }, { id: 2, nombre: 'Ferretería', rol_id: 2, permisos }],
  })
  let session = fixture()
  let store = crearSessionStore({ obtenerSesion: async () => session, iniciarSesion: async () => session, cerrarSesion: async () => {} })
  await store.restaurar()
  function Harness({ children }) {
    const value = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    return h(ToastProvider, null, h(SessionContext.Provider, { value: { ...value, store } }, children))
  }
  let api
  function Probe() {
    api = useVentaDraft()
    return h('output', null, api.draft.lineas.length + ':' + api.draft.observaciones)
  }
  const withDraft = () => h(Harness, null, h(VentaDraftProvider, null, h(Probe)))
  await render(withDraft())
  await act(async () => { api.agregar(producto(), '0.125'); api.agregar(producto(), '0.125'); api.cambiarObservaciones('Nota') })
  assert.equal(api.draft.lineas[0].cantidad, '0.250', 'Acciones síncronas se acumulan sin perder actualizaciones.')
  const captured = api.snapshot()
  captured.lineas[0].cantidad = '99.000'
  api.draft.lineas[0].producto.nombre = 'Mutación externa'
  assert.equal(api.snapshot().lineas[0].cantidad, '0.250')
  assert.equal(api.snapshot().lineas[0].producto.nombre, 'Producto 1')
  const localBefore = api.snapshot()
  invalid(() => api.agregar(producto(2, { negocio_id: 2 })), 'producto_id')
  assert.deepEqual(api.snapshot(), localBefore)
  let sending
  await act(async () => { sending = api.iniciarEnvio() })
  assert.equal(api.busy, true)
  invalid(() => api.iniciarEnvio())
  invalid(() => api.vaciar())
  invalid(() => api.cambiarCantidad(1, '2'))
  assert.deepEqual(api.snapshot(), localBefore)
  sending.lineas[0].cantidad = '900.000'
  await act(async () => api.terminarEnvio(false))
  assert.deepEqual(api.snapshot(), localBefore, 'Un error de envío conserva el carrito y observaciones.')
  await act(async () => { api.iniciarEnvio(); api.terminarEnvio(true); api.terminarEnvio(true) })
  assert.deepEqual(api.snapshot(), state.draftVacio())
  invalid(() => api.iniciarEnvio(), 'detalles')
  await act(async () => { api.agregar(producto()); api.cambiarCantidad(1, '3.5'); api.quitar(1) })
  assert.equal(api.snapshot().lineas.length, 0)
  console.log('OK provider: envíos bloqueados sincrónicamente, copias independientes, errores conservan estado y éxito limpia una sola vez.')

  // Consumidor de prueba: F1 no implementa confirmación ni anulación reales.
  function ConsumerModal() {
    const draft = useVentaDraft()
    const [open, setOpen] = React.useState(false)
    const [error, setError] = React.useState(null)
    return h(React.Fragment, null,
      h('button', { onClick: () => { draft.agregar(producto(1, { negocio_id: draft.negocioId })); setOpen(true) } }, 'Abrir prueba'),
      h(FormModal, { open, title: 'Prueba de borrador', description: 'Una operación por contexto.', pending: draft.busy,
        actionText: 'Enviar', onClose: () => setOpen(false), onSubmit() { draft.iniciarEnvio(); setError(null) } },
      h(TextField, { label: 'Observaciones', name: 'nota', value: draft.draft.observaciones,
        onChange: (e) => draft.cambiarObservaciones(e.target.value), errors: error ? ['Error por campo'] : [] }),
      error && h(ApiFeedback, { error }),
      h('button', { type: 'button', onClick: () => setError(new ApiException('validation_error', 'Revisa los campos.', { observaciones: ['Error por campo'] }, 400)) }, 'Mostrar validación')),
    )
  }
  const consumer = () => h(Harness, null, h(VentaDraftProvider, null, h(Probe), h(ConsumerModal)))
  await render(consumer())
  const opener = document.querySelector('#root button')
  opener.focus()
  await click(opener)
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1)
  assert.equal(document.querySelectorAll('form').length, 1)
  assert.equal(document.querySelectorAll('form form').length, 0)
  assert.equal(document.body.style.overflow, 'hidden')
  assert.ok(document.querySelector('[role="dialog"]').contains(document.activeElement))
  const dialogButtons = [...document.querySelectorAll('[role="dialog"] button')]
  dialogButtons.at(-1).focus()
  await key('Tab')
  assert.equal(document.activeElement, dialogButtons[0])
  await key('Tab', true)
  assert.equal(document.activeElement, dialogButtons.at(-1))
  await click(dialogButtons.find((b) => b.textContent === 'Mostrar validación'))
  assert.ok(document.querySelector('[aria-invalid="true"]'))
  assert.ok(document.querySelector('[role="alert"]'))
  await key('Escape')
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.activeElement, opener)
  await click(opener)
  await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(api.busy, true)
  await key('Escape')
  await click(document.querySelector('.modal-backdrop'))
  assert.ok(document.querySelector('[role="dialog"]'))
  const old = api
  let resolveOld
  const pending = store.enContexto(() => new Promise((resolve) => { resolveOld = resolve }))
  const rejected = assert.rejects(pending, (e) => e.name === 'AbortError')
  await act(async () => store.cambiarNegocio(2))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.body.style.overflow, '')
  assert.deepEqual(api.snapshot(), state.draftVacio())
  assert.equal(api.busy, false)
  assert.throws(() => old.terminarEnvio(true), (e) => e.name === 'AbortError')
  resolveOld({ negocio_id: 1 }); await rejected
  await act(async () => store.cambiarNegocio(1))
  assert.deepEqual(api.snapshot(), state.draftVacio(), 'Volver no recupera el carrito anterior.')
  await act(async () => api.agregar(producto()))
  await click(document.querySelector('#root button'))
  await act(async () => store.expirar())
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.body.style.overflow, '')
  assert.equal(document.querySelector('output'), null)
  session = fixture(['registrar_venta'], 2)
  await act(async () => store.restaurar())
  assert.deepEqual(api.snapshot(), state.draftVacio())
  await act(async () => api.agregar(producto()))
  await act(async () => store.logout())
  assert.equal(document.querySelector('output'), null)
  await act(async () => store.restaurar())
  assert.deepEqual(api.snapshot(), state.draftVacio())
  assert.equal(sessionStorage.length, 0)
  assert.equal(localStorage.length, 0)
  console.log('OK contexto/modal: foco, Tab/Shift+Tab, Escape, fondo, validación, busy, solicitud tardía, expiración, logout y nueva sesión sin persistir carritos.')

  const routes = {
    'nueva-venta': ['registrar_venta'],
    ventas: ['registrar_venta', 'listar_ventas', 'anular_venta'],
  }
  for (const [id, codes] of Object.entries(routes)) {
    const entry = modules.find((m) => m.id === id)
    assert.equal(entry.path, '/negocio/' + id)
    for (const code of codes) {
      assert.equal(puedeAcceder(entry, fixture([code]), 1), true)
      assert.equal(puedeAcceder(entry, { ...fixture([code]), negocios: [fixture([code]).negocios[0]] }, 2), false)
      session = fixture([code])
      await act(async () => { await store.restaurar(); navegar(entry.path) })
      await render(h(Harness, null, h(AppRoutes)))
      const texto = document.querySelector('#root').textContent
      // F7 sustituye el placeholder del listado por filtros y consulta real;
      // F8/F9 siguen pendientes y no abren diálogos por sí solos.
      assert.match(texto, /Pendiente de implementación/)
      assert.equal(document.querySelector('[role="dialog"]'), null)
      if (id === 'nueva-venta') {
        assert.equal(document.querySelectorAll('form').length, 0)
        assert.equal(document.querySelector('table'), null)
      } else if (code === 'listar_ventas') {
        assert.ok(document.querySelector('form[aria-label="Filtrar ventas"]'))
        assert.match(texto, /Listado de ventas/)
      } else {
        assert.ok(document.querySelector('form[aria-label="Abrir venta por ID"]'))
        assert.equal(document.querySelector('form[aria-label="Filtrar ventas"]'), null)
        assert.equal(document.querySelector('table'), null)
      }
    }
    assert.equal(puedeAcceder(entry, fixture([]), 1), false)
    session = fixture([])
    await act(async () => { await store.restaurar(); navegar(entry.path) })
    assert.match(document.querySelector('#root').textContent, /Acceso denegado/)
  }
  session = fixture(['registrar_venta'], 1, false)
  await act(async () => store.restaurar())
  await render(withDraft())
  assert.equal(document.querySelector('output'), null)
  assert.match(document.querySelector('#root').textContent, /No tienes permiso/)
  assert.equal(calls, 0, 'Los placeholders no realizan consultas ni escrituras, tampoco desde efectos.')
  assert.deepEqual(domErrors, [])
  console.log('OK rutas: permisos alternativos/mínimos y denegados, tenant ajeno, cuenta inactiva, stubs sin éxito ficticio ni llamadas HTTP.')
} finally {
  await act(async () => root.unmount())
  globalThis.fetch = nativeFetch
  await server.close()
  dom.window.close()
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
}

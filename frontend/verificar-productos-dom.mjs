import assert from 'node:assert/strict'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'http://localhost:5173/' })
const originals = new Map()
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const root = createRoot(document.getElementById('root'))
const h = React.createElement
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const mocks = await load('mocks/services/transport.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  const { ProductosPage } = await load('features/productos/pages/index.tsx')
  const prods = await load('features/productos/api.ts')

  mocks.reiniciarMocks()
  mocks.configurarMocks({ latencia: 0 })

  const store = crearSessionStore()
  function Proveedor({ children }) {
    const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    return h(SessionContext.Provider, { value: { ...state, store } }, children)
  }
  await act(async () => { await store.login({ username: 'admin_tienda', password: 'Demo-12345!' }) })
  await act(async () => root.render(h(Proveedor, null, h(ProductosPage))))
  await flush()

  assert.match(document.getElementById('root').textContent, /Crear producto/)
  assert.match(document.getElementById('root').textContent, /COMUN-01/)

  // --- Doble envío: dos submit seguidos crean un solo producto ---
  const abrir = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Crear producto')
  await act(async () => abrir.click())
  await flush()
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'El modal de creación debe abrirse.')
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  const selSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
  async function escribir(el, valor, esSelect = false) {
    await act(async () => {
      ;(esSelect ? selSetter : setter).call(el, valor)
      el.dispatchEvent(new dom.window.Event(esSelect ? 'change' : 'input', { bubbles: true }))
    })
  }
  await escribir(dialog.querySelector('input[name="sku"]'), 'dom-1')
  await escribir(dialog.querySelector('input[name="nombre"]'), 'Producto DOM')
  await escribir(dialog.querySelector('input[name="precio_venta"]'), '5.00')
  await escribir(dialog.querySelector('select[name="categoria_id"]'), '1', true)

  const form = dialog.querySelector('form')
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  const lista = await prods.listarProductos(1, { search: 'dom-1' })
  assert.equal(lista.count, 1, 'El doble envío debe crear un solo producto.')
  assert.equal(lista.results[0].sku, 'DOM-1')
  assert.equal(document.querySelector('[role="dialog"]'), null, 'El modal se cierra al guardar.')
  console.log('OK DOM doble envío: dos submit seguidos crean un solo producto y el modal se cierra.')

  // --- Validación en pantalla: precio inválido no envía ---
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Crear producto').click())
  await flush()
  const d2 = document.querySelector('[role="dialog"]')
  await escribir(d2.querySelector('input[name="sku"]'), 'dom-2')
  await escribir(d2.querySelector('input[name="nombre"]'), 'Otro')
  await escribir(d2.querySelector('input[name="precio_venta"]'), '2.001')
  await escribir(d2.querySelector('select[name="categoria_id"]'), '1', true)
  await act(async () => d2.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  await flush()
  assert.ok(document.querySelector('[role="dialog"]'), 'El modal sigue abierto con errores.')
  assert.equal(d2.querySelector('input[name="precio_venta"]').getAttribute('aria-invalid'), 'true')
  assert.equal(d2.querySelector('input[name="nombre"]').value, 'Otro', 'Se conservan los datos escritos.')
  assert.equal((await prods.listarProductos(1, { search: 'dom-2' })).count, 0)
  console.log('OK DOM validación: precio con exceso de decimales marca el campo, conserva datos y no crea nada.')
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancelar').click())

  // --- Permisos: sin permisos de productos no hay acceso ---
  await act(async () => { await store.login({ username: 'compartido', password: 'Demo-12345!' }) })
  await act(async () => root.render(h(Proveedor, null, h(ProductosPage))))
  await flush()
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.doesNotMatch(document.getElementById('root').textContent, /Crear producto/)
  console.log('OK DOM permisos: sin permisos de productos no se muestra el botón Crear.')
} finally {
  await act(async () => root.unmount())
  await server.close()
  dom.window.close()
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
}
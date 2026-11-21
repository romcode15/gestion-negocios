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
  const { CategoriasPage } = await load('features/categorias/pages/index.tsx')

  mocks.reiniciarMocks()
  mocks.configurarMocks({ latencia: 0 })

  // Un proveedor mínimo basado en el store real de sesión y los mocks.
  const store = crearSessionStore()
  function Proveedor({ children }) {
    const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    return h(SessionContext.Provider, { value: { ...state, store } }, children)
  }
  await act(async () => { await store.login({ username: 'admin_tienda', password: 'Demo-12345!' }) })
  await act(async () => root.render(h(Proveedor, null, h(CategoriasPage))))
  await flush()

  const root_ = document.getElementById('root')
  assert.match(root_.textContent, /Crear categoría/)
  assert.match(root_.textContent, /General/)

  // --- Doble envío: dos submit seguidos crean una sola categoría ---
  const abrir = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Crear categoría')
  await act(async () => abrir.click())
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'El modal de creación debe abrirse.')
  const input = dialog.querySelector('input[name="nombre"]')
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, 'Categoría DOM')
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const form = dialog.querySelector('form')
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  const lista = await (await load('features/categorias/api.ts')).listarCategorias(1, { search: 'Categoría DOM' })
  assert.equal(lista.count, 1, 'El doble envío debe crear una sola categoría.')
  assert.equal(document.querySelector('[role="dialog"]'), null, 'El modal se cierra al guardar.')
  console.log('OK DOM doble envío: dos submit seguidos crean una sola categoría y el modal se cierra.')

  // --- Cambio de negocio: el modal se descarta ---
  await act(async () => { await store.login({ username: 'compartido', password: 'Demo-12345!' }) })
  await act(async () => root.render(h(Proveedor, null, h(CategoriasPage))))
  await flush()
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.doesNotMatch(document.getElementById('root').textContent, /Crear categoría/)
  console.log('OK DOM permisos: sin permisos de categorías no se muestra el botón Crear.')
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
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
  const { ExistenciasPage } = await load('features/existencias/pages/index.tsx')

  mocks.reiniciarMocks()
  mocks.configurarMocks({ latencia: 0 })

  const store = crearSessionStore()
  function Proveedor({ children }) {
    const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    return h(SessionContext.Provider, { value: { ...state, store } }, children)
  }
  await act(async () => { await store.login({ username: 'admin_tienda', password: 'Demo-12345!' }) })
  await act(async () => root.render(h(Proveedor, null, h(ExistenciasPage))))
  await flush()

  const texto = document.getElementById('root').textContent
  assert.match(texto, /Existencias del negocio activo/)
  assert.match(texto, /COMUN-01/)
  assert.match(texto, /5\.000 unidad/)
  const botones = [...document.querySelectorAll('button')].map((b) => b.textContent)
  assert.ok(botones.includes('Filtrar'))
  assert.equal(botones.some((t) => /crear|editar|guardar|eliminar|ajustar/i.test(t)), false, 'No debe haber botones de escritura.')
  console.log('OK DOM tabla: muestra saldos con unidad y no hay botones de escritura.')

  const categoria = document.querySelector('input[name="categoria_id"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(categoria, '9007199254740993')
    categoria.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await act(async () => document.querySelector('form[role="search"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  assert.match(document.body.textContent, /ID entero positivo válido/)

  await act(async () => { await store.login({ username: 'compartido', password: 'Demo-12345!' }) })
  await act(async () => root.render(h(Proveedor, null, h(ExistenciasPage))))
  await flush()
  assert.doesNotMatch(document.getElementById('root').textContent, /COMUN-01/)
  assert.match(document.getElementById('root').textContent, /No tienes permiso/)
  console.log('OK DOM permisos: sin consultar_existencias se muestra acceso denegado y ningún dato.')
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

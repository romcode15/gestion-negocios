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
const load = (path) => server.ssrLoadModule('/src/' + path)
const h = React.createElement
const dialog = () => document.querySelector('[role="dialog"]')
const filters = () => document.querySelector('form[role="search"]')
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)) })
  }
  assert.fail(label)
}
async function change(scope, name, value) {
  const field = scope.querySelector(`[name="${name}"]`)
  assert.ok(field, name)
  const proto = field.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value)
    field.dispatchEvent(new dom.window.Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function submit(form) {
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
}
async function click(label) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)
  assert.ok(button, label)
  await act(async () => button.click())
}
try {
  const mocks = await load('mocks/services/transport.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  const categories = await load('features/categorias/api.ts')
  const products = await load('features/productos/api.ts')
  for (const module of ['categorias', 'productos']) {
    mocks.reiniciarMocks()
    mocks.configurarMocks({ latencia: 0 })
    const store = crearSessionStore()
    await act(async () => store.login({ username: 'admin_tienda', password: 'Demo-12345!' }))
    const category = await categories.crearCategoria(1, { nombre: 'Filtro de prueba' })
    const prefix = 'Conservar'
    for (let i = 1; i <= 3; i++) {
      if (module === 'categorias') await categories.crearCategoria(1, { nombre: `${prefix} ${i}` })
      else await products.crearProducto(1, { categoria_id: category.id, sku: `FILTRO-${i}`, nombre: `${prefix} ${i}`, unidad: 'unidad', precio_venta: '1.00' })
    }
    const Page = (await load(`features/${module}/pages/index.tsx`))[module === 'categorias' ? 'CategoriasPage' : 'ProductosPage']
    function Proveedor({ children }) {
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      return h(SessionContext.Provider, { value: { ...state, store } }, children)
    }
    await act(async () => root.render(h(Proveedor, { key: module }, h(Page))))
    await until(() => document.querySelector('table'), 'Listado inicial')
    await change(filters(), 'search', prefix)
    await change(filters(), 'activo', 'true')
    if (module === 'productos') await change(filters(), 'categoria_id', String(category.id))
    await submit(filters())
    await until(() => document.querySelector('.paginacion')?.textContent.includes('Página 1 · 3 '), 'Filtros aplicados')
    await click('Siguiente')
    await until(() => document.querySelector('table')?.textContent.includes('Conservar 3'), 'Segunda página')
    await click('Editar Conservar 3')
    await until(() => dialog()?.querySelector('[name="descripcion"]'), 'Formulario de edición')
    await change(dialog(), 'descripcion', 'Editado sin perder filtros')
    await submit(dialog().querySelector('form'))
    await until(() => !dialog() && document.querySelector('table')?.textContent.includes('Conservar 3'), 'Refresco de la misma página')
    assert.match(document.querySelector('.paginacion').textContent, /Página 2/)
    assert.equal(filters().querySelector('[name="search"]').value, prefix)
    assert.equal(filters().querySelector('[name="activo"]').value, 'true')
    if (module === 'productos') assert.equal(filters().querySelector('[name="categoria_id"]').value, String(category.id))

    // La última fila deja de cumplir el filtro: recuperar una página válida.
    await click('Editar Conservar 3')
    await until(() => dialog()?.querySelector('[name="activo"]'), 'Formulario para desactivar')
    await act(async () => dialog().querySelector('[name="activo"]').click())
    await submit(dialog().querySelector('form'))
    await until(() => !dialog() && document.querySelector('.paginacion')?.textContent.includes('Página 1 · 2 '), 'Página inválida recuperada')
    assert.equal(filters().querySelector('[name="search"]').value, prefix)
    assert.equal(filters().querySelector('[name="activo"]').value, 'true')
    assert.doesNotMatch(document.querySelector('table').textContent, /Conservar 3/)

    await click(module === 'categorias' ? 'Crear categoría' : 'Crear producto')
    await until(() => dialog()?.querySelector('[name="nombre"]'), 'Formulario de alta')
    await change(dialog(), 'nombre', 'Fuera del filtro')
    if (module === 'productos') {
      await until(() => dialog()?.querySelector('select[name="categoria_id"]'), 'Selector de categoría')
      while (!dialog().querySelector(`option[value="${category.id}"]`)) {
        await click('Categorías siguientes')
        await until(() => dialog()?.querySelector('select[name="categoria_id"]'), 'Página de opciones')
      }
      await until(() => dialog()?.querySelector(`option[value="${category.id}"]`), 'Opciones de categoría')
      await change(dialog(), 'sku', 'FUERA-FILTRO')
      await change(dialog(), 'categoria_id', String(category.id))
      await change(dialog(), 'precio_venta', '2.00')
    }
    await submit(dialog().querySelector('form'))
    await until(() => !dialog() && document.querySelector('table'), 'Alta y refresco')
    assert.equal(filters().querySelector('[name="search"]').value, prefix)
    assert.doesNotMatch(document.querySelector('table').textContent, /Fuera del filtro/)
    // El contexto sí debe limpiar los filtros, sin arrastrarlos a otro negocio.
    const { crearMembresia } = await load('features/membresias/api.ts')
    await act(async () => store.logout())
    await act(async () => store.login({ username: 'admin_ferreteria', password: 'Demo-12345!' }))
    await act(async () => crearMembresia(2, { username: 'admin_tienda', rol_id: 3 }))
    await act(async () => store.login({ username: 'admin_tienda', password: 'Demo-12345!' }))
    await act(async () => store.cambiarNegocio(2))
    await until(() => document.querySelector('table'), 'Contexto compartido')
    assert.equal(filters().querySelector('[name="search"]').value, '')
    console.log(`OK ${module}: alta/edición conservan filtros y página; desactivar recupera página válida; contexto limpia filtros.`)
    await act(async () => root.render(null))
  }
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

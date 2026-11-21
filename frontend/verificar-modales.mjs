import assert from 'node:assert/strict'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
const dom = new JSDOM('<!doctype html><body><button id="opener">Abrir</button><div id="root"></div><aside id="preserved" inert="original"></aside></body>', { url: 'http://localhost:5173/' })
const originals = new Map()
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const domErrors = []
window.addEventListener('error', (event) => domErrors.push(event.error))
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const root = createRoot(document.getElementById('root'))
const h = React.createElement
const opener = document.getElementById('opener')
async function render(component) { await act(async () => root.render(component)) }
async function click(element) { assert.ok(element); await act(async () => element.click()) }
async function key(value, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
  await act(async () => document.activeElement.dispatchEvent(event))
  return event
}
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const { Modal } = await load('components/ui/Modal.tsx')
  const { FormModal } = await load('components/ui/FormModal.tsx')
  const { TextField } = await load('components/ui/TextField.tsx')
  const { ApiFeedback } = await load('components/feedback/ApiFeedback.tsx')
  const { ApiException } = await load('api/errors.ts')
  const { modules } = await load('app/routes/modules.ts')
  const { puedeAcceder } = await load('app/routes/access.ts')
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  let closed = 0
  let busy = false
  const focus = React.createRef()
  function modal(open = true) {
    return h(Modal, { open, title: 'Diálogo de prueba', description: 'Descripción accesible', busy, onClose() { closed++ }, initialFocusRef: focus },
      h(TextField, { label: 'Nombre', name: 'nombre', ref: focus }),
      h('input', { 'aria-label': 'Último', id: 'last' }),
      h('div', { style: { display: 'none' } }, h('button', null, 'Oculto')),
    )
  }
  document.body.style.setProperty('overflow', 'clip', 'important')
  opener.focus()
  await render(modal(false))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  await render(modal())
  const dialog = document.querySelector('[role="dialog"]')
  assert.equal(dialog.parentElement.parentElement, document.body)
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Diálogo de prueba')
  assert.equal(document.getElementById(dialog.getAttribute('aria-describedby')).textContent, 'Descripción accesible')
  assert.equal(document.body.style.overflow, 'hidden')
  assert.equal(document.getElementById('root').hasAttribute('inert'), true)
  // TextField forwards native props to its input in React 19.
  assert.equal(document.activeElement.name, 'nombre')
  document.getElementById('last').focus()
  assert.equal((await key('Tab')).defaultPrevented, true)
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Cerrar diálogo')
  await key('Tab', true)
  assert.equal(document.activeElement.id, 'last')
  opener.focus()
  assert.equal(document.activeElement.name, 'nombre')
  await click(dialog)
  assert.equal(closed, 0)
  await click(document.querySelector('.modal-backdrop'))
  assert.equal(closed, 1)
  await key('Escape')
  assert.equal(closed, 2)
  await click(document.querySelector('[aria-label="Cerrar diálogo"]'))
  assert.equal(closed, 3)
  busy = true
  await render(modal())
  await click(document.querySelector('[aria-label="Cerrar diálogo"]'))
  await click(document.querySelector('.modal-backdrop'))
  await key('Escape')
  assert.equal(closed, 3)
  assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-busy'), 'true')
  const added = document.createElement('button')
  document.body.append(added)
  await act(async () => { await Promise.resolve() })
  assert.equal(added.hasAttribute('inert'), true)
  await render(null) // Desmontaje forzoso incluso busy.
  assert.equal(document.body.style.overflow, 'clip')
  assert.equal(document.body.style.getPropertyPriority('overflow'), 'important')
  assert.equal(document.getElementById('root').hasAttribute('inert'), false)
  assert.equal(document.getElementById('preserved').getAttribute('inert'), 'original')
  assert.equal(added.hasAttribute('inert'), false)
  assert.equal(document.activeElement, opener)
  await key('Escape')
  assert.equal(closed, 3, 'No deben quedar listeners.')
  added.remove()
  // Sin controles enfocables se mantiene el foco en el diálogo.
  await render(h(Modal, { open: true, title: 'Sin controles', busy: true, onClose() {} }, 'Texto'))
  assert.equal(document.activeElement.getAttribute('role'), 'dialog')
  await key('Tab'); assert.equal(document.activeElement.getAttribute('role'), 'dialog')
  await render(null)
  // StrictMode abre/cierra efectos sin filtrar estilos, listeners ni foco.
  opener.focus()
  await render(h(React.StrictMode, null, h(Modal, { open: true, title: 'Estricto', onClose() {} }, h('button', null, 'Acción'))))
  await render(null)
  assert.equal(document.body.style.overflow, 'clip')
  assert.equal(document.activeElement, opener)
  console.log('OK Modal: portal, título/descripción, foco inicial, Tab/Shift+Tab, foco externo, fondo, clic interno, Escape, botón, busy, StrictMode y limpieza.')

  let submitted = 0
  const lock = { current: false }
  function form(pending = false) {
    return h(FormModal, { open: true, title: 'Formulario genérico', pending, actionText: 'Guardar', onClose() { closed++ },
      onSubmit() { if (lock.current) return; lock.current = true; submitted++ } },
      h(TextField, { label: 'Nombre', name: 'nombre', errors: ['Campo requerido.'] }),
      h(ApiFeedback, { error: new ApiException('validation_error', 'Revisa los campos.', { nombre: ['Campo requerido.'] }, 400) }),
    )
  }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 568 })
  await render(form())
  assert.equal(document.querySelectorAll('form').length, 1)
  assert.equal(document.querySelector('button[type="submit"]').textContent, 'Guardar')
  assert.equal(document.querySelector('input').getAttribute('aria-invalid'), 'true')
  await act(async () => {
    const submit = () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    submit(); submit()
  })
  assert.equal(submitted, 1, 'El consumidor aplica bloqueo síncrono.')
  assert.ok(document.querySelector('[role="dialog"]'), 'El componente no cierra automáticamente tras validación.')
  const beforeCancel = closed
  await click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Cancelar'))
  assert.equal(closed, beforeCancel + 1)
  await render(form(true))
  assert.equal(document.querySelector('input').matches(':disabled'), true)
  await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(submitted, 1)
  await click(document.querySelector('.modal-backdrop')); await key('Escape')
  assert.equal(closed, beforeCancel + 1)
  await render(null)
  console.log('OK FormModal: un formulario, submit/cancelar explícitos, validación visible, busy, envío síncrono y DOM completo con viewport móvil. Diseño visual pendiente.')

  const expected = {
    categorias: ['listar_categorias', 'crear_categoria', 'editar_categoria'],
    productos: ['listar_productos', 'crear_producto', 'editar_producto'],
    existencias: ['consultar_existencias'],
    movimientos: ['listar_movimientos', 'registrar_entrada', 'registrar_salida', 'ajustar_inventario'],
  }
  const user = { id: 1, username: 'fixture', is_active: true }
  const session = (permisos) => ({ usuario: user, permisos_globales: [], negocios: [{ id: 1, nombre: 'Tienda', rol_id: 1, permisos }, { id: 2, nombre: 'Ferretería', rol_id: 2, permisos: [] }] })
  for (const [id, permisos] of Object.entries(expected)) {
    const entry = modules.find((entry) => entry.id === id)
    assert.ok(entry)
    assert.equal(entry.path, '/negocio/' + id)
    for (const codigo of permisos) assert.equal(puedeAcceder(entry, session([codigo]), 1), true)
    assert.equal(puedeAcceder(entry, session([]), 1), false)
    assert.equal(puedeAcceder(entry, session(permisos), 2), false)
        if (id !== 'categorias' && id !== 'productos') {
      await render(h(entry.Page))
      assert.match(document.getElementById('root').textContent, /pendiente de implementación/)
    }
  }
  // Consumidor de demostración: los módulos se remontan por revisión, como AppRoutes.
  const allowed = session(['crear_categoria'])
  const store = crearSessionStore({ obtenerSesion: async () => allowed, iniciarSesion: async () => allowed, cerrarSesion: async () => {} })
  await store.restaurar()
  function Consumer() {
    const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    return state.sesion ? h(ContextDialog, { key: state.revision }) : null
  }
  function ContextDialog() {
    const [open, setOpen] = React.useState(false)
    return h(React.Fragment, null,
      h('button', { onClick: () => setOpen(true) }, 'Abrir contexto'),
      h(FormModal, { open, title: 'Contexto genérico', pending: true, actionText: 'Guardar', onClose: () => setOpen(false), onSubmit() {} }, h('input', { name: 'local', defaultValue: 'Dato anterior' })),
    )
  }
  await render(h(Consumer))
  await click(document.getElementById('root').querySelector('button'))
  let resolveOld
  const pending = store.enContexto(() => new Promise((resolve) => { resolveOld = resolve }))
  const rejected = assert.rejects(pending, (error) => error.name === 'AbortError')
  await act(async () => store.cambiarNegocio(2))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.body.style.overflow, 'clip')
  resolveOld({ negocio_id: 1 })
  await rejected
  await click(document.getElementById('root').querySelector('button'))
  await act(async () => store.expirar())
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.getElementById('root').textContent, '')
  console.log('OK rutas: cada permiso alternativo, caso sin permiso y otro negocio. Contexto/sesión desmontan el modal ocupado y descartan respuestas tardías.')
  assert.deepEqual(domErrors, [], 'No deben ocurrir errores del DOM durante la interacción.')
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
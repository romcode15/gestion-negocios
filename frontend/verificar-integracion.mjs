// Se ejecuta desde tools/verificar_postgres.py --integracion-frontend.
// Usa PostgreSQL/Django temporales y el proxy real de Vite; no sustituye la API.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React, { act } from 'react'

const target = process.env.INTEGRACION_API_URL
const password = process.env.INTEGRACION_PASSWORD
assert.ok(target && password, 'Ejecutar desde backend/tools/verificar_postgres.py --integracion-frontend.')
assert.equal(process.env.VITE_API_MODE, 'http')
const server = await createServer({
  envDir: false, appType: 'custom',
  server: { host: '127.0.0.1', port: 0, hmr: false, ws: false, proxy: { '/api': { target, changeOrigin: false } } },
})
await server.listen()
const origin = 'http://127.0.0.1:' + server.httpServer.address().port
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: origin })
const originals = new Map()
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'PopStateEvent', 'sessionStorage', 'localStorage', 'Node', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] })
}
originals.set('requestAnimationFrame', Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'))
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => setTimeout(fn, 0) })
const nativeFetch = globalThis.fetch
const requests = []
globalThis.fetch = async (path, options = {}) => {
  if (typeof path !== 'string' || !path.startsWith('/api/')) return nativeFetch(path, options)
  const headers = new Headers(options.headers)
  headers.set('Cookie', dom.cookieJar.getCookieStringSync(origin))
  headers.set('Origin', origin)
  const response = await nativeFetch(origin + path, { ...options, headers })
  for (const cookie of response.headers.getSetCookie()) dom.cookieJar.setCookieSync(cookie, origin)
  requests.push({ path, method: options.method ?? 'GET', status: response.status })
  return response
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
let root = createRoot(document.getElementById('root'))
const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
async function inAct(action) {
  let value
  await act(async () => { value = await action() })
  return value
}
async function until(predicate, label) {
  const deadline = Date.now() + 15000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Tiempo agotado: ' + label + '\n' + document.body.textContent)
    await act(async () => { await pause() })
  }
}
const field = (container, name) => {
  const element = container.querySelector('[name="' + name + '"], #' + name)
  assert.ok(element, 'No existe campo ' + name)
  return element
}
async function change(container, name, value) {
  const element = field(container, name)
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function submit(form, predicate, label) {
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
  await until(predicate, label)
}
async function logout() {
  const button = document.querySelector('button[aria-label="Cerrar sesión"]')
  await act(async () => button.click())
  await until(() => document.querySelector('input[name="password"]') && !document.querySelector('button[aria-label="Cerrar sesión"]'), 'logout')
}
async function login(username) {
  await change(document, 'username', username)
  await change(document, 'password', password)
  await submit(document.querySelector('form'), () => document.querySelector('button[aria-label="Cerrar sesión"]'), 'login ' + username)
}
try {
  const load = (p) => server.ssrLoadModule('/src/' + p)
  const { default: App } = await load('App.tsx')
  const { navegar } = await load('app/routes/navigation.ts')
  const auth = await load('features/auth/api.ts')
  const roles = await load('features/roles/api.ts')
  const members = await load('features/membresias/api.ts')
  const go = async (path, predicate) => {
    await act(async () => navegar(path))
    await until(predicate, path)
  }
  await act(async () => root.render(React.createElement(App)))
  await until(() => document.querySelector('input[name="password"]'), 'formulario de login')
  await login('integracion_plataforma')
  await go('/plataforma', () => document.querySelector('input[name="tipo"]'))
  const accountForm = () => document.querySelector('form [name="username"]').closest('form')
  const businessForm = () => document.querySelector('form [name="nombre"]').closest('form')
  await change(accountForm(), 'username', 'integracion_admin')
  await change(accountForm(), 'password', password)
  await submit(accountForm(), () => field(accountForm(), 'password').value === '', 'crear administrador')
  const adminId = field(businessForm(), 'administrador_id').value
  assert.ok(Number(adminId) > 0)
  for (const [nombre, tipo] of [['Tienda integral', 'tienda'], ['Ferretería integral', 'ferreteria']]) {
    await change(businessForm(), 'nombre', nombre)
    await change(businessForm(), 'tipo', tipo)
    await change(businessForm(), 'administrador_id', adminId)
    await submit(businessForm(), () => businessForm().textContent.includes('Negocio ' + nombre + ' creado.'), 'crear ' + nombre)
  }
  await change(accountForm(), 'username', 'integracion_existente')
  await change(accountForm(), 'password', password)
  await submit(accountForm(), () => field(accountForm(), 'password').value === '', 'crear cuenta existente')
  await logout()
  await login('integracion_admin')
  const session = await inAct(() => auth.obtenerSesion())
  assert.equal(session.negocios.length, 2)
  const shop = session.negocios[0], hardware = session.negocios[1]
  await go('/negocio/roles', () => document.querySelectorAll('input[type="checkbox"]').length === shop.permisos.length)
  const roleForm = document.querySelector('form [name="nombre"]').closest('form')
  await change(roleForm, 'nombre', 'Lector integral')
  for (const label of roleForm.querySelectorAll('label')) {
    if (['listar_roles', 'listar_membresias'].includes(label.textContent.trim())) {
      await act(async () => label.querySelector('input').click())
    }
  }
  await submit(roleForm, () => roleForm.textContent.includes('creado correctamente'), 'crear rol')
  await until(() => document.querySelector('table')?.textContent.includes('Lector integral'), 'actualizar listado de roles')
  const reader = (await inAct(() => roles.listarRoles(shop.id))).results.find((r) => r.nombre === 'Lector integral')
  assert.ok(reader)
  await go('/negocio/membresias', () => document.querySelector('select[name="rol_id"] option[value="' + reader.id + '"]') && document.querySelector('table'))
  const memberForm = () => document.querySelector('form [name="username"]').closest('form')
  await act(async () => memberForm().querySelector('input[value="existente"]').click())
  await change(memberForm(), 'username', 'integracion_existente')
  await change(memberForm(), 'rol_id', String(reader.id))
  await submit(memberForm(), () => memberForm().textContent.includes('integracion_existente incorporado'), 'incorporar cuenta existente')
  await act(async () => memberForm().querySelector('input[value="nueva"]').click())
  await change(memberForm(), 'username', 'integracion_nueva')
  await change(memberForm(), 'password', password)
  await change(memberForm(), 'rol_id', String(reader.id))
  await submit(memberForm(), () => memberForm().textContent.includes('integracion_nueva incorporado'), 'incorporar cuenta nueva')
  assert.equal((await inAct(() => members.listarMembresias(shop.id))).count, 3)
  await until(() => document.querySelector('form[aria-label="Cambiar rol de integracion_admin"]'), 'tabla de miembros')
  const own = document.querySelector('form[aria-label="Cambiar rol de integracion_admin"]')
  await change(own, 'rol_id', String(reader.id))
  await submit(own, () => own.textContent.includes('conservar un administrador activo'), 'proteger último administrador')
  const existing = document.querySelector('form[aria-label="Cambiar rol de integracion_existente"]')
  await change(existing, 'rol_id', String(shop.rol_id))
  await submit(existing, () => document.body.textContent.includes('Rol de integracion_existente actualizado'), 'crear respaldo administrador')
  await until(() => document.querySelector('form[aria-label="Cambiar rol de integracion_admin"]'), 'recargar miembros')
  const ownAgain = document.querySelector('form[aria-label="Cambiar rol de integracion_admin"]')
  await change(ownAgain, 'rol_id', String(reader.id))
  await submit(ownAgain, () => document.querySelector('#negocio-activo') && !document.body.textContent.includes('Incorporar miembro'), 'degradación con respaldo y refresco de sesión')
  await change(document, 'negocio-activo', String(hardware.id))
  await until(() => document.querySelector('table') && document.body.textContent.includes('Incorporar miembro'), 'cambio de negocio')
  assert.doesNotMatch(document.querySelector('table').textContent, /integracion_existente|integracion_nueva/)
  await logout()
  await login('integracion_nueva')
  await go('/negocio/roles', () => document.querySelector('table'))
  assert.doesNotMatch(document.body.textContent, /Crear rol/)
  await inAct(() => assert.rejects(() => roles.listarRoles(hardware.id), (e) => e.status === 403 && e.code === 'permission_denied'))
  await act(async () => root.unmount())
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(App)))
  await until(() => document.querySelector('table'), 'restaurar sesión al recargar')
  assert.match(document.querySelector('table').textContent, /Lector integral/)
  await logout()
  await act(async () => { await assert.rejects(() => auth.obtenerSesion(), (e) => e.code === 'not_authenticated') })

  // La cuenta de respaldo prepara actores con permisos mínimos. Las acciones
  // se comprueban después desde React con HTTP real y sin listar_roles.
  await login('integracion_existente')
  const permissions = []
  for (let page = 1; ; page++) {
    const result = await inAct(() => roles.listarPermisos(shop.id, { page }))
    permissions.push(...result.results)
    if (!result.next) break
  }
  const empty = await inAct(() => roles.crearRol(shop.id, { nombre: 'Vacío integral', permiso_ids: [] }))
  for (const [username, codes] of [
    ['integracion_creador_roles', ['crear_rol']],
    ['integracion_creador_miembros', ['crear_membresia']],
    ['integracion_asignador', ['listar_membresias', 'asignar_rol']],
  ]) {
    const limited = await inAct(() => roles.crearRol(shop.id, { nombre: username,
      permiso_ids: permissions.filter((p) => codes.includes(p.codigo)).map((p) => p.id) }))
    await inAct(() => members.crearMembresia(shop.id, { username, password, rol_id: limited.id }))
  }
  await logout()
  let start = requests.length
  await login('integracion_creador_roles')
  await go('/negocio/roles', () => document.querySelector('form [name="nombre"]'))
  const limitedRoleForm = document.querySelector('form [name="nombre"]').closest('form')
  await change(limitedRoleForm, 'nombre', 'Creado sin listar integral')
  await submit(limitedRoleForm, () => limitedRoleForm.textContent.includes('creado correctamente'), 'crear rol sin listar_roles')
  assert.equal(document.querySelector('table'), null)
  assert.equal(requests.slice(start).some((r) => r.method === 'GET' && r.path.includes('/roles/?')), false)
  await logout()
  start = requests.length
  await login('integracion_creador_miembros')
  await go('/negocio/membresias', () => document.querySelector('select[name="rol_id"] option[value="' + empty.id + '"]'))
  await change(memberForm(), 'username', 'integracion_alta_minima')
  await change(memberForm(), 'password', password)
  await change(memberForm(), 'rol_id', String(empty.id))
  await submit(memberForm(), () => memberForm().textContent.includes('integracion_alta_minima incorporado'), 'incorporar sin listar_roles')
  assert.equal(requests.slice(start).some((r) => r.method === 'GET' && r.path.includes('/roles/?')), false)
  await logout()
  start = requests.length
  await login('integracion_asignador')
  await go('/negocio/membresias', () => document.querySelector('form[aria-label="Cambiar rol de integracion_admin"] select option[value="' + empty.id + '"]'))
  const limitedChange = document.querySelector('form[aria-label="Cambiar rol de integracion_admin"]')
  await change(limitedChange, 'rol_id', String(empty.id))
  await submit(limitedChange, () => document.body.textContent.includes('Rol de integracion_admin actualizado'), 'asignar sin listar_roles')
  assert.equal(requests.slice(start).some((r) => r.method === 'GET' && r.path.includes('/roles/?')), false)
  await logout()
  assert.ok(requests.some((r) => r.path.includes('/roles/asignables/') && r.status === 200))
  assert.ok(requests.every((r) => r.status < 500))
  console.log('OK integración React DOM → Vite → Django → PostgreSQL: login/CSRF, usuarios, dos negocios, roles, ambas altas, último administrador, cambio de rol, permisos mínimos sin listar_roles, aislamiento, recarga y logout.')
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

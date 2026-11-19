import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React, { act } from 'react'
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' })
const originals = new Map()
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'PopStateEvent', 'sessionStorage']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}
originals.set('requestAnimationFrame', Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'))
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => setTimeout(fn, 0) })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const root = createRoot(document.getElementById('root'))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { await pause(15) }) }
const field = (container, name) => { const result = container.querySelector('[name="' + name + '"], #' + name); assert.ok(result, 'No existe campo ' + name); return result }
async function change(container, name, value) {
  const element = field(container, name)
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function submit(form, twice = false) {
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    if (twice) form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()

}
const button = (label) => { const result = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label); assert.ok(result, 'No existe botón ' + label); return result }
async function click(element) { await act(async () => element.click()); await flush() }
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const { default: App } = await load('App.tsx')
  const mock = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const users = await load('features/usuarios/api.ts')
  const negocios = await load('features/negocios/api.ts')
  const members = await load('features/membresias/api.ts')
  const roles = await load('features/roles/api.ts')
  const { ApiException } = await load('api/errors.ts')
  const { navegar } = await load('app/routes/navigation.ts')
  mock.reiniciarMocks(); mock.configurarMocks({ latencia: 0 })
  await act(async () => root.render(React.createElement(App)))
  await flush()
  assert.equal(document.querySelector('.toast'), null, 'Abrir el login sin sesión no debe avisar de expiración.')
  const { leerTema, aplicarTema } = await load('app/theme.ts')
  await click(document.querySelector('[aria-label="Activar modo oscuro"]'))
  assert.equal(document.documentElement.dataset.theme, 'dark')
  assert.equal(window.localStorage.getItem('gestion-negocios:theme'), 'dark')
  assert.ok(document.querySelector('[aria-label="Activar modo claro"]'))
  delete document.documentElement.dataset.theme
  assert.equal(leerTema(), 'dark')
  await act(async () => aplicarTema(leerTema()))
  await click(document.querySelector('[aria-label="Activar modo claro"]'))
  assert.equal(document.documentElement.dataset.theme, 'light')
  async function login(username) {
    await change(document, 'username', username)
    await change(document, 'password', 'Demo-12345!')
    await submit(document.querySelector('form'))
    assert.ok(document.querySelector('[aria-label="Cerrar sesión"]'))
  }
  async function go(path) { await act(async () => navegar(path)); await flush() }
  await login('plataforma')
  await go('/plataforma')
  assert.match(document.body.textContent, /Tienda Central/)
  assert.match(document.body.textContent, /Ferretería Norte/)
  const accountForm = () => document.querySelector('form [name="username"]').closest('form')
  const negocioForm = () => document.querySelector('form [name="nombre"]').closest('form')
  assert.equal(field(negocioForm(), 'administrador_id').options.length, 7)
  assert.ok(field(negocioForm(), 'administrador_id').querySelector('option[value="5"]'))
  assert.equal(negocioForm().querySelector('[aria-label="Paginación de cuentas"]'), null)
  await change(accountForm(), 'username', 'plataforma')
  await change(accountForm(), 'password', 'Valida-12345!')
  await submit(accountForm())
  assert.match(accountForm().textContent, /ya existe/)
  await change(accountForm(), 'username', 'ui_admin')
  await change(accountForm(), 'password', '123')
  await submit(accountForm())
  assert.match(accountForm().textContent, /8 caracteres/)
  await change(accountForm(), 'password', 'Valida-12345!')
  await submit(accountForm(), true)
  assert.equal((await users.listarUsuarios()).count, 7)
  const createdAdminId = field(negocioForm(), 'administrador_id').value
  assert.equal(field(negocioForm(), 'administrador_id').selectedOptions[0].textContent, 'ui_admin')
  assert.equal(field(accountForm(), 'password').value, '')
  await change(negocioForm(), 'nombre', 'Negocio DOM')
  await submit(negocioForm())
  assert.match(negocioForm().textContent, /Escribe el tipo/)
  assert.equal(document.activeElement, field(negocioForm(), 'tipo'))
  await change(negocioForm(), 'tipo', 'tienda')
  await submit(negocioForm(), true)
  assert.equal((await negocios.listarNegocios()).count, 3)
  // El primer grupo de paginación corresponde al listado, el segundo al selector.
  await click(document.querySelector('[aria-label="Paginación de negocios registrados"] button:last-child'))
  assert.match(document.querySelector('table').textContent, /Negocio DOM/)
  await change(negocioForm(), 'nombre', 'Entrada conservada')
  await change(negocioForm(), 'tipo', 'tienda')
  await change(negocioForm(), 'administrador_id', createdAdminId)
  const originalRequest = mock.mockTransport.request
  mock.mockTransport.request = async () => { throw new ApiException('network_error', 'Sin conexión') }
  try {
    await submit(negocioForm())
    assert.match(negocioForm().textContent, /No se pudo conectar/)
    assert.equal(field(negocioForm(), 'nombre').value, 'Entrada conservada')
    assert.equal(field(negocioForm(), 'administrador_id').value, createdAdminId)
  } finally { mock.mockTransport.request = originalRequest }
  await click(button('Cerrar sesión'))
  await login('admin_tienda')
  await roles.crearRol(1, { nombre: 'Rol integrado de dev', permiso_ids: [5] })
  await go('/negocio/roles')
  assert.match(document.querySelector('table').textContent, /Administrador de negocio/)
  assert.match(document.querySelector('table').textContent, /listar_roles/)
  await click(document.querySelector('[aria-label="Paginación de roles del negocio activo"] button:last-child'))
  assert.match(document.querySelector('table').textContent, /Rol integrado de dev/)
  await go('/negocio/membresias')
  assert.match(document.body.textContent, /Miembros del negocio/)
  assert.match(document.querySelector('table').textContent, /admin_tienda/)
  const memberForm = () => document.querySelector('form [name="username"]').closest('form')
  assert.match(field(memberForm(), 'rol_id').textContent, /Rol integrado de dev/)
  assert.equal(memberForm().querySelector('[aria-label="Paginación de roles"]'), null)
  await change(memberForm(), 'password', 'NoDebeQuedar')
  await click(memberForm().querySelector('input[value="existente"]'))
  assert.equal(memberForm().querySelector('[name="password"]'), null)
  await click(memberForm().querySelector('input[value="nueva"]'))
  assert.equal(field(memberForm(), 'password').value, '')
  await click(memberForm().querySelector('input[value="existente"]'))
  await change(memberForm(), 'username', 'existente')
  await change(memberForm(), 'rol_id', '4')
  await submit(memberForm(), true)
  assert.equal((await members.listarMembresias(1)).count, 3)
  await click(memberForm().querySelector('input[value="existente"]'))
  await change(memberForm(), 'username', 'existente')
  await change(memberForm(), 'rol_id', '4')
  await submit(memberForm())
  assert.match(memberForm().textContent, /ya pertenece/)
  await click(memberForm().querySelector('input[value="nueva"]'))
  assert.doesNotMatch(memberForm().textContent, /ya pertenece/)
  await change(memberForm(), 'username', 'ui_miembro')
  await change(memberForm(), 'password', 'Miembro-12345!')
  await change(memberForm(), 'rol_id', '4')
  await submit(memberForm(), true)
  assert.equal((await members.listarMembresias(1)).count, 4)
  // Al cambiar el rol propio se consulta me y desaparecen acciones ya no autorizadas.
  const row = [...document.querySelectorAll('tbody tr')].find((r) => r.querySelector('td').textContent === 'admin_tienda')
  const ownRoleForm = row.querySelector('form')
  await change(ownRoleForm, 'rol_id', '4')
  await submit(ownRoleForm)
  assert.match(ownRoleForm.textContent, /conservar un administrador activo/)
  assert.ok((await auth.obtenerSesion()).negocios[0].permisos.includes('asignar_rol'))
  await members.crearMembresia(1, { username: 'ui_respaldo', password: 'Respaldo-12345!', rol_id: 2 })
  await submit(ownRoleForm)
  assert.doesNotMatch(document.body.textContent, /Incorporar miembro/)
  assert.doesNotMatch(document.body.textContent, /Guardar rol/)
  assert.ok(!(await auth.obtenerSesion()).negocios[0].permisos.includes('asignar_rol'))
  await click(button('Cerrar sesión'))
  await login('compartido')
  let catalogRequests = 0
  const requestBeforeRoles = mock.mockTransport.request
  mock.mockTransport.request = async (options) => {
    if (options.path.includes('/permisos/')) catalogRequests++
    return requestBeforeRoles(options)
  }
  try {
    await go('/negocio/roles')
    assert.match(document.querySelector('table').textContent, /permisos \(IDs:/)
    assert.equal(catalogRequests, 0)
  } finally { mock.mockTransport.request = requestBeforeRoles }
  await go('/negocio/membresias')
  mock.configurarMocks({ latencia: 30 })
  await change(document, 'negocio-activo', '2')
  await flush()
  assert.match(document.body.textContent, /Acceso denegado/)
  assert.doesNotMatch(document.body.textContent, /admin_tienda/)
  await change(document, 'negocio-activo', '1')
  await change(document, 'negocio-activo', '2')
  await flush()
  assert.doesNotMatch(document.body.textContent, /admin_tienda/)
  mock.configurarMocks({ latencia: 0, escenario: 'not_authenticated' })
  await act(async () => { await assert.rejects(() => members.listarMembresias(1), (error) => error.code === 'not_authenticated') })
  await flush()
  assert.match(document.body.textContent, /Acceso a la plataforma/)
  assert.equal(document.querySelector('table'), null)
  assert.equal(document.querySelectorAll('.toast-warning').length, 1)
  assert.match(document.querySelector('.toast-warning').textContent, /Tu sesión terminó/)
  assert.equal(document.querySelector('.login-card .error'), null)
  await click(document.querySelector('[aria-label="Cerrar notificación"]'))
  assert.equal(document.querySelector('.toast'), null)

  // Regresiones de permisos mínimos: se preparan los datos por la API, luego
  // cada operación se ejecuta desde los formularios reales de React.
  await auth.iniciarSesion({ username: 'ui_respaldo', password: 'Respaldo-12345!' })
  const emptyRole = await roles.crearRol(1, { nombre: 'Vacío para pruebas de UI', permiso_ids: [] })
  for (const [username, permiso_ids] of [
    ['ui_creador_roles', [6]], ['ui_creador_miembros', [8]], ['ui_asignador', [7, 9]],
  ]) {
    const limited = await roles.crearRol(1, { nombre: username, permiso_ids })
    await members.crearMembresia(1, { username, password: 'Demo-12345!', rol_id: limited.id })
  }
  await auth.cerrarSesion()
  const requests = []
  const beforeMinimalPermissions = mock.mockTransport.request
  mock.mockTransport.request = async (options) => {
    requests.push(options)
    return beforeMinimalPermissions(options)
  }
  try {
    await login('ui_creador_roles')
    await go('/negocio/roles')
    const roleForm = document.querySelector('form [name="nombre"]').closest('form')
    assert.equal(document.querySelector('table'), null)
    await change(roleForm, 'nombre', 'Creado sin listar roles')
    await submit(roleForm)
    assert.match(roleForm.textContent, /creado correctamente/)
    assert.equal(requests.some((r) => r.method === 'GET' && r.path.includes('/roles/?')), false)
    await click(button('Cerrar sesión'))

    requests.length = 0
    await login('ui_creador_miembros')
    await go('/negocio/membresias')
    await change(memberForm(), 'username', 'ui_miembro_sin_listar')
    await change(memberForm(), 'password', 'Demo-12345!')
    await change(memberForm(), 'rol_id', String(emptyRole.id))
    await submit(memberForm())
    assert.match(memberForm().textContent, /incorporado/)
    assert.equal(requests.some((r) => r.path.includes('/roles/asignables/')), true)
    assert.equal(requests.some((r) => r.method === 'GET' && r.path.includes('/roles/?')), false)
    await click(button('Cerrar sesión'))

    requests.length = 0
    await login('ui_asignador')
    await go('/negocio/membresias')
    const target = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('compartido'))
    const changeForm = target.querySelector('form')
    await change(changeForm, 'rol_id', String(emptyRole.id))
    await submit(changeForm)
    assert.match(document.body.textContent, /Rol de compartido actualizado/)
    assert.equal(requests.some((r) => r.method === 'GET' && r.path.includes('/roles/?')), false)
  } finally { mock.mockTransport.request = beforeMinimalPermissions }
  console.log('OK DOM cierre fase 1: crear roles, incorporar miembros y cambiar roles sin listar_roles ni consultas prohibidas.')
  console.log('OK DOM #14: duplicado, contraseña inválida, selección automática, foco, envío único, paginación y fallo de red conservando entradas.')
  console.log('OK DOM #15: cambio de modo limpia contraseña/errores, dos modalidades, envío único, rol propio refresca permisos, cambio rápido de negocio y expiración.')
  console.log('OK integración dev: listado de roles, nombres de permisos, paginación compartida y catálogo restringido a crear_rol.')
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

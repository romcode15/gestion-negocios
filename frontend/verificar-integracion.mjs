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
// Instrumentación de red: todas las respuestas proceden de Django. Solo se
// retiene una respuesta ya recibida, se pierde su entrega o se omite un header.
let intercept = null
const releases = new Set()
function nextResponse(matches, receive) {
  assert.equal(intercept, null, 'Ya hay una intervención de red pendiente.')
  intercept = { matches, receive }
}
function holdNext(matches) {
  let release, started
  const waiting = new Promise((resolve) => { release = resolve })
  const received = new Promise((resolve) => { started = resolve })
  nextResponse(matches, async (response) => {
    // Consumir el cuerpo real antes de cambiar el contexto y abortar su signal.
    const buffered = await response.clone().arrayBuffer()
    started()
    await waiting
    return new Response(buffered, { status: response.status, headers: response.headers })
  })
  releases.add(release)
  return { received, release: () => { releases.delete(release); release() } }
}
let omitCsrf = false
globalThis.fetch = async (path, options = {}) => {
  if (typeof path !== 'string' || !path.startsWith('/api/')) return nativeFetch(path, options)
  const headers = new Headers(options.headers)
  headers.set('Cookie', dom.cookieJar.getCookieStringSync(origin))
  headers.set('Origin', origin)
  if (omitCsrf && options.method === 'POST' && path.includes('/movimientos/')) {
    headers.delete('X-CSRFToken')
    omitCsrf = false
  }
  const response = await nativeFetch(origin + path, { ...options, headers })
  for (const cookie of response.headers.getSetCookie()) dom.cookieJar.setCookieSync(cookie, origin)
  const request = { path, method: options.method ?? 'GET', status: response.status }
  requests.push(request)
  if (intercept?.matches(request)) {
    const current = intercept
    intercept = null
    return current.receive(response)
  }
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
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
      : element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
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

  // Fase 2: los mismos formularios de catálogo e inventario contra la API real.
  const categorias = await load('features/categorias/api.ts')
  const productos = await load('features/productos/api.ts')
  const existencias = await load('features/existencias/api.ts')
  const movimientos = await load('features/movimientos/api.ts')
  const dialog = () => document.querySelector('[role="dialog"]')
  async function clickButton(text) {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
    assert.ok(button, 'No existe el botón ' + text)
    await act(async () => button.click())
  }
  await login('integracion_existente')
  await go('/negocio/categorias', () => document.body.textContent.includes('Crear categoría'))
  await clickButton('Crear categoría')
  await until(() => dialog()?.querySelector('[name="nombre"]'), 'modal de categoría')
  await change(dialog(), 'nombre', 'Alimentos HTTP')
  await submit(dialog().querySelector('form'), () => !dialog(), 'crear categoría desde modal')
  const categoria = (await inAct(() => categorias.listarCategorias(shop.id))).results[0]
  assert.equal(categoria.nombre, 'Alimentos HTTP')
  await go('/negocio/productos', () => document.body.textContent.includes('Crear producto'))
  await clickButton('Crear producto')
  await until(() => dialog()?.querySelector('select[name="categoria_id"] option[value="' + categoria.id + '"]'), 'opciones de categoría reales')
  for (const [name, value] of [['sku', 'HTTP-ARROZ'], ['nombre', 'Arroz HTTP'], ['categoria_id', String(categoria.id)],
    ['unidad', 'kg'], ['precio_venta', '12.50'], ['stock_minimo', '2.000']]) await change(dialog(), name, value)
  await submit(dialog().querySelector('form'), () => !dialog(), 'crear producto desde modal')
  const producto = (await inAct(() => productos.listarProductos(shop.id))).results[0]
  const stock = () => inAct(() => existencias.obtenerExistencia(shop.id, producto.id))
  assert.equal((await stock()).cantidad, '0.000')
  await go('/negocio/existencias', () => document.querySelector('table')?.textContent.includes('HTTP-ARROZ'))
  assert.match(document.querySelector('table').textContent, /0\.000/)
  await go('/negocio/movimientos', () => document.querySelector('button[aria-label="Registrar entrada"]'))
  async function abrirMovimiento(tipo) {
    await act(async () => document.querySelector('button[aria-label="Registrar ' + tipo + '"]').click())
    await until(() => dialog()?.querySelector('select[name="producto_id"] option[value="' + producto.id + '"]'), 'opciones de producto')
    await change(dialog(), 'producto_id', String(producto.id))
  }
  await abrirMovimiento('entrada')
  await change(dialog(), 'cantidad', '2.500')
  await change(dialog(), 'motivo', 'Entrada HTTP')
  await submit(dialog().querySelector('form'), () => !dialog(), 'entrada desde modal')
  assert.equal((await stock()).cantidad, '2.500')
  await abrirMovimiento('salida')
  await change(dialog(), 'cantidad', '0.500')
  await change(dialog(), 'motivo', 'Salida HTTP')
  await submit(dialog().querySelector('form'), () => !dialog(), 'salida desde modal')
  assert.equal((await stock()).cantidad, '2.000')
  const antesSalidaFallida = {
    saldo: await stock(), historial: await inAct(() => movimientos.listarMovimientos(shop.id)),
  }
  await abrirMovimiento('salida')
  await change(dialog(), 'cantidad', '3.000')
  await change(dialog(), 'motivo', 'Salida insuficiente HTTP')
  await submit(dialog().querySelector('form'), () => dialog()?.textContent.includes('Saldo insuficiente'), 'error de saldo insuficiente')
  assert.equal((await stock()).cantidad, '2.000')
  assert.deepEqual(await stock(), antesSalidaFallida.saldo)
  assert.deepEqual(await inAct(() => movimientos.listarMovimientos(shop.id)), antesSalidaFallida.historial)
  await act(async () => dialog().querySelector('button[aria-label="Cerrar diálogo"]').click())
  await act(async () => document.querySelector('button[aria-label="Ajustar inventario"]').click())
  await until(() => dialog()?.querySelector('select[name="producto_id"] option[value="' + producto.id + '"]'), 'productos para ajuste')
  await change(dialog(), 'producto_id', String(producto.id))
  await until(() => dialog()?.textContent.includes('2.000'), 'saldo y versión reales')
  await change(dialog(), 'stock_objetivo', '3.250')
  await change(dialog(), 'motivo', 'Conteo HTTP')
  await inAct(() => movimientos.registrarMovimiento(shop.id, { producto_id: producto.id, tipo: 'entrada',
    cantidad: '1.000', motivo: 'Entrada concurrente HTTP', clave_operacion: crypto.randomUUID() }))
  await submit(dialog().querySelector('form'), () => dialog()?.textContent.includes('Actualizar saldo'), 'conflicto de versión real')
  await clickButton('Actualizar saldo')
  await until(() => dialog()?.textContent.includes('3.000'), 'actualizar saldo tras conflicto')
  await submit(dialog().querySelector('form'), () => !dialog(), 'ajuste con versión actualizada')
  assert.equal((await stock()).cantidad, '3.250')
  await until(() => document.querySelector('table')?.textContent.includes('Conteo HTTP'), 'historial actualizado')
  const repetible = { producto_id: producto.id, tipo: 'entrada', cantidad: '0.250', motivo: 'Reintento HTTP', clave_operacion: crypto.randomUUID() }
  const movimiento = await inAct(() => movimientos.registrarMovimiento(shop.id, repetible))
  const repetido = await inAct(() => movimientos.registrarMovimiento(shop.id, repetible))
  assert.equal(repetido.id, movimiento.id)
  assert.equal((await stock()).cantidad, '3.500')
  assert.equal((await stock()).version, 5)
  assert.equal((await inAct(() => movimientos.listarMovimientos(shop.id))).count, 5)
  await inAct(() => productos.actualizarProducto(shop.id, producto.id, { activo: false }))
  const inactiveBefore = { saldo: await stock(), historial: await inAct(() => movimientos.listarMovimientos(shop.id)) }
  assert.equal((await inAct(() => movimientos.registrarMovimiento(shop.id, repetible))).id, movimiento.id)
  await inAct(() => assert.rejects(() => movimientos.registrarMovimiento(shop.id,
    { ...repetible, clave_operacion: crypto.randomUUID() }), (e) => e.code === 'validation_error' && Array.isArray(e.errors.producto_id)))
  assert.deepEqual({ saldo: await stock(), historial: await inAct(() => movimientos.listarMovimientos(shop.id)) }, inactiveBefore)
  const stockOnly = await inAct(() => roles.crearRol(shop.id, { nombre: 'Solo stock HTTP',
    permiso_ids: [permissions.find((p) => p.codigo === 'consultar_existencias').id] }))
  await inAct(() => members.crearMembresia(shop.id, { username: 'integracion_stock', password, rol_id: stockOnly.id }))
  await logout()
  start = requests.length
  await login('integracion_stock')
  await go('/negocio/existencias', () => document.querySelector('table')?.textContent.includes('HTTP-ARROZ'))
  assert.match(document.querySelector('table').textContent, /3\.500/)
  assert.match(document.querySelector('table').textContent, /Inactivo/)
  assert.equal(requests.slice(start).some((r) => r.path.includes('/productos/') || r.path.includes('/categorias/')), false)
  await inAct(() => assert.rejects(() => existencias.listarExistencias(hardware.id), (e) => e.code === 'permission_denied'))
  await logout()
  console.log('OK fase 2 HTTP real: modales de categoría/producto, existencia cero, entradas/salidas, saldo insuficiente, ajuste y conflicto, historial, idempotencia y permiso mínimo de existencias.')

  async function all(loader) {
    const result = []
    for (let page = 1; ; page++) {
      const current = await inAct(() => loader({ page }))
      result.push(...current.results)
      if (!current.next) return result
    }
  }
  const snapshot = async () => ({
    saldo: await stock(), historial: await all((q) => movimientos.listarMovimientos(shop.id, q)),
  })
  const fail = (action, code, status) => inAct(() => assert.rejects(action,
    (e) => e.code === code && e.status === status))
  const closeDialog = async () => {
    await act(async () => dialog().querySelector('button[aria-label="Cerrar diálogo"]').click())
    await until(() => !dialog(), 'cerrar modal')
  }
  const inventoryPost = (r) => r.method === 'POST' && r.path.endsWith('/movimientos/')
  await login('integracion_existente')
  // Reactivar para las siguientes operaciones; el historial anterior no cambia.
  await inAct(() => productos.actualizarProducto(shop.id, producto.id, { activo: true }))
  const initialSnapshot = await snapshot()
  await fail(() => categorias.actualizarCategoria(shop.id, categoria.id, { activo: false }), 'validation_error', 400)
  await fail(() => productos.actualizarProducto(shop.id, producto.id, { unidad: 'unidad' }), 'validation_error', 400)
  assert.deepEqual(await snapshot(), initialSnapshot)
  assert.equal((await inAct(() => categorias.obtenerCategoria(shop.id, categoria.id))).activo, true)
  assert.equal((await inAct(() => productos.obtenerProducto(shop.id, producto.id))).unidad, 'kg')

  // Editar mediante los formularios reales y conservar datos ante duplicados.
  await go('/negocio/categorias', () => document.querySelector('table')?.textContent.includes('Alimentos HTTP'))
  await clickButton('Editar')
  await until(() => dialog()?.querySelector('[name="descripcion"]'), 'editar categoría')
  await change(dialog(), 'descripcion', 'Edición persistida F3')
  await submit(dialog().querySelector('form'), () => !dialog(), 'guardar categoría')
  assert.equal((await inAct(() => categorias.obtenerCategoria(shop.id, categoria.id))).descripcion, 'Edición persistida F3')
  await clickButton('Crear categoría')
  await change(dialog(), 'nombre', categoria.nombre)
  await submit(dialog().querySelector('form'), () => dialog()?.querySelector('[aria-invalid="true"]'), 'nombre duplicado')
  assert.equal(field(dialog(), 'nombre').value, categoria.nombre)
  await closeDialog()
  await go('/negocio/productos', () => document.querySelector('table')?.textContent.includes('HTTP-ARROZ'))
  await clickButton('Editar')
  await until(() => dialog()?.querySelector('[name="precio_venta"]'), 'editar producto')
  await change(dialog(), 'precio_venta', '13.20')
  await submit(dialog().querySelector('form'), () => !dialog(), 'guardar producto')
  assert.equal((await inAct(() => productos.obtenerProducto(shop.id, producto.id))).precio_venta, '13.20')
  assert.deepEqual(await stock(), initialSnapshot.saldo)

  // Respuesta perdida después del commit: el formulario conserva su UUID.
  await go('/negocio/movimientos', () => document.querySelector('button[aria-label="Registrar entrada"]'))
  await abrirMovimiento('entrada')
  await change(dialog(), 'cantidad', '0.125')
  await change(dialog(), 'motivo', 'Respuesta perdida F3')
  nextResponse(inventoryPost, async (response) => {
    assert.equal(response.status, 201)
    await response.arrayBuffer()
    throw new TypeError('Entrega interrumpida después de confirmar en Django')
  })
  start = requests.length
  const retryBefore = await snapshot()
  await submit(dialog().querySelector('form'), () => dialog()?.textContent.includes('Reintentar'), 'fallo de entrega real')
  const confirmed = await snapshot()
  assert.equal(confirmed.historial.length, retryBefore.historial.length + 1)
  assert.equal(requests.slice(start).filter(inventoryPost).length, 1, 'No debe reintentar automáticamente')
  await clickButton('Reintentar')
  await until(() => !dialog(), 'reintento manual con mismo UUID')
  assert.deepEqual(await snapshot(), confirmed)
  assert.equal(requests.slice(start).filter(inventoryPost).length, 2)

  // CSRF real: omitir una cabecera, comprobar 403 y repetir manualmente.
  await abrirMovimiento('entrada')
  await change(dialog(), 'cantidad', '0.125')
  await change(dialog(), 'motivo', 'CSRF recuperado F3')
  const csrfBefore = await snapshot()
  omitCsrf = true
  start = requests.length
  await submit(dialog().querySelector('form'), () => dialog()?.textContent.includes('Se renovó'), 'CSRF rechazado por Django')
  assert.deepEqual(await snapshot(), csrfBefore)
  assert.equal(requests.slice(start).filter(inventoryPost).length, 1)
  assert.ok(requests.slice(start).some((r) => r.path.endsWith('/auth/csrf/') && r.status === 204))
  await clickButton('Reintentar')
  await until(() => !dialog(), 'reenvío manual tras CSRF')
  assert.equal((await snapshot()).historial.length, csrfBefore.historial.length + 1)

  // Busy y doble envío mientras Django ya confirmó y falta entregar la respuesta.
  await abrirMovimiento('entrada')
  await change(dialog(), 'cantidad', '0.125')
  await change(dialog(), 'motivo', 'Envío único F3')
  const heldWrite = holdNext(inventoryPost)
  const busyForm = dialog().querySelector('form')
  start = requests.length
  await act(async () => {
    busyForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    busyForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await heldWrite.received
  })
  assert.equal(busyForm.getAttribute('aria-busy'), 'true')
  assert.ok(dialog().querySelector('button[aria-label="Cerrar diálogo"]').disabled)
  await act(async () => dialog().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.ok(dialog())
  await act(async () => heldWrite.release())
  await until(() => !dialog(), 'respuesta de envío único')
  assert.equal(requests.slice(start).filter(inventoryPost).length, 1)

  // Las opciones funcionan sin permisos de listados generales.
  const minimal = [
    ['integracion_producto_minimo', ['crear_producto']],
    ['integracion_entrada_minima', ['registrar_entrada']],
    ['integracion_ajuste_minimo', ['ajustar_inventario']],
    ['integracion_historial_minimo', ['listar_movimientos']],
  ]
  for (const [username, codes] of minimal) {
    const permiso_ids = codes.map((code) => {
      const permiso = permissions.find((p) => p.codigo === code)
      assert.ok(permiso, 'Permiso no disponible: ' + code)
      return permiso.id
    })
    const role = await inAct(() => roles.crearRol(shop.id, { nombre: username, permiso_ids }))
    await inAct(() => members.crearMembresia(shop.id, { username, password, rol_id: role.id }))
  }
  const originalAdmin = (await all((q) => members.listarMembresias(shop.id, q))).find((m) => m.usuario.username === 'integracion_admin')
  await inAct(() => members.cambiarRolMembresia(shop.id, originalAdmin.id, { rol_id: shop.rol_id }))
  await logout()
  start = requests.length
  await login('integracion_producto_minimo')
  await go('/negocio/productos', () => document.body.textContent.includes('Crear producto'))
  await clickButton('Crear producto')
  await until(() => dialog()?.querySelector('select[name="categoria_id"] option[value="' + categoria.id + '"]'), 'opciones con crear_producto')
  for (const [name, value] of [['sku', 'SOLO-CREAR'], ['nombre', 'Producto mínimo F3'], ['categoria_id', String(categoria.id)], ['precio_venta', '1.00']]) await change(dialog(), name, value)
  await submit(dialog().querySelector('form'), () => !dialog(), 'alta sin listados generales')
  assert.equal(document.querySelector('table'), null)
  assert.equal(requests.slice(start).some((r) => r.method === 'GET' && /\/(productos|categorias)\/\?/.test(r.path)), false)
  await fail(() => productos.listarProductos(shop.id), 'permission_denied', 403)
  await logout()
  start = requests.length
  await login('integracion_entrada_minima')
  await go('/negocio/movimientos', () => document.querySelector('button[aria-label="Registrar entrada"]'))
  await abrirMovimiento('entrada')
  await change(dialog(), 'cantidad', '0.125')
  await change(dialog(), 'motivo', 'Entrada con permiso mínimo F3')
  await submit(dialog().querySelector('form'), () => !dialog(), 'entrada sin listar productos ni movimientos')
  assert.equal(requests.slice(start).some((r) => r.method === 'GET' && /\/(productos|movimientos|existencias)\/\?/.test(r.path)), false)
  await fail(() => movimientos.registrarMovimiento(shop.id, { ...repetible, clave_operacion: crypto.randomUUID(), tipo: 'salida' }), 'permission_denied', 403)
  await logout()
  start = requests.length
  await login('integracion_ajuste_minimo')
  await go('/negocio/movimientos', () => document.querySelector('button[aria-label="Ajustar inventario"]'))
  await act(async () => document.querySelector('button[aria-label="Ajustar inventario"]').click())
  await until(() => dialog()?.querySelector('select[name="producto_id"] option[value="' + producto.id + '"]'), 'opciones para ajuste mínimo')
  await change(dialog(), 'producto_id', String(producto.id))
  await until(() => dialog()?.textContent.includes('Versión:'), 'detalle autorizado sin listado')
  await change(dialog(), 'stock_objetivo', '8.000')
  await change(dialog(), 'motivo', 'Ajuste mínimo F3')
  await submit(dialog().querySelector('form'), () => !dialog(), 'ajuste sin listados generales')
  assert.equal(requests.slice(start).some((r) => r.method === 'GET' && /\/(existencias|movimientos|productos)\/\?/.test(r.path)), false)
  await logout()
  start = requests.length
  await login('integracion_historial_minimo')
  await go('/negocio/movimientos', () => document.querySelector('table')?.textContent.includes('Ajuste mínimo F3'))
  const filters = document.querySelector('form[aria-label="Filtros del historial"]')
  await change(filters, 'search', 'HTTP-ARROZ')
  await change(filters, 'tipo', 'entrada')
  await submit(filters, () => requests.slice(start).some((r) => r.path.includes('tipo=entrada')), 'filtros reales de historial')
  await until(() => document.querySelector('table') && !document.querySelector('table').textContent.includes('Ajuste mínimo F3'), 'historial filtrado')
  assert.equal(requests.slice(start).some((r) => r.path.includes('/productos/') || r.path.includes('/existencias/')), false)
  await clickButton('Siguiente')
  await until(() => requests.slice(start).some((r) => r.path.includes('page=2') && r.path.includes('tipo=entrada')), 'paginación con filtros')
  await logout()

  // Cuenta compartida: dos negocios con producto homónimo y respuestas tardías.
  await login('integracion_admin')
  await change(document, 'negocio-activo', String(hardware.id))
  const otherCategory = await inAct(() => categorias.crearCategoria(hardware.id, { nombre: 'Alimentos HTTP' }))
  const otherProduct = await inAct(() => productos.crearProducto(hardware.id, { categoria_id: otherCategory.id,
    sku: 'HTTP-ARROZ', nombre: 'Arroz de ferretería F3', unidad: 'kg', precio_venta: '1.00' }))
  const otherStock = await inAct(() => existencias.obtenerExistencia(hardware.id, otherProduct.id))
  await change(document, 'negocio-activo', String(shop.id))
  await go('/negocio/movimientos', () => document.querySelector('button[aria-label="Registrar entrada"]'))
  const heldOptions = holdNext((r) => r.path.includes('/negocios/' + shop.id + '/productos/opciones/'))
  await act(async () => {
    document.querySelector('button[aria-label="Registrar entrada"]').click()
  })
  await act(async () => { await heldOptions.received })
  await change(document, 'negocio-activo', String(hardware.id))
  await until(() => !dialog(), 'cambio de negocio desmonta modal con consulta pendiente')
  await act(async () => heldOptions.release())
  await act(async () => document.querySelector('button[aria-label="Registrar entrada"]').click())
  // Esperar opciones del contexto actual sin aceptar las de tienda.
  await until(() => dialog()?.querySelector('option[value="' + otherProduct.id + '"]'), 'opciones de ferretería')
  assert.equal(dialog().querySelector('option[value="' + producto.id + '"]'), null)
  await closeDialog()
  await fail(() => existencias.obtenerExistencia(hardware.id, producto.id), 'not_found', 404)
  await fail(() => movimientos.registrarMovimiento(hardware.id, { ...repetible, clave_operacion: crypto.randomUUID() }), 'validation_error', 400)
  assert.deepEqual(await inAct(() => existencias.obtenerExistencia(hardware.id, otherProduct.id)), otherStock)
  assert.equal((await inAct(() => movimientos.listarMovimientos(hardware.id))).count, 0)
  await go('/negocio/existencias', () => document.querySelector('table')?.textContent.includes('Arroz de ferretería F3'))
  await act(async () => root.unmount())
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(App)))
  await until(() => document.querySelector('#negocio-activo'), 'restaurar sesión al recargar fase 2')
  await change(document, 'negocio-activo', String(hardware.id))
  await until(() => document.querySelector('table')?.textContent.includes('Arroz de ferretería F3'), 'recarga conserva datos persistidos')
  await change(document, 'negocio-activo', String(shop.id))
  await go('/negocio/movimientos', () => document.querySelector('button[aria-label="Registrar entrada"]'))
  const heldLogout = holdNext((r) => r.path.includes('/negocios/' + shop.id + '/productos/opciones/'))
  await act(async () => document.querySelector('button[aria-label="Registrar entrada"]').click())
  await act(async () => { await heldLogout.received })
  await logout()
  await act(async () => heldLogout.release())
  assert.equal(dialog(), null)
  assert.equal(document.body.style.overflow, '')
  await fail(() => auth.obtenerSesion(), 'not_authenticated', 403)
  console.log('OK F3 ampliado: edición, rollback, respuesta perdida/reintento, CSRF real, busy/envío único, permisos mínimos, filtros/páginas, dos negocios, solicitudes tardías, recarga y logout.')
  assert.ok(requests.some((r) => r.path.includes('/roles/asignables/') && r.status === 200))
  assert.ok(requests.every((r) => r.status < 500))
  console.log('OK integración React DOM → Vite → Django → PostgreSQL: login/CSRF, usuarios, dos negocios, roles, ambas altas, último administrador, cambio de rol, permisos mínimos sin listar_roles, aislamiento, recarga y logout.')
} finally {
  for (const release of releases) release()
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

import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const originalFetch = globalThis.fetch
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const mocks = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const users = await load('features/usuarios/api.ts')
  const businesses = await load('features/negocios/api.ts')
  const roles = await load('features/roles/api.ts')
  const memberships = await load('features/membresias/api.ts')
  const { crearContextoSolicitudes } = await load('api/context.ts')
  function reset() { mocks.reiniciarMocks(); mocks.configurarMocks({ latencia: 0 }) }
  const login = (username = 'plataforma') => auth.iniciarSesion({ username, password: 'Demo-12345!' })
  const error = async (action, code, field) => {
    await assert.rejects(action, (e) => {
      assert.equal(e.code, code)
      assert.equal(typeof e.detail, 'string')
      assert.equal(typeof e.errors, 'object')
      if (field) assert.ok(Array.isArray(e.errors[field]))
      return true
    })
  }
  reset()
  await error(() => auth.obtenerSesion(), 'not_authenticated')
  await error(() => auth.iniciarSesion({ username: 'plataforma', password: 'incorrecta' }), 'invalid_credentials')
  await login()
  const firstPage = await users.listarUsuarios()
  assert.equal(firstPage.count, 6)
  assert.equal(firstPage.results.length, 2)
  assert.match(firstPage.next, /^mock:/)
  assert.equal((await users.listarUsuarios({ page: 2 })).results[0].id, 3)
  const user = await users.crearUsuario({ username: 'nueva', password: 'Nueva-12345!' })
  assert.deepEqual(Object.keys(user).sort(), ['id', 'is_active', 'username'])
  await error(() => users.crearUsuario({ username: 'nueva', password: 'Nueva-12345!' }), 'validation_error', 'username')
  await error(() => businesses.crearNegocio({ nombre: 'Fallido', tipo: 'tienda', administrador_id: 999 }), 'validation_error', 'administrador_id')
  assert.equal((await businesses.listarNegocios()).count, 2)
  const negocio = await businesses.crearNegocio({ nombre: 'Nuevo', tipo: 'tienda', administrador_id: user.id })
  assert.equal((await businesses.listarNegocios()).count, 3)
  await login('nueva').catch(() => {})
  await auth.iniciarSesion({ username: 'nueva', password: 'Nueva-12345!' })
  const createdRoles = await roles.listarRoles(negocio.id)
  assert.equal(createdRoles.count, 1)
  assert.equal((await memberships.listarMembresias(negocio.id)).results[0].usuario.id, user.id)
  await login('admin_tienda')
  await error(() => roles.listarRoles(2), 'permission_denied')
  const role = await roles.crearRol(1, { nombre: 'Lector nuevo', permiso_ids: [5, 7] })
  assert.equal((await roles.listarRoles(1)).count, 3)
  await error(() => roles.crearRol(1, { nombre: 'Global', permiso_ids: [1] }), 'validation_error', 'permiso_ids')
  await error(() => roles.crearRol(1, { nombre: 'Duplicado', permiso_ids: [5, 5] }), 'validation_error', 'permiso_ids')
  await error(() => memberships.crearMembresia(1, { username: 'existente', rol_id: 3 }), 'validation_error', 'rol_id')
  const existing = await memberships.crearMembresia(1, { username: 'existente', rol_id: role.id })
  assert.equal(existing.usuario.id, 5)
  await error(() => memberships.crearMembresia(1, { username: 'existente', rol_id: role.id }), 'validation_error', 'username')
  const added = await memberships.crearMembresia(1, { username: 'miembro_nuevo', password: 'Miembro-12345!', rol_id: role.id })
  assert.equal(added.usuario.username, 'miembro_nuevo')
  const changed = await memberships.cambiarRolMembresia(1, added.id, { rol_id: 2 })
  assert.equal(changed.rol_id, 2)
  assert.equal((await memberships.listarMembresias(1, { page: 2 })).results.find((m) => m.id === added.id).rol_id, 2)
  await error(() => memberships.cambiarRolMembresia(1, 2, { rol_id: 2 }), 'not_found')
  await error(() => memberships.crearMembresia(1, { username: 'no_creada', password: 'Miembro-12345!', rol_id: 3 }), 'validation_error', 'rol_id')
  await login()
  const allUsers = []
  for (let page = 1; ; page++) {
    const result = await users.listarUsuarios({ page })
    allUsers.push(...result.results)
    if (!result.next) break
  }
  assert.ok(!allUsers.some((u) => u.username === 'no_creada'))
  await login('compartido')
  assert.equal((await auth.obtenerSesion()).negocios.length, 2)
  await roles.listarRoles(1)
  await error(() => roles.listarRoles(2), 'permission_denied')
  await error(() => roles.crearRol(1, { nombre: 'Prohibido', permiso_ids: [] }), 'permission_denied')
  await login('admin_tienda')
  mocks.configurarMocks({ escenario: 'empty' })
  assert.deepEqual((await roles.listarRoles(1)).results, [])
  for (const code of ['validation_error', 'invalid_credentials', 'permission_denied', 'csrf_failed', 'not_found']) {
    mocks.configurarMocks({ escenario: code })
    await error(() => roles.listarRoles(1), code, code === 'validation_error' ? 'non_field_errors' : undefined)
  }
  mocks.configurarMocks({ latencia: 30 })
  const context = crearContextoSolicitudes()
  const pending = roles.crearRol(1, { nombre: 'Cancelado', permiso_ids: [] }, { signal: context.signal })
  const aborted = assert.rejects(pending, (e) => e.name === 'AbortError')
  context.cambiar()
  await aborted
  mocks.configurarMocks({ latencia: 0 })
  assert.equal((await roles.listarRoles(1, { page: 2 })).results.some((r) => r.nombre === 'Cancelado'), false)
  const before = Date.now()
  mocks.configurarMocks({ latencia: 20 })
  await roles.listarRoles(1)
  assert.ok(Date.now() - before >= 15)
  mocks.configurarMocks({ escenario: 'not_authenticated', latencia: 0 })
  await error(() => roles.listarRoles(1), 'not_authenticated')
  await error(() => auth.obtenerSesion(), 'not_authenticated')
  await login()
  assert.equal(await auth.cerrarSesion(), undefined)
  reset()
  await login()
  assert.equal((await users.listarUsuarios()).count, 6)
  console.log('OK mocks: lecturas, paginación, altas conjuntas, unicidad, membresías, aislamiento, permisos, escenarios, cancelación y reinicio.')

  const { httpTransport } = await load('api/http.ts')
  const calls = []
  let cookie = 'csrftoken=inicial'
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { get cookie() { return cookie } } })
  const responses = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options })
    const entry = responses.shift()
    assert.ok(entry, 'Respuesta HTTP de prueba no prevista')
    if (entry.cookie) cookie = entry.cookie
    if (entry.error) throw entry.error
    return entry.response
  }
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  responses.push({ response: new Response(null, { status: 204 }) })
  assert.equal(await httpTransport.request({ method: 'GET', path: '/auth/csrf/' }), undefined)
  assert.equal(calls.at(-1).url, '/api/v1/auth/csrf/')
  responses.push({ response: json({ usuario: { id: 1, username: 'x', is_active: true }, permisos_globales: [], negocios: [] }), cookie: 'csrftoken=rotado' })
  await httpTransport.request({ method: 'POST', path: '/auth/login/', body: { username: 'x', password: 'secret' } })
  assert.equal(calls.at(-1).headers['X-CSRFToken'], 'inicial')
  assert.equal(calls.at(-1).credentials, 'include')
  assert.deepEqual(JSON.parse(calls.at(-1).body), { username: 'x', password: 'secret' })
  responses.push({ response: json({ id: 4 }) })
  await httpTransport.request({ method: 'PATCH', path: '/negocios/1/membresias/4/', body: { rol_id: 2 } })
  assert.equal(calls.at(-1).headers['X-CSRFToken'], 'rotado')
  assert.deepEqual(JSON.parse(calls.at(-1).body), { rol_id: 2 })
  const count = calls.length
  responses.push({ response: json({ code: 'csrf_failed', detail: 'CSRF', errors: {} }, 403) }, { response: new Response(null, { status: 204 }), cookie: 'csrftoken=nuevo' })
  await error(() => httpTransport.request({ method: 'POST', path: '/plataforma/usuarios/', body: { username: 'x' } }), 'csrf_failed')
  assert.equal(calls.length, count + 2)
  assert.equal(calls.at(-1).url, '/api/v1/auth/csrf/')
  responses.push({ response: json({ code: 'validation_error', detail: 'Inválido', errors: { username: ['Ya existe.'] } }, 400) })
  await error(() => httpTransport.request({ method: 'POST', path: '/plataforma/usuarios/', body: {} }), 'validation_error', 'username')
  responses.push({ error: new TypeError('offline') })
  await error(() => httpTransport.request({ method: 'GET', path: '/auth/me/' }), 'network_error')
  responses.push({ error: new DOMException('Cancelado', 'AbortError') })
  await assert.rejects(() => httpTransport.request({ method: 'GET', path: '/auth/me/' }), (e) => e.name === 'AbortError')
  responses.push({ response: new Response('HTML', { status: 500 }) })
  await error(() => httpTransport.request({ method: 'GET', path: '/auth/me/' }), 'invalid_response')
  assert.equal(responses.length, 0)
  console.log('OK HTTP con fetch sustituido: payloads, cookies, rotación CSRF, 204, errores y reenvío manual sin duplicar mutaciones.')
  const httpServer = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_API_MODE': JSON.stringify('http') },
  })
  try {
    const httpLoad = (path) => httpServer.ssrLoadModule('/src/features/' + path + '/api.ts')
    const httpAuth = await httpLoad('auth')
    responses.push({ response: new Response(null, { status: 204 }) }, { response: json({ usuario: {}, permisos_globales: [], negocios: [] }) })
    const start = calls.length
    await httpAuth.iniciarSesion({ username: 'demo', password: 'demo-pass' })
    assert.equal(calls[start].url, '/api/v1/auth/csrf/')
    assert.equal(calls[start + 1].url, '/api/v1/auth/login/')
    const httpUsers = await httpLoad('usuarios')
    const httpBusinesses = await httpLoad('negocios')
    const httpRoles = await httpLoad('roles')
    const httpMemberships = await httpLoad('membresias')
    const cases = [
      [() => httpUsers.listarUsuarios({ page: 2 }), 'GET', '/plataforma/usuarios/?page=2'],
      [() => httpUsers.crearUsuario({ username: 'nuevo', password: 'demo-pass' }), 'POST', '/plataforma/usuarios/', { username: 'nuevo', password: 'demo-pass' }],
      [() => httpBusinesses.listarNegocios(), 'GET', '/plataforma/negocios/?page=1'],
      [() => httpBusinesses.crearNegocio({ nombre: 'Tienda', tipo: 'tienda', administrador_id: 5 }), 'POST', '/plataforma/negocios/', { nombre: 'Tienda', tipo: 'tienda', administrador_id: 5 }],
      [() => httpRoles.listarPermisos(2), 'GET', '/negocios/2/permisos/?page=1'],
      [() => httpRoles.listarRoles(2), 'GET', '/negocios/2/roles/?page=1'],
      [() => httpRoles.listarRolesAsignables(2), 'GET', '/negocios/2/roles/asignables/?page=1'],
      [() => httpRoles.crearRol(2, { nombre: 'Lector', permiso_ids: [5] }), 'POST', '/negocios/2/roles/', { nombre: 'Lector', permiso_ids: [5] }],
      [() => httpMemberships.listarMembresias(2), 'GET', '/negocios/2/membresias/?page=1'],
      [() => httpMemberships.crearMembresia(2, { username: 'existente', rol_id: 3 }), 'POST', '/negocios/2/membresias/', { username: 'existente', rol_id: 3 }],
      [() => httpMemberships.crearMembresia(2, { username: 'nuevo', password: 'demo-pass', rol_id: 3 }), 'POST', '/negocios/2/membresias/', { username: 'nuevo', password: 'demo-pass', rol_id: 3 }],
      [() => httpMemberships.cambiarRolMembresia(2, 9, { rol_id: 3 }), 'PATCH', '/negocios/2/membresias/9/', { rol_id: 3 }],
    ]
    for (const [action, method, path, payload] of cases) {
      responses.push({ response: json({}) })
      await action()
      assert.equal(calls.at(-1).url, '/api/v1' + path)
      assert.equal(calls.at(-1).method, method)
      assert.deepEqual(calls.at(-1).body === undefined ? undefined : JSON.parse(calls.at(-1).body), payload)
    }
    responses.push({ response: new Response(null, { status: 204 }) })
    assert.equal(await httpAuth.cerrarSesion(), undefined)
    assert.equal(calls.at(-1).url, '/api/v1/auth/logout/')
    console.log('OK selección HTTP y funciones públicas: CSRF antes del login, rutas, contexto y payloads exactos de todos los módulos.')
  } finally { await httpServer.close() }
} finally {
  globalThis.fetch = originalFetch
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
  else delete globalThis.document
  await server.close()
}

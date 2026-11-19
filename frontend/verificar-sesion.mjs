import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const storage = new Map()
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname: '/' } } })
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  const { ApiException } = await load('api/errors.ts')
  const { puedeAcceder } = await load('app/routes/access.ts')
  const { modules } = await load('app/routes/modules.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { AppRoutes } = await load('app/routes/AppRoutes.tsx')
  const mock = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const roles = await load('features/roles/api.ts')
  const { suscribirErroresApi } = await load('api/events.ts')
  mock.reiniciarMocks(); mock.configurarMocks({ latencia: 0 })
  const store = crearSessionStore()
  assert.equal(store.getSnapshot().status, 'restoring')
  await store.restaurar()
  assert.equal(store.getSnapshot().status, 'anonymous')
  await assert.rejects(() => store.login({ username: 'admin_tienda', password: 'incorrecta' }), (e) => e.code === 'invalid_credentials')
  assert.equal(store.getSnapshot().pending, false)
  await store.login({ username: 'compartido', password: 'Demo-12345!' })
  assert.equal(store.getSnapshot().negocioId, 1)
  assert.equal(store.getSnapshot().sesion.negocios.length, 2)
  const roleEntry = modules.find((entry) => entry.id === 'roles')
  assert.equal(puedeAcceder(roleEntry, store.getSnapshot().sesion, 1), true)
  assert.equal(puedeAcceder(roleEntry, store.getSnapshot().sesion, 2), false)
  const soloCrear = structuredClone(store.getSnapshot().sesion)
  soloCrear.negocios[0].permisos = ['crear_rol']
  assert.equal(puedeAcceder(roleEntry, soloCrear, 1), true)
  assert.throws(() => store.cambiarNegocio(999), (e) => e.code === 'permission_denied')
  let resolveOld
  let oldSignal
  const old = store.enContexto(({ signal }) => { oldSignal = signal; return new Promise((resolve) => { resolveOld = resolve }) })
  const discarded = assert.rejects(old, (e) => e.name === 'AbortError')
  store.cambiarNegocio(2)
  assert.equal(oldSignal.aborted, true)
  resolveOld(['datos de tienda'])
  await discarded
  assert.equal(store.getSnapshot().negocioId, 2)
  let rejectOld
  const oldError = store.enContexto(() => new Promise((_, reject) => { rejectOld = reject }))
  const discardedError = assert.rejects(oldError, (e) => e.name === 'AbortError')
  store.cambiarNegocio(1)
  rejectOld(new ApiException('permission_denied', 'Error anterior'))
  await discardedError
  assert.equal(await store.enContexto(async ({ negocioId }) => negocioId), 1)
  const reloaded = crearSessionStore()
  await reloaded.restaurar()
  assert.equal(reloaded.getSnapshot().sesion.usuario.username, 'compartido')
  assert.equal([...storage.values()].some((value) => value.includes('Demo-12345!')), false)
  const reloadServer = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const reloadMock = await reloadServer.ssrLoadModule('/src/mocks/services/transport.ts')
    reloadMock.configurarMocks({ latencia: 0 })
    const reloadAuth = await reloadServer.ssrLoadModule('/src/features/auth/api.ts')
    assert.equal((await reloadAuth.obtenerSesion()).usuario.username, 'compartido')
  } finally { await reloadServer.close() }
  const unsubscribe = suscribirErroresApi((error) => { if (error.code === 'not_authenticated') store.expirar() })
  mock.configurarMocks({ escenario: 'not_authenticated' })
  await assert.rejects(() => roles.listarRoles(1), (e) => e.code === 'not_authenticated')
  assert.equal(store.getSnapshot().sesion, null)
  assert.equal(store.getSnapshot().negocioId, null)
  assert.equal(storage.size, 0)
  unsubscribe()
  await store.login({ username: 'plataforma', password: 'Demo-12345!' })
  assert.equal(store.getSnapshot().sesion.negocios.length, 0)
  assert.equal(store.getSnapshot().negocioId, null)
  assert.equal(puedeAcceder(roleEntry, store.getSnapshot().sesion, 1), false)
  assert.equal(puedeAcceder(modules.find((entry) => entry.id === 'negocios'), store.getSnapshot().sesion, null), true)
  await store.logout()
  assert.equal(store.getSnapshot().status, 'anonymous')
  assert.equal(storage.size, 0)
  await store.login({ username: 'admin_tienda', password: 'Demo-12345!' })
  assert.equal(store.getSnapshot().sesion.negocios.length, 1)
  mock.configurarMocks({ escenario: 'csrf_failed' })
  await store.logout()
  assert.equal(store.getSnapshot().logoutUnconfirmed, true)
  assert.equal(store.getSnapshot().sesion, null)
  await store.logout()
  assert.equal(store.getSnapshot().logoutUnconfirmed, false)
  assert.equal(storage.size, 0)
  // Respuestas de auth fuera de orden y recuperación de error de red.
  const session = await auth.iniciarSesion({ username: 'admin_tienda', password: 'Demo-12345!' })
  let resolveRestore
  const racing = crearSessionStore({
    obtenerSesion: () => new Promise((resolve) => { resolveRestore = resolve }),
    iniciarSesion: async () => session, cerrarSesion: async () => {},
  })
  const restore = racing.restaurar()
  racing.expirar()
  resolveRestore(session)
  await restore
  assert.equal(racing.getSnapshot().status, 'anonymous')
  let offline = true
  const network = crearSessionStore({
    obtenerSesion: async () => { if (offline) throw new ApiException('network_error', 'Sin conexión'); return session },
    iniciarSesion: async () => session,
    cerrarSesion: async () => { throw new ApiException('network_error', 'Sin conexión') },
  })
  await network.restaurar()
  assert.equal(network.getSnapshot().status, 'restore_error')
  assert.equal(network.getSnapshot().sesion, null)
  offline = false
  await network.restaurar()
  assert.equal(network.getSnapshot().status, 'authenticated')
  await network.logout()
  assert.equal(network.getSnapshot().logoutUnconfirmed, true)
  assert.equal(network.getSnapshot().sesion, null)
  // Guardas y navegación renderizadas; nunca se monta el panel durante restauración.
  const render = (state, path) => {
    window.location.pathname = path
    return renderToStaticMarkup(createElement(SessionContext.Provider, { value: { ...state, store } }, createElement(AppRoutes)))
  }
  let html = render({ ...store.getSnapshot(), status: 'restoring', sesion: session }, '/plataforma')
  assert.match(html, /Verificando sesión/)
  assert.doesNotMatch(html, /Cerrar sesión/)
  html = render({ ...store.getSnapshot(), status: 'anonymous', sesion: null }, '/negocio/roles')
  assert.match(html, /Nombre de usuario/)
  assert.match(html, /type="password"/)
  const authorized = { ...store.getSnapshot(), status: 'authenticated', sesion: session, negocioId: 1, pending: false }
  html = render(authorized, '/negocio/roles')
  assert.match(html, /Roles del negocio/)
  assert.match(html, /Cerrar sesión/)
  html = render(authorized, '/plataforma')
  assert.match(html, /Acceso denegado/)
  html = render(authorized, '/inexistente')
  assert.match(html, /Página no disponible/)
  const shared = await auth.iniciarSesion({ username: 'compartido', password: 'Demo-12345!' })
  html = render({ ...authorized, sesion: shared, negocioId: 2 }, '/negocio/roles')
  assert.match(html, /Acceso denegado/)
  assert.doesNotMatch(html, /href="\/negocio\/roles"/)
  const platform = await auth.iniciarSesion({ username: 'plataforma', password: 'Demo-12345!' })
  html = render({ ...authorized, sesion: platform, negocioId: null }, '/')
  assert.match(html, /Sin negocios disponibles/)
  assert.match(html, /href="\/plataforma"/)
  assert.doesNotMatch(html, /href="\/negocio\/roles"/)
  mock.reiniciarMocks()
  console.log('OK sesión: login, restauración, recarga simulada, expiración global, logout, fallos de red/CSRF y cero/uno/varios negocios.')
  console.log('OK contexto: selección autorizada, cancelación y descarte de éxitos/errores tardíos incluso si el transporte ignora AbortSignal.')
  console.log('OK rutas renderizadas: carga sin panel, login, permisos por código, navegación filtrada, URL denegada y página inexistente.')
} finally {
  await server.close()
  if (storageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', storageDescriptor)
  else delete globalThis.sessionStorage
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
  else delete globalThis.window
}

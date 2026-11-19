import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', define: { 'import.meta.env.VITE_API_MODE': JSON.stringify('http') } })
const originalFetch = globalThis.fetch
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'csrftoken=actual' } })
try {
  const load = (module) => server.ssrLoadModule('/src/features/' + module + '/api.ts')
  const c = await load('categorias'), p = await load('productos'), s = await load('existencias'), m = await load('movimientos')
  const calls = []
  let queue = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options })
    const next = queue.shift()
    assert.ok(next, 'Respuesta no prevista.')
    if (next instanceof Error) throw next
    return next
  }
  const response = (status = 200, value = {}) => status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  const controller = new AbortController(), options = { signal: controller.signal }
  const input = { categoria_id: 1, sku: 'SKU', nombre: 'Nombre', unidad: 'kg', precio_venta: '12.50', stock_minimo: '0.125' }
  const movement = { producto_id: 1, tipo: 'salida', cantidad: '0.125', motivo: 'Entrega', clave_operacion: crypto.randomUUID() }
  const adjustment = { producto_id: 1, stock_objetivo: '1.000', version_esperada: 2, motivo: 'Conteo', clave_operacion: crypto.randomUUID() }
  const cases = [
    [() => c.listarCategorias(1, { page: 2, search: 'A & B', activo: false, ...options }), 'GET', '/categorias/', undefined, { page: '2', search: 'A & B', activo: 'false' }],
    [() => c.obtenerCategoria(1, 2, options), 'GET', '/categorias/2/'],
    [() => c.crearCategoria(1, { nombre: 'A', descripcion: '' }, options), 'POST', '/categorias/', { nombre: 'A', descripcion: '' }],
    [() => c.actualizarCategoria(1, 2, { activo: false }, options), 'PATCH', '/categorias/2/', { activo: false }],
    [() => c.listarCategoriasOpciones(1, { search: 'A/B', ...options }), 'GET', '/categorias/opciones/', undefined, { page: '1', search: 'A/B' }],
    [() => p.listarProductos(1, { categoria_id: 2, activo: true, ...options }), 'GET', '/productos/', undefined, { page: '1', categoria_id: '2', activo: 'true' }],
    [() => p.obtenerProducto(1, 2, options), 'GET', '/productos/2/'],
    [() => p.crearProducto(1, input, options), 'POST', '/productos/', input],
    [() => p.actualizarProducto(1, 2, { precio_venta: '0.00' }, options), 'PATCH', '/productos/2/', { precio_venta: '0.00' }],
    [() => p.listarProductosOpciones(1, options), 'GET', '/productos/opciones/', undefined, { page: '1' }],
    [() => s.listarExistencias(1, { bajo_minimo: true, ...options }), 'GET', '/existencias/', undefined, { page: '1', bajo_minimo: 'true' }],
    [() => s.obtenerExistencia(1, 2, options), 'GET', '/existencias/2/'],
    [() => m.listarMovimientos(1, { producto_id: 2, tipo: 'ajuste', desde: '2026-01-01T10:00:00+05:00', ...options }), 'GET', '/movimientos/', undefined, { page: '1', producto_id: '2', tipo: 'ajuste', desde: '2026-01-01T10:00:00+05:00' }],
    [() => m.registrarMovimiento(1, movement, options), 'POST', '/movimientos/', movement],
    [() => m.registrarAjuste(1, adjustment, options), 'POST', '/ajustes/', adjustment],
  ]
  for (const [action, method, path, payload, query = {}] of cases) {
    queue = [response(method === 'POST' ? 201 : 200)]
    await action()
    const call = calls.at(-1), url = new URL(call.url, 'http://localhost')
    assert.equal(url.pathname, '/api/v1/negocios/1' + path)
    assert.deepEqual(Object.fromEntries(url.searchParams), query)
    assert.equal(call.method, method)
    assert.equal(call.credentials, 'include')
    assert.equal(call.signal, controller.signal)
    assert.deepEqual(call.body === undefined ? undefined : JSON.parse(call.body), payload)
    if (method !== 'GET') assert.equal(call.headers['X-CSRFToken'], 'actual')
  }
  let count = calls.length
  queue = [response(409, { code: 'conflict', detail: 'Versión desactualizada.', errors: {} })]
  await assert.rejects(() => m.registrarAjuste(1, adjustment), (e) => e.status === 409 && e.code === 'conflict' && Object.keys(e.errors).length === 0)
  assert.equal(calls.length, count + 1)
  count = calls.length
  queue = [response(403, { code: 'csrf_failed', detail: 'CSRF', errors: {} }), response(204)]
  await assert.rejects(() => m.registrarMovimiento(1, movement), (e) => e.code === 'csrf_failed')
  assert.equal(calls.length, count + 2)
  assert.equal(calls.at(-1).url, '/api/v1/auth/csrf/')
  assert.deepEqual(JSON.parse(calls.at(-2).body), movement)
  count = calls.length
  queue = [new TypeError('offline')]
  await assert.rejects(() => m.registrarMovimiento(1, movement), (e) => e.code === 'network_error')
  assert.equal(calls.length, count + 1)
  queue = [response(201, { id: 9, cantidad: '-0.125' })]
  assert.equal((await m.registrarMovimiento(1, movement)).cantidad, '-0.125')
  assert.deepEqual(JSON.parse(calls.at(-1).body), movement, 'El reintento manual conserva la clave y entrada.')
  console.log('OK HTTP fase 2: todas las rutas/firmas/payloads, URLSearchParams, filtros, decimales string, cookies/CSRF, señales y 409 sin retries automáticos.')
} finally {
  globalThis.fetch = originalFetch
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
  else delete globalThis.document
  await server.close()
}

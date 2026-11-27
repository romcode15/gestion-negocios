import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', define: { 'import.meta.env.VITE_API_MODE': JSON.stringify('mock') } })
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const ventas = await load('features/ventas/api.ts')
  const productos = await load('features/productos/api.ts')
  const categorias = await load('features/categorias/api.ts')
  const stock = await load('features/existencias/api.ts')
  const movimientos = await load('features/movimientos/api.ts')
  const auth = await load('features/auth/api.ts')
  const roles = await load('features/roles/api.ts')
  const members = await load('features/membresias/api.ts')
  const businesses = await load('features/negocios/api.ts')
  const mock = await load('mocks/services/transport.ts')
  const decimal = await load('lib/decimales.ts')
  const operaciones = await load('features/ventas/draft/operaciones.ts')
  const key = () => crypto.randomUUID()
  const login = (username = 'admin_tienda') => auth.iniciarSesion({ username, password: 'Demo-12345!' })
  const reset = async () => { mock.reiniciarMocks(); mock.configurarMocks({ latencia: 0 }); await login() }
  async function all(loader) {
    const rows = []
    for (let page = 1; ; page++) { const result = await loader({ page }); rows.push(...result.results); if (!result.next) return rows }
  }
  async function fail(action, code, field, status) {
    await assert.rejects(action, (error) => {
      assert.equal(error.code, code)
      if (field) assert.ok(Array.isArray(error.errors[field]), 'Falta error por campo ' + field)
      if (status) assert.equal(error.status, status)
      if (code === 'conflict') assert.deepEqual(error.errors, {})
      return true
    })
  }
  const linea = (producto_id = 1, cantidad = '1', precio_unitario_esperado = '12.50') => ({ producto_id, cantidad, precio_unitario_esperado })
  const input = (detalles = [linea()], extra = {}) => ({ clave_operacion: key(), observaciones: ' Prueba de ventas ', detalles, ...extra })
  const entrada = (id, cantidad) => movimientos.registrarMovimiento(1, { producto_id: id, tipo: 'entrada', cantidad, motivo: 'Preparación de pruebas', clave_operacion: key() })
  const snapshot = async (negocio = 1) => ({
    stock: await all((q) => stock.listarExistencias(negocio, q)),
    movimientos: await all((q) => movimientos.listarMovimientos(negocio, q)),
    ventas: await Promise.all((await all((q) => ventas.listarVentas(negocio, q))).map((v) => ventas.obtenerVenta(negocio, v.id))),
    vinculos: await Promise.all((await all((q) => ventas.listarVentas(negocio, q))).map((v) => all((q) => ventas.listarMovimientosVenta(negocio, v.id, q)))),
  })
  async function rollback(action, code, field, status) {
    const before = await snapshot()
    await fail(action, code, field, status)
    assert.deepEqual(await snapshot(), before, 'El error no puede cambiar saldos, versiones, historial, venta ni vínculos.')
  }
  const raw = (method, suffix, body) => mock.mockTransport.request({ method, path: '/negocios/1/ventas/' + suffix, body })

  assert.equal(decimal.subtotalVenta('0.125', '0.04'), '0.01')
  assert.equal(decimal.subtotalVenta('0.124', '0.04'), '0.00')
  assert.equal(decimal.subtotalVenta('0.126', '0.04'), '0.01')
  assert.equal(decimal.totalVenta([decimal.subtotalVenta('0.125', '0.04'), decimal.subtotalVenta('0.125', '0.04')]), '0.02')
  assert.equal(decimal.subtotalVenta('100', '9999999999.99'), '999999999999.00')
  assert.equal(decimal.subtotalVenta('1', '0'), '0.00')
  for (const [quantity, price, unit] of [['0', '1'], ['-1', '1'], ['1.0001', '1'], ['1', '1.001'], [1, '1'], ['1', 2], ['0.5', '1', 'unidad'], ['101', '9999999999.99']]) {
    assert.throws(() => decimal.subtotalVenta(quantity, price, unit), (e) => e.code === 'validation_error')
  }
  assert.throws(() => decimal.totalVenta(['999999999999.99', '0.01']))
  assert.equal(operaciones.normalizarRegistroVenta({ detalles: Array.from({ length: 100 }, (_, i) => linea(i + 1)) }).detalles.length, 100)
  const op = operaciones.crearOperacionVenta()
  const original = { observaciones: ' Nota ', detalles: [linea(), linea(2, '0.5', '3.25')] }
  const frozen = op.preparar(original)
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.detalles) && Object.isFrozen(frozen.detalles[0]))
  original.detalles[0].cantidad = '9'
  assert.equal(frozen.detalles[0].cantidad, '1.000')
  assert.throws(() => { frozen.detalles[0].cantidad = '10' }, TypeError)
  const reordered = op.preparar({ observaciones: 'Nota', detalles: [linea(2, '0.500', '3.25'), linea(1, '1.0', '12.5')] })
  assert.equal(reordered, frozen, 'La repetición normalizada conserva payload y orden del snapshot original.')
  assert.notEqual(op.preparar({ observaciones: 'Otra', detalles: [linea()] }).clave_operacion, frozen.clave_operacion)
  op.nueva()
  assert.notEqual(op.preparar({ detalles: [linea()] }).clave_operacion, frozen.clave_operacion)
  const anulacionOp = operaciones.crearOperacionAnulacion()
  const voidPayload = anulacionOp.preparar({ motivo: ' Error ' })
  assert.equal(anulacionOp.preparar({ motivo: 'Error' }), voidPayload)
  assert.notEqual(anulacionOp.preparar({ motivo: 'Otro' }).clave_operacion, voidPayload.clave_operacion)
  assert.deepEqual(operaciones.solicitudDesdeDraft({ observaciones: ' Nota ', lineas: [{ producto: { id: 1 }, cantidad: '1', precio_unitario_esperado: '12.5' }] }), { observaciones: 'Nota', detalles: [linea(1, '1.000', '12.50')] })
  console.log('OK decimales: HALF_UP por línea, suma exacta, límites, precio cero y snapshots congelados/UUID de reintento normalizado.')

  await reset()
  assert.equal((await ventas.listarVentas(1)).count, 0)
  const opciones = await ventas.listarProductosVentaOpciones(1)
  assert.equal(opciones.count, 2)
  assert.deepEqual(Object.keys(opciones.results[0]).sort(), ['id', 'negocio_id', 'sku', 'nombre', 'unidad', 'precio_venta', 'disponible'].sort())
  assert.equal(opciones.results[1].disponible, '0.000')
  await fail(() => ventas.obtenerProductoVenta(1, 3), 'not_found', undefined, 404)
  await fail(() => ventas.obtenerProductoVenta(1, 4), 'not_found', undefined, 404)
  await fail(() => ventas.obtenerVenta(1, 1), 'not_found', undefined, 404)
  await fail(() => ventas.obtenerVenta(2, 1), 'permission_denied', undefined, 403)
  await login('admin_ferreteria')
  const seed = await ventas.listarVentas(2)
  assert.equal(seed.count, 2)
  assert.deepEqual(new Set(seed.results.map((v) => v.estado)), new Set(['confirmada', 'anulada']))
  const voidedSeed = await ventas.obtenerVenta(2, seed.results.find((v) => v.estado === 'anulada').id)
  assert.equal((await all((q) => ventas.listarMovimientosVenta(2, voidedSeed.id, q))).length, 2)
  const ledger = await all((q) => movimientos.listarMovimientos(2, q))
  let saldo = 0n
  for (const m of [...ledger].reverse()) {
    assert.equal(m.saldo_anterior, decimal.formatearDecimal(saldo))
    saldo += decimal.aEnteroEscalado(m.cantidad, { escala: 3, precision: 14, permitirNegativo: true })
    assert.equal(m.saldo_posterior, decimal.formatearDecimal(saldo))
  }
  assert.equal((await stock.obtenerExistencia(2, 4)).cantidad, decimal.formatearDecimal(saldo))
  assert.equal((await stock.obtenerExistencia(2, 4)).version, ledger.length)
  const seededRoleCodes = await all((q) => roles.listarRoles(2, q))
  assert.ok(['registrar_venta', 'listar_ventas', 'anular_venta'].every((code) => seededRoleCodes.some((r) => r.nombre === 'Solo ' + code)))
  await login()
  await entrada(2, '2')
  const request = input([linea(), linea(2, '0.125', '3.25')])
  const before = await snapshot()
  const sale = await ventas.registrarVenta(1, request)
  assert.equal(sale.estado, 'confirmada')
  assert.equal(sale.total, '12.91')
  assert.equal(sale.observaciones, 'Prueba de ventas')
  assert.deepEqual(Object.keys(sale).sort(), ['id', 'negocio_id', 'estado', 'total', 'vendedor', 'creado_en', 'clave_operacion', 'observaciones', 'detalles', 'anulacion'].sort())
  assert.deepEqual(Object.keys(sale.detalles[0]).sort(), ['id', 'producto_id', 'sku', 'nombre', 'unidad', 'cantidad', 'precio_unitario', 'subtotal'].sort())
  assert.equal((await stock.obtenerExistencia(1, 1)).cantidad, '4.000')
  assert.equal((await stock.obtenerExistencia(1, 2)).cantidad, '1.875')
  assert.equal((await stock.obtenerExistencia(1, 1)).version, before.stock[0].version + 1)
  const links = await all((q) => ventas.listarMovimientosVenta(1, sale.id, q))
  assert.equal((await ventas.listarVentas(1, { search: '-01' })).count, 1, 'Coincidir en dos líneas no duplica la venta.')
  assert.equal(links.length, 2)
  assert.ok(links.every((l) => l.operacion === 'venta' && l.movimiento.tipo === 'salida' && l.movimiento.cantidad.startsWith('-')))
  assert.equal(new Set(links.map((l) => l.movimiento.clave_operacion)).size, 2)
  assert.ok(links.every((l) => l.movimiento.clave_operacion !== sale.clave_operacion))
  const committed = await snapshot()
  const replay = await ventas.registrarVenta(1, { ...request, observaciones: 'Prueba de ventas', detalles: [...request.detalles].reverse().map((l) => ({ ...l, cantidad: l.producto_id === 1 ? '1.000' : '0.125' })) })
  assert.deepEqual(replay, sale)
  assert.deepEqual(await snapshot(), committed)
  await rollback(() => ventas.registrarVenta(1, { ...request, observaciones: 'Cambio' }), 'conflict', undefined, 409)
  await rollback(() => ventas.registrarVenta(1, input([linea(1, '1', '12.49')])), 'conflict', undefined, 409)
  await productos.actualizarProducto(1, 1, { nombre: 'Nombre cambiado', precio_venta: '20.00' })
  await rollback(() => ventas.registrarVenta(1, input()), 'conflict', undefined, 409)
  await productos.actualizarProducto(1, 1, { activo: false })
  assert.deepEqual((await ventas.obtenerVenta(1, sale.id)).detalles, sale.detalles, 'Snapshots históricos inmutables.')
  assert.deepEqual(await ventas.registrarVenta(1, request), sale, 'Reintento antes de estado/precio actual.')
  await rollback(() => ventas.registrarVenta(1, input()), 'validation_error', 'detalles.0.producto_id', 400)
  await productos.actualizarProducto(1, 2, { activo: false })
  await categorias.actualizarCategoria(1, 1, { activo: false })
  await categorias.actualizarCategoria(1, 4, { activo: false })
  assert.equal((await ventas.listarProductosVentaOpciones(1)).count, 0)
  const voidRequest = { clave_operacion: request.clave_operacion, motivo: ' Error de registro ' }
  const canceled = await ventas.anularVenta(1, sale.id, voidRequest)
  assert.equal(canceled.estado, 'anulada')
  assert.equal(canceled.total, sale.total)
  assert.deepEqual(canceled.detalles, sale.detalles)
  assert.equal((await stock.obtenerExistencia(1, 1)).cantidad, '5.000', 'Se restituye incluso si está inactivo.')
  const refunded = await snapshot()
  assert.deepEqual(await ventas.anularVenta(1, sale.id, { ...voidRequest, motivo: 'Error de registro' }), canceled)
  assert.deepEqual(await ventas.registrarVenta(1, request), canceled)
  assert.deepEqual(await snapshot(), refunded)
  await rollback(() => ventas.anularVenta(1, sale.id, { ...voidRequest, clave_operacion: key() }), 'conflict', undefined, 409)
  await rollback(() => ventas.anularVenta(1, sale.id, { ...voidRequest, motivo: 'Distinto' }), 'conflict', undefined, 409)
  assert.equal((await all((q) => ventas.listarMovimientosVenta(1, sale.id, q))).length, 4)
  console.log('OK venta/anulación: contratos exactos, inventario compartido, snapshots históricos, reintentos reordenados, espacios de UUID y devolución de inactivos.')

  await reset()
  for (const [body, field] of [
    [null, 'non_field_errors'], [[], 'non_field_errors'], [input([], {}), 'detalles'], [input(Array.from({ length: 101 }, (_, i) => linea(i + 1))), 'detalles'],
    [input([linea(), linea()]), 'detalles.1.producto_id'], [input([linea(4)]), 'detalles.0.producto_id'],
    [input([linea(1, 1)]), 'detalles.0.cantidad'], [input([linea(1, '-1')]), 'detalles.0.cantidad'], [input([linea(1, '0')]), 'detalles.0.cantidad'],
    [input([linea(1, '1.001')]), 'detalles.0.cantidad'], [input([linea(1, '1', 12.5)]), 'detalles.0.precio_unitario_esperado'],
    [input([linea(1, '1', '12.501')]), 'detalles.0.precio_unitario_esperado'], [input([linea(1, '1e1')]), 'detalles.0.cantidad'],
    [input([linea()], { observaciones: null }), 'observaciones'], [input([linea()], { observaciones: 'x'.repeat(501) }), 'observaciones'],
    [input([linea()], { clave_operacion: 'mal' }), 'clave_operacion'], [input([linea()], { total: '0.00' }), 'total'],
    [input([{ ...linea(), precio_unitario: '0' }]), 'detalles.0.precio_unitario'], [input([null]), 'detalles.0'],
    [input([linea('1')]), 'detalles.0.producto_id'], [input([linea(true)]), 'detalles.0.producto_id'],
  ]) await rollback(() => ventas.registrarVenta(1, body), 'validation_error', field, 400)
  await rollback(() => ventas.registrarVenta(1, input([linea(), linea(2, '1', '3.25')])), 'validation_error', 'detalles.1.cantidad', 400)
  await entrada(2, '1')
  const unexpectedInput = input([linea(), linea(2, '0.125', '3.25')])
  const unexpectedBefore = await snapshot(), originalUUID = crypto.randomUUID
  let generated = 0
  try {
    crypto.randomUUID = () => { if (++generated === 2) throw new Error('Fallo inesperado en la segunda línea'); return originalUUID.call(crypto) }
    await assert.rejects(() => ventas.registrarVenta(1, unexpectedInput), /Fallo inesperado/)
  } finally { crypto.randomUUID = originalUUID }
  assert.deepEqual(await snapshot(), unexpectedBefore, 'Una excepción inesperada conserva el error y revierte toda la copia.')
  const reverseSale = await ventas.registrarVenta(1, input([linea(), linea(2, '0.125', '3.25')]))
  await movimientos.registrarAjuste(1, { producto_id: 2, stock_objetivo: '99999999999.999',
    version_esperada: (await stock.obtenerExistencia(1, 2)).version, motivo: 'Límite', clave_operacion: key() })
  await rollback(() => ventas.anularVenta(1, reverseSale.id, { motivo: 'Overflow segunda línea', clave_operacion: key() }), 'validation_error', undefined, 400)
  console.log('OK validación estricta: errores planos, campos desconocidos, rollback de segunda línea/excepción y reversión fuera de rango sin cambios parciales.')

  await reset()
  const expensive = []
  for (let i = 0; i < 2; i++) {
    const p = await productos.crearProducto(1, { categoria_id: 1, sku: 'LIMITE-' + i, nombre: 'Límite ' + i, unidad: 'unidad', precio_venta: '9999999999.99' })
    await entrada(p.id, '200')
    expensive.push(p)
  }
  await rollback(() => ventas.registrarVenta(1, input(expensive.map((p) => linea(p.id, '100', p.precio_venta)))), 'validation_error', 'total', 400)
  await rollback(() => ventas.registrarVenta(1, input([linea(expensive[0].id, '101', expensive[0].precio_venta)])), 'validation_error', 'detalles.0.cantidad', 400)
  const free = await productos.crearProducto(1, { categoria_id: 1, sku: 'GRATIS', nombre: 'Gratuito', unidad: 'unidad', precio_venta: '0' })
  await entrada(free.id, '1')
  assert.equal((await ventas.registrarVenta(1, input([linea(free.id, '1', '0')]))).total, '0.00')
  const allOptions = await all((q) => ventas.listarProductosVentaOpciones(1, q))
  assert.ok(allOptions.some((p) => p.id === free.id), 'Opciones en páginas posteriores accesibles.')
  assert.equal((await ventas.listarProductosVentaOpciones(1, { search: ' LIMITE ' })).count, 2)

  await reset()
  const requestConcurrent = input()
  const repeated = await Promise.all([ventas.registrarVenta(1, requestConcurrent), ventas.registrarVenta(1, requestConcurrent)])
  assert.equal(repeated[0].id, repeated[1].id)
  assert.equal((await stock.obtenerExistencia(1, 1)).cantidad, '4.000')
  const competing = await Promise.allSettled([ventas.registrarVenta(1, input([linea(1, '3')])), ventas.registrarVenta(1, input([linea(1, '3')]))])
  assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1)
  const voidKey = key()
  const voids = await Promise.all([ventas.anularVenta(1, repeated[0].id, { clave_operacion: voidKey, motivo: 'Concurrente' }), ventas.anularVenta(1, repeated[0].id, { clave_operacion: voidKey, motivo: 'Concurrente' })])
  assert.equal(voids[0].anulacion.id, voids[1].anulacion.id)
  const concurrentBefore = await snapshot()
  mock.configurarMocks({ latencia: 40 })
  const abort = new AbortController()
  const canceledRequest = ventas.registrarVenta(1, input(), { signal: abort.signal })
  const rejected = assert.rejects(canceledRequest, (e) => e.name === 'AbortError')
  abort.abort(); await rejected; mock.configurarMocks({ latencia: 0 })
  assert.deepEqual(await snapshot(), concurrentBefore)
  console.log('OK serialización simulada: misma clave, ventas competidoras, una anulación y cancelación antes de dispatch sin mutar.')

  await reset()
  const catalogo = await all((q) => roles.listarPermisos(1, q))
  const permissionIds = new Map(catalogo.map((p) => [p.codigo, p.id]))
  assert.deepEqual(new Set(catalogo.filter((p) => ['registrar_venta', 'listar_ventas', 'anular_venta'].includes(p.codigo)).map((p) => p.codigo)), new Set(['registrar_venta', 'listar_ventas', 'anular_venta']))
  const actorSale = input(), actorConfirmed = await ventas.registrarVenta(1, actorSale)
  const createOnly = async (username, code) => {
    const role = await roles.crearRol(1, { nombre: username, permiso_ids: [permissionIds.get(code)] })
    await members.crearMembresia(1, { username, password: 'Demo-12345!', rol_id: role.id })
  }
  for (const [user, code] of [['solo_registro', 'registrar_venta'], ['solo_lista', 'listar_ventas'], ['solo_anula', 'anular_venta']]) await createOnly(user, code)
  const actorBefore = await snapshot()
  await login('solo_registro')
  assert.ok((await ventas.listarProductosVentaOpciones(1)).count > 0)
  assert.ok((await ventas.obtenerProductoVenta(1, 1)).id)
  await fail(() => ventas.listarVentas(1), 'permission_denied', undefined, 403)
  await fail(() => productos.listarProductos(1), 'permission_denied', undefined, 403)
  await fail(() => stock.listarExistencias(1), 'permission_denied', undefined, 403)
  await fail(() => ventas.registrarVenta(1, actorSale), 'conflict', undefined, 409)
  await fail(() => ventas.anularVenta(1, actorConfirmed.id, { clave_operacion: key(), motivo: 'No autorizado' }), 'permission_denied', undefined, 403)
  assert.equal((await ventas.obtenerVenta(1, actorConfirmed.id)).id, actorConfirmed.id)
  assert.ok((await ventas.listarMovimientosVenta(1, actorConfirmed.id)).count)
  await login()
  assert.deepEqual(await snapshot(), actorBefore)
  await login('solo_registro')
  const minimalPayload = input()
  const minimalSale = await ventas.registrarVenta(1, minimalPayload)
  await login('solo_lista')
  assert.ok((await ventas.listarVentas(1)).count > 0)
  await fail(() => ventas.listarProductosVentaOpciones(1), 'permission_denied')
  await fail(() => ventas.registrarVenta(1, input()), 'permission_denied')
  await login('solo_anula')
  await fail(() => ventas.listarVentas(1), 'permission_denied')
  const voidMinimal = { clave_operacion: key(), motivo: 'Solo anulación' }
  assert.equal((await ventas.anularVenta(1, minimalSale.id, voidMinimal)).estado, 'anulada')
  await fail(() => movimientos.listarMovimientos(1), 'permission_denied')
  assert.ok((await ventas.listarMovimientosVenta(1, minimalSale.id)).count > 0)
  await login()
  await rollback(() => ventas.anularVenta(1, minimalSale.id, voidMinimal), 'conflict', undefined, 409)
  const noSales = await roles.crearRol(1, { nombre: 'Ventas revocadas', permiso_ids: [] })
  const membership = (await all((q) => members.listarMembresias(1, q))).find((m) => m.usuario.username === 'solo_registro')
  await members.cambiarRolMembresia(1, membership.id, { rol_id: noSales.id })
  const revokedBefore = await snapshot()
  await login('solo_registro')
  await fail(() => ventas.registrarVenta(1, minimalPayload), 'permission_denied', undefined, 403)
  await login()
  assert.deepEqual(await snapshot(), revokedBefore, 'El replay sigue exigiendo autorización actual.')
  await login('compartido')
  assert.deepEqual((await auth.obtenerSesion()).negocios[0].permisos.sort(), ['listar_membresias', 'listar_roles'])
  await fail(() => ventas.listarVentas(1), 'permission_denied')
  await fail(() => ventas.obtenerVenta(2, 1), 'permission_denied')
  await login('plataforma')
  await fail(() => ventas.obtenerVenta(1, actorConfirmed.id), 'permission_denied')
  const newBusiness = await businesses.crearNegocio({ nombre: 'Ventas nueva', tipo: 'tienda', administrador_id: 5 })
  await login('existente')
  const newSession = await auth.obtenerSesion()
  assert.ok(['registrar_venta', 'listar_ventas', 'anular_venta'].every((code) => newSession.negocios[0].permisos.includes(code)))
  assert.equal((await ventas.listarVentas(newBusiness.id)).count, 0)
  await login('admin_ferreteria')
  const anotherContext = await ventas.registrarVenta(2, input([linea(4, '0.125', '8.00')], { clave_operacion: actorSale.clave_operacion }))
  assert.equal(anotherContext.negocio_id, 2)
  await fail(() => ventas.obtenerProductoVenta(2, 1), 'not_found')
  await fail(() => ventas.obtenerVenta(2, actorConfirmed.id), 'not_found')
  await login()
  mock.configurarMocks({ usuariosInactivos: [2] })
  await fail(() => ventas.registrarVenta(1, input()), 'not_authenticated', undefined, 403)
  await fail(() => login('inactivo'), 'invalid_credentials')
  console.log('OK permisos mínimos separados, sin movimientos manuales, actor/tenant ajenos, roles anteriores intactos e inactivos.')

  await reset()
  for (let i = 0; i < 3; i++) await ventas.registrarVenta(1, input([linea()], { observaciones: 'Búsqueda & ' + i }))
  const page1 = await ventas.listarVentas(1, { search: ' Búsqueda & ', estado: 'confirmada' })
  assert.equal(page1.count, 3)
  assert.match(page1.next, /^mock:/)
  assert.match(page1.next, /estado=confirmada/)
  const page2 = await ventas.listarVentas(1, { search: 'Búsqueda &', estado: 'confirmada', page: 2 })
  assert.equal(page2.results.length, 1)
  const date = page1.results[0].creado_en
  assert.equal((await ventas.listarVentas(1, { desde: date })).results[0].id, page1.results[0].id)
  assert.equal((await ventas.listarVentas(1, { hasta: '2025-01-01T00:00:00Z' })).count, 0)
  assert.equal((await ventas.listarVentas(1, { search: 'ausente' })).count, 0)
  assert.equal((await ventas.listarProductosVentaOpciones(1, { search: 'PESO' })).results[0].id, 2)
  for (const suffix of ['?otro=1', '?estado=otro', '?search=x&search=y', '?search=' + 'x'.repeat(151), '?desde=2026-02-30T00:00:00Z', '?desde=2026-01-02T00:00:00Z&hasta=2026-01-01T00:00:00Z']) await fail(() => raw('GET', suffix), 'validation_error', undefined, 400)
  for (const suffix of ['?page=no', '?page=0', '?page=999']) await fail(() => raw('GET', suffix), 'not_found', undefined, 404)
  for (const suffix of ['', '1/', '1/anulacion/', '1/movimientos/', 'productos/1/']) await fail(() => raw('DELETE', suffix), 'method_not_allowed', undefined, 405)
  await fail(() => raw('GET', page1.results[0].id + '/movimientos/?search=x'), 'validation_error', 'search')
  const scenarioBefore = await snapshot()
  mock.configurarMocks({ escenario: 'empty' })
  assert.equal((await ventas.listarVentas(1)).count, 0)
  mock.configurarMocks({ escenario: 'csrf_failed' })
  await fail(() => ventas.registrarVenta(1, input()), 'csrf_failed', undefined, 403)
  assert.deepEqual(await snapshot(), scenarioBefore)
  mock.configurarMocks({ escenario: 'conflict' })
  await fail(() => ventas.registrarVenta(1, input()), 'conflict', undefined, 409)
  assert.deepEqual(await snapshot(), scenarioBefore)
  mock.reiniciarMocks(); mock.configurarMocks({ latencia: 0 }); await login()
  assert.equal((await ventas.listarVentas(1)).count, 0)
  assert.equal((await stock.obtenerExistencia(1, 1)).cantidad, '5.000')
  console.log('OK filtros/paginación, orden, parámetros estrictos, métodos 405, escenarios, CSRF y reinicio conjunto con fase 2.')
} finally { await server.close() }

// Transporte HTTP sustituido: no acredita Django/PostgreSQL real.
const http = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', define: { 'import.meta.env.VITE_API_MODE': JSON.stringify('http') } })
const nativeFetch = globalThis.fetch, documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'csrftoken=prueba' } })
try {
  const ventas = await http.ssrLoadModule('/src/features/ventas/api.ts')
  const calls = [], controller = new AbortController()
  let queue = []
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); const next = queue.shift(); assert.ok(next); if (next instanceof Error) throw next; return next }
  const response = (status, body = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const input = { clave_operacion: crypto.randomUUID(), observaciones: '', detalles: [{ producto_id: 2, cantidad: '0.125', precio_unitario_esperado: '2.50' }] }
  const anulacion = { clave_operacion: crypto.randomUUID(), motivo: 'Error' }, options = { signal: controller.signal }
  const cases = [
    [() => ventas.listarProductosVentaOpciones(1, { ...options, page: 2, search: 'A & B/+' }), 'GET', '/productos/opciones/', undefined, { page: '2', search: 'A & B/+' }],
    [() => ventas.obtenerProductoVenta(1, 2, options), 'GET', '/productos/2/'],
    [() => ventas.registrarVenta(1, input, options), 'POST', '/', input],
    [() => ventas.listarVentas(1, { ...options, page: 2, estado: 'anulada', search: 'A & B', desde: '2026-01-01T00:00:00+05:00', hasta: '2026-02-01T00:00:00Z' }), 'GET', '/', undefined,
      { page: '2', estado: 'anulada', search: 'A & B', desde: '2026-01-01T00:00:00+05:00', hasta: '2026-02-01T00:00:00Z' }],
    [() => ventas.obtenerVenta(1, 3, options), 'GET', '/3/'],
    [() => ventas.anularVenta(1, 3, anulacion, options), 'POST', '/3/anulacion/', anulacion],
    [() => ventas.listarMovimientosVenta(1, 3, { ...options, page: 2 }), 'GET', '/3/movimientos/', undefined, { page: '2' }],
  ]
  for (const [action, method, suffix, payload, query = {}] of cases) {
    queue = [response(method === 'POST' && suffix === '/' ? 201 : 200)]
    await action()
    const call = calls.at(-1), url = new URL(call.url, 'http://localhost')
    assert.equal(url.pathname, '/api/v1/negocios/1/ventas' + suffix)
    assert.deepEqual(Object.fromEntries(url.searchParams), query)
    assert.equal(call.method, method); assert.equal(call.credentials, 'include'); assert.equal(call.signal, controller.signal)
    assert.deepEqual(call.body ? JSON.parse(call.body) : undefined, payload)
    if (method === 'POST') assert.equal(call.headers['X-CSRFToken'], 'prueba')
  }
  for (const [status, code] of [[400, 'validation_error'], [403, 'permission_denied'], [403, 'not_authenticated'], [404, 'not_found'], [409, 'conflict']]) {
    const before = calls.length
    queue = [response(status, { code, detail: 'Error de prueba', errors: code === 'validation_error' ? { 'detalles.0.cantidad': ['Revisa cantidad'] } : {} })]
    await assert.rejects(() => ventas.registrarVenta(1, input), (e) => e.code === code && e.status === status && (code !== 'validation_error' || e.errors['detalles.0.cantidad'][0] === 'Revisa cantidad'))
    assert.equal(calls.length, before + 1)
  }
  let before = calls.length
  queue = [response(403, { code: 'csrf_failed', detail: 'CSRF', errors: {} }), response(204)]
  await assert.rejects(() => ventas.anularVenta(1, 3, anulacion), (e) => e.code === 'csrf_failed')
  assert.equal(calls.length, before + 2)
  assert.equal(calls.at(-1).url, '/api/v1/auth/csrf/')
  before = calls.length
  queue = [new TypeError('Red')]
  await assert.rejects(() => ventas.registrarVenta(1, input), (e) => e.code === 'network_error')
  assert.equal(calls.length, before + 1)
  queue = [response(201)]
  await ventas.registrarVenta(1, input)
  assert.deepEqual(JSON.parse(calls.at(-1).body), input)
  console.log('OK HTTP sustituido: siete firmas/rutas, query strings, payloads, AbortSignal, sesión/CSRF/204 y errores 400/403/404/409 sin retry automático.')
} finally {
  globalThis.fetch = nativeFetch
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
  else delete globalThis.document
  await http.close()
}

import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const mocks = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const roles = await load('features/roles/api.ts')
  const membresias = await load('features/membresias/api.ts')
  const ex = await load('features/existencias/api.ts')

  function reset() { mocks.reiniciarMocks(); mocks.configurarMocks({ latencia: 0 }) }
  const login = (username) => auth.iniciarSesion({ username, password: 'Demo-12345!' })
  const error = async (action, code, field) => {
    let lanzado
    try { await action() } catch (cause) { lanzado = cause }
    assert.ok(lanzado, 'Se esperaba el error ' + code)
    assert.equal(lanzado.code, code)
    if (field) assert.ok(Array.isArray(lanzado.errors[field]), 'Falta el error del campo ' + field)
  }
  async function todas(negocioId, filtros = {}) {
    const items = []
    for (let page = 1; ; page++) {
      const pagina = await ex.listarExistencias(negocioId, { page, ...filtros })
      items.push(...pagina.results)
      if (pagina.next === null) return items
    }
  }

  // --- Datos de la semilla: cero, bajo, igual, sobre el mínimo, fracciones e inactivo ---
  reset()
  await login('admin_tienda')
  const filas = await todas(1)
  assert.equal(filas.length, 3) // productos 1, 2 y 3 del negocio 1, incluido el inactivo
  const porSku = Object.fromEntries(filas.map((f) => [f.producto.sku, f]))
  assert.equal(porSku['PESO-01'].cantidad, '0.000') // cero visible
  assert.equal(porSku['PESO-01'].bajo_minimo, true) // 0 < 1.500
  assert.equal(porSku['COMUN-01'].cantidad, '5.000')
  assert.equal(porSku['COMUN-01'].bajo_minimo, false) // 5 >= 2
  assert.equal(porSku['LIQ-01'].producto.activo, false) // inactivo visible sin filtros
  assert.equal(porSku['LIQ-01'].bajo_minimo, false) // 2.000 > 0.000
  assert.deepEqual(Object.keys(filas[0]).sort(), ['bajo_minimo', 'cantidad', 'id', 'negocio_id', 'producto', 'stock_minimo', 'version'])
  console.log('OK semilla: cero visible, bajo mínimo, sobre el mínimo e inactivo incluido sin filtros.')

  // --- Igualdad con el mínimo no es bajo mínimo, y fracciones ---
  const { request, contextoNegocio } = await load('api/client.ts')
  const mov = await load('features/movimientos/api.ts')
  const key = () => crypto.randomUUID()
  // PESO-01 (kg, mínimo 1.500): entrada de 1.500 deja el saldo igual al mínimo.
  await mov.registrarMovimiento(1, { producto_id: 2, tipo: 'entrada', cantidad: '1.500', motivo: 'Igual al mínimo', clave_operacion: key() })
  let peso = await ex.obtenerExistencia(1, 2)
  assert.equal(peso.cantidad, '1.500')
  assert.equal(peso.bajo_minimo, false, 'Igualdad no cuenta como bajo mínimo.')
  await mov.registrarMovimiento(1, { producto_id: 2, tipo: 'salida', cantidad: '0.001', motivo: 'Fracción', clave_operacion: key() })
  peso = await ex.obtenerExistencia(1, 2)
  assert.equal(peso.cantidad, '1.499')
  assert.equal(peso.bajo_minimo, true)
  assert.equal(typeof peso.cantidad, 'string')
  void request; void contextoNegocio
  console.log('OK mínimo: igualdad no es bajo mínimo, una fracción por debajo sí, y todo viaja como cadena.')

  // --- Filtros al servidor ---
  const bajos = await todas(1, { bajo_minimo: true })
  assert.ok(bajos.length >= 1 && bajos.every((f) => f.bajo_minimo))
  const normales = await todas(1, { bajo_minimo: false })
  assert.equal(bajos.length + normales.length, (await todas(1)).length)
  assert.deepEqual((await todas(1, { search: 'peso' })).map((f) => f.producto.sku), ['PESO-01'])
  assert.deepEqual((await todas(1, { search: 'liq-01' })).map((f) => f.producto.sku), ['LIQ-01'])
  const inactivos = await todas(1, { activo: false })
  assert.deepEqual(inactivos.map((f) => f.producto.sku), ['LIQ-01'])
  assert.ok((await todas(1, { activo: true })).every((f) => f.producto.activo))
  assert.ok((await todas(1, { categoria_id: 1 })).every((f) => f.producto.categoria_id === 1))
  await error(() => ex.listarExistencias(1, { categoria_id: 3 }), 'validation_error', 'categoria_id') // categoría de otro negocio
  const p1 = await ex.listarExistencias(1, { page: 1 })
  assert.equal(p1.results.length, 2)
  assert.notEqual(p1.next, null)
  const p2 = await ex.listarExistencias(1, { page: 2 })
  assert.equal(p2.count, p1.count)
  assert.notDeepEqual(p2.results.map((f) => f.id), p1.results.map((f) => f.id))
  await error(() => ex.listarExistencias(1, { page: 99 }), 'not_found')
  console.log('OK filtros y paginación: bajo mínimo, texto, estado, categoría y páginas resueltos por el servidor.')

  // --- Sin permisos de catálogo: solo consultar_existencias ---
  reset()
  await login('admin_tienda')
  const permisos = []
  for (let page = 1; ; page++) {
    const pagina = await roles.listarPermisos(1, { page })
    permisos.push(...pagina.results)
    if (pagina.next === null) break
  }
  const rol = await roles.crearRol(1, { nombre: 'Solo existencias', permiso_ids: [permisos.find((p) => p.codigo === 'consultar_existencias').id] })
  await membresias.crearMembresia(1, { username: 'existente', rol_id: rol.id })
  await login('existente')
  const completas = await todas(1)
  assert.equal(completas.length, 3)
  assert.ok(completas.every((f) => f.producto.sku && f.producto.categoria_nombre), 'El resumen trae producto y categoría.')
  assert.equal((await ex.obtenerExistencia(1, 1)).producto.sku, 'COMUN-01')
  console.log('OK permiso mínimo: consultar_existencias basta, sin listar productos ni categorías.')

  // --- Sin permiso y otro negocio ---
  reset()
  await login('compartido')
  await error(() => ex.listarExistencias(1), 'permission_denied')
  await error(() => ex.listarExistencias(2), 'permission_denied')
  await login('admin_ferreteria')
  const ferreteria = await todas(2)
  assert.deepEqual(ferreteria.map((f) => f.producto.sku), ['COMUN-01'])
  assert.ok(ferreteria.every((f) => f.negocio_id === 2))
  assert.equal(ferreteria[0].cantidad, '3.500')
  await error(() => ex.listarExistencias(1), 'permission_denied')
  await error(() => ex.obtenerExistencia(2, 1), 'not_found') // producto del otro negocio
  console.log('OK contexto: cuenta sin permiso, negocio ajeno y datos separados por negocio.')

  // --- Escenarios simulados ---
  reset()
  await login('admin_tienda')
  mocks.configurarMocks({ escenario: 'empty' })
  assert.equal((await ex.listarExistencias(1)).count, 0)
  for (const escenario of ['permission_denied', 'not_found', 'validation_error', 'conflict']) {
    mocks.configurarMocks({ escenario })
    await error(() => ex.listarExistencias(1), escenario)
  }
  mocks.configurarMocks({ escenario: 'not_authenticated' })
  await error(() => ex.listarExistencias(1), 'not_authenticated')
  console.log('OK escenarios: vacío, acceso denegado, no encontrado, validación, conflicto y sesión vencida.')
  mocks.reiniciarMocks()
} finally {
  await server.close()
}
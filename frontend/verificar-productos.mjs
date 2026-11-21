import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const mocks = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const roles = await load('features/roles/api.ts')
  const membresias = await load('features/membresias/api.ts')
  const cats = await load('features/categorias/api.ts')
  const prods = await load('features/productos/api.ts')
  const validacion = await load('features/productos/validacion.ts')

  function reset() { mocks.reiniciarMocks(); mocks.configurarMocks({ latencia: 0 }) }
  const login = (username) => auth.iniciarSesion({ username, password: 'Demo-12345!' })
  const error = async (action, code, field) => {
    let lanzado
    try { await action() } catch (cause) { lanzado = cause }
    assert.ok(lanzado, 'Se esperaba el error ' + code)
    assert.equal(lanzado.code, code)
    if (field) assert.ok(Array.isArray(lanzado.errors[field]), 'Falta el error del campo ' + field)
  }
  async function todos(negocioId, filtros = {}) {
    const items = []
    for (let page = 1; ; page++) {
      const pagina = await prods.listarProductos(negocioId, { page, ...filtros })
      items.push(...pagina.results)
      if (pagina.next === null) return items
    }
  }
  async function idsPermisos(codigos) {
    const todosP = []
    for (let page = 1; ; page++) {
      const pagina = await roles.listarPermisos(1, { page })
      todosP.push(...pagina.results)
      if (pagina.next === null) break
    }
    return codigos.map((c) => todosP.find((p) => p.codigo === c).id)
  }
  const base = { categoria_id: 1, sku: 'x-1', nombre: 'Prueba', unidad: 'kg', precio_venta: '3.50' }

  // --- Validación del formulario (sin servidor) ---
  const ok = { categoria_id: 1, sku: 'abc-1', nombre: 'N', descripcion: '', unidad: 'kg', precio_venta: '3.50', stock_minimo: '0.000' }
  assert.deepEqual(validacion.validarProducto(ok), {})
  assert.equal(validacion.normalizarSku('  abc-1 '), 'ABC-1')
  assert.ok(validacion.validarProducto({ ...ok, categoria_id: null }).categoria_id)
  assert.ok(validacion.validarProducto({ ...ok, sku: '' }).sku)
  assert.ok(validacion.validarProducto({ ...ok, sku: '-malo' }).sku)
  assert.ok(validacion.validarProducto({ ...ok, nombre: ' ' }).nombre)
  assert.ok(validacion.validarProducto({ ...ok, nombre: 'x'.repeat(151) }).nombre)
  assert.ok(validacion.validarProducto({ ...ok, descripcion: 'x'.repeat(501) }).descripcion)
  assert.ok(validacion.validarProducto({ ...ok, precio_venta: '2.001' }).precio_venta)
  assert.ok(validacion.validarProducto({ ...ok, precio_venta: '1,5' }).precio_venta)
  assert.ok(validacion.validarProducto({ ...ok, precio_venta: '-1' }).precio_venta)
  assert.ok(validacion.validarProducto({ ...ok, precio_venta: '' }).precio_venta)
  assert.ok(validacion.validarProducto({ ...ok, unidad: 'unidad', stock_minimo: '1.5' }).stock_minimo)
  assert.deepEqual(validacion.validarProducto({ ...ok, unidad: 'kg', stock_minimo: '1.5' }), {})
  assert.ok(validacion.validarProducto({ ...ok, stock_minimo: '1.0001' }).stock_minimo)
  console.log('OK validación del formulario: SKU, textos, categoría, precio y stock mínimo como cadenas.')

  // --- Crear, editar y respuesta exacta ---
  reset()
  await login('admin_tienda')
  const antes = (await todos(1)).length
  const nuevo = await prods.crearProducto(1, { ...base, sku: '  abc-1 ', precio_venta: '3.5', stock_minimo: '1.5' })
  assert.equal(nuevo.sku, 'ABC-1')
  assert.equal(nuevo.precio_venta, '3.50')
  assert.equal(nuevo.stock_minimo, '1.500')
  assert.equal(nuevo.categoria_nombre, 'General')
  assert.equal(nuevo.activo, true)
  assert.equal((await todos(1)).length, antes + 1)
  assert.deepEqual(await prods.obtenerProducto(1, nuevo.id), nuevo)
  const editado = await prods.actualizarProducto(1, nuevo.id, { nombre: 'Renombrado', precio_venta: '4' })
  assert.equal(editado.nombre, 'Renombrado')
  assert.equal(editado.precio_venta, '4.00')
  assert.equal(editado.sku, 'ABC-1')
  assert.equal((await prods.actualizarProducto(1, nuevo.id, { activo: false })).activo, false)
  assert.equal((await prods.actualizarProducto(1, nuevo.id, { activo: true })).activo, true)
  console.log('OK crear y editar: SKU normalizado, decimales como cadena, detalle y activación.')

  // --- Errores sin cambios parciales ---
  const cantidad = (await todos(1)).length
  await error(() => prods.crearProducto(1, { ...base, sku: 'e1', precio_venta: '2.001' }), 'validation_error', 'precio_venta')
  await error(() => prods.crearProducto(1, { ...base, sku: 'comun-01' }), 'validation_error', 'sku')
  await error(() => prods.crearProducto(1, { ...base, sku: 'e2', nombre: ' ' }), 'validation_error', 'nombre')
  await error(() => prods.crearProducto(1, { ...base, sku: 'e3', unidad: 'unidad', stock_minimo: '1.5' }), 'validation_error', 'stock_minimo')
  await error(() => prods.crearProducto(1, { ...base, sku: 'e4', categoria_id: 2 }), 'validation_error', 'categoria_id') // inactiva
  await error(() => prods.crearProducto(1, { ...base, sku: 'e5', categoria_id: 3 }), 'validation_error', 'categoria_id') // de otro negocio
  await error(() => prods.crearProducto(1, { ...base, sku: 'e6', stock_inicial: '5' }), 'validation_error', 'stock_inicial')
  await error(() => prods.actualizarProducto(1, nuevo.id, {}), 'validation_error', 'non_field_errors')
  await error(() => prods.actualizarProducto(1, 9999, { nombre: 'X' }), 'not_found')
  assert.equal((await todos(1)).length, cantidad, 'Un error no debe dejar cambios parciales.')
  console.log('OK errores: precio, SKU duplicado, nombre, unidad entera, categoría inactiva o ajena, stock inicial y ID inexistente.')

  // --- Unidad inmutable tras el primer movimiento ---
  await error(() => prods.actualizarProducto(1, 1, { unidad: 'kg' }), 'validation_error', 'unidad')
  assert.equal((await prods.obtenerProducto(1, 1)).unidad, 'unidad')
  assert.equal((await prods.actualizarProducto(1, nuevo.id, { unidad: 'litro' })).unidad, 'litro') // sin movimientos
  console.log('OK unidad inmutable: bloqueada con movimientos y permitida sin ellos.')

  // --- Filtros y paginación en el servidor ---
  const conTexto = await todos(1, { search: 'renombrado' })
  assert.deepEqual(conTexto.map((p) => p.id), [nuevo.id])
  assert.equal((await prods.listarProductos(1, { search: 'comun-01' })).count, 1) // por SKU
  assert.equal((await prods.listarProductos(1, { search: 'no-existe-xyz' })).count, 0)
  const inactivos = await todos(1, { activo: false })
  assert.ok(inactivos.length >= 1 && inactivos.every((p) => !p.activo))
  const activos = await todos(1, { activo: true })
  assert.equal(activos.length + inactivos.length, (await todos(1)).length)
  assert.ok((await todos(1, { categoria_id: 1 })).every((p) => p.categoria_id === 1))
  await error(() => prods.listarProductos(1, { categoria_id: 3 }), 'validation_error', 'categoria_id')
  const p1 = await prods.listarProductos(1, { page: 1 })
  assert.equal(p1.results.length, 2)
  assert.notEqual(p1.next, null)
  const p2 = await prods.listarProductos(1, { page: 2 })
  assert.notDeepEqual(p2.results.map((p) => p.id), p1.results.map((p) => p.id))
  await error(() => prods.listarProductos(1, { page: 99 }), 'not_found')
  console.log('OK filtros y paginación: texto por nombre y SKU, estado, categoría y páginas resueltos por el servidor.')

  // --- Opciones de categoría paginadas ---
  const opciones = []
  for (let page = 1; ; page++) {
    const pagina = await cats.listarCategoriasOpciones(1, { page })
    opciones.push(...pagina.results)
    if (pagina.next === null) break
  }
  assert.ok(opciones.length >= 2)
  assert.ok(opciones.every((o) => o.negocio_id === 1 && !('activo' in o)))
  assert.equal(opciones.some((o) => o.id === 2), false, 'Las inactivas no se ofrecen.')
  console.log('OK opciones de categoría: solo activas del negocio y paginadas.')

  // --- Aislamiento entre negocios ---
  reset()
  await login('admin_ferreteria')
    await login('admin_tienda')
  await prods.crearProducto(1, { ...base, sku: 'compartido-sku' })
  await login('admin_ferreteria')
  const enFerreteria = await prods.crearProducto(2, { ...base, categoria_id: 3, sku: 'compartido-sku' }) // mismo SKU en otro negocio
  assert.equal(enFerreteria.negocio_id, 2)
  await error(() => prods.listarProductos(1), 'permission_denied')
  await login('admin_tienda')
  await error(() => prods.obtenerProducto(1, enFerreteria.id), 'not_found')
  await error(() => prods.actualizarProducto(1, enFerreteria.id, { nombre: 'Hack' }), 'not_found')
  assert.ok((await todos(1)).every((p) => p.negocio_id === 1))
  console.log('OK contexto: SKU homónimo entre negocios, IDs ajenos y negocio sin acceso.')

  // --- Permisos mínimos ---
  async function conPermisos(codigos) {
    reset()
    await login('admin_tienda')
    const rol = await roles.crearRol(1, { nombre: 'Rol de prueba', permiso_ids: await idsPermisos(codigos) })
    await membresias.crearMembresia(1, { username: 'existente', rol_id: rol.id })
    await login('existente')
    assert.deepEqual((await auth.obtenerSesion()).negocios[0].permisos.sort(), [...codigos].sort())
  }
  await conPermisos(['crear_producto'])
  const creado = await prods.crearProducto(1, { ...base, sku: 'solo-crear' })
  assert.equal(creado.sku, 'SOLO-CREAR')
  assert.ok((await cats.listarCategoriasOpciones(1)).count > 0) // categorías sin listar_categorias
  await error(() => cats.listarCategorias(1), 'permission_denied')
  await error(() => prods.listarProductos(1), 'permission_denied')
  await error(() => prods.obtenerProducto(1, creado.id), 'permission_denied')
  await error(() => prods.actualizarProducto(1, creado.id, { nombre: 'X' }), 'permission_denied')

  await conPermisos(['editar_producto'])
  assert.equal((await prods.obtenerProducto(1, 1)).sku, 'COMUN-01') // detalle por ID conocido
  assert.equal((await prods.actualizarProducto(1, 1, { descripcion: 'Editada' })).descripcion, 'Editada')
  await error(() => prods.listarProductos(1), 'permission_denied')
  await error(() => prods.crearProducto(1, { ...base, sku: 'otro' }), 'permission_denied')

  await conPermisos(['listar_productos'])
  assert.ok((await prods.listarProductos(1)).count >= 1)
  await error(() => prods.crearProducto(1, { ...base, sku: 'otro' }), 'permission_denied')
  await error(() => prods.actualizarProducto(1, 1, { nombre: 'X' }), 'permission_denied')

  reset()
  await login('compartido')
  await error(() => prods.listarProductos(1), 'permission_denied')
  await error(() => prods.crearProducto(1, { ...base, sku: 'otro' }), 'permission_denied')
  await error(() => prods.listarProductos(2), 'permission_denied')
  console.log('OK permisos mínimos: crear sin listar, editar sin listar, solo listar y cuenta sin acceso.')

  // --- Escenarios simulados ---
  reset()
  await login('admin_tienda')
  mocks.configurarMocks({ escenario: 'empty' })
  assert.equal((await prods.listarProductos(1)).count, 0)
  for (const escenario of ['permission_denied', 'not_found', 'validation_error', 'conflict']) {
    mocks.configurarMocks({ escenario })
    await error(() => prods.listarProductos(1), escenario)
  }
  mocks.configurarMocks({ escenario: 'not_authenticated' })
  await error(() => prods.listarProductos(1), 'not_authenticated')
  console.log('OK escenarios: vacío, acceso denegado, no encontrado, validación, conflicto y sesión vencida.')
  mocks.reiniciarMocks()
} finally {
  await server.close()
}
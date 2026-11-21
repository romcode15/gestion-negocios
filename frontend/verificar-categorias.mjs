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
  const { request, contextoNegocio } = await load('api/client.ts')

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
      const pagina = await cats.listarCategorias(negocioId, { page, ...filtros })
      items.push(...pagina.results)
      if (pagina.next === null) return items
    }
  }
  async function idsPermisos(codigos) {
    const todos = []
    for (let page = 1; ; page++) {
      const pagina = await roles.listarPermisos(1, { page })
      todos.push(...pagina.results)
      if (pagina.next === null) break
    }
    return codigos.map((codigo) => {
      const permiso = todos.find((p) => p.codigo === codigo)
      assert.ok(permiso, 'No existe el permiso ' + codigo)
      return permiso.id
    })
  }
  const crearProducto = (negocioId, body) =>
    request({ method: 'POST', path: contextoNegocio(negocioId) + '/productos/', body })
  const editarProducto = (negocioId, id, body) =>
    request({ method: 'PATCH', path: contextoNegocio(negocioId) + '/productos/' + id + '/', body })

  // --- Crear, editar y desactivar ---
  reset()
  await login('admin_tienda')
  const antes = await todas(1)
  const nueva = await cats.crearCategoria(1, { nombre: '  Zeta Única  ', descripcion: 'Prueba' })
  assert.deepEqual(Object.keys(nueva).sort(), ['activo', 'descripcion', 'id', 'negocio_id', 'nombre'])
  assert.equal(nueva.nombre, 'Zeta Única')
  assert.equal(nueva.activo, true)
  assert.equal((await todas(1)).length, antes.length + 1)
  assert.deepEqual(await cats.obtenerCategoria(1, nueva.id), nueva)

  const editada = await cats.actualizarCategoria(1, nueva.id, { descripcion: 'Cambiada' })
  assert.equal(editada.descripcion, 'Cambiada')
  assert.equal(editada.nombre, 'Zeta Única')
  assert.equal((await cats.obtenerCategoria(1, nueva.id)).descripcion, 'Cambiada')
  const inactiva = await cats.actualizarCategoria(1, nueva.id, { activo: false })
  assert.equal(inactiva.activo, false)
  assert.equal((await cats.actualizarCategoria(1, nueva.id, { activo: true })).activo, true)
  console.log('OK crear, editar y desactivar: recorte, respuesta exacta y lecturas posteriores.')

  // --- Validaciones y errores sin cambios parciales ---
  const cantidad = (await todas(1)).length
  await error(() => cats.crearCategoria(1, { nombre: '   ' }), 'validation_error', 'nombre')
  await error(() => cats.crearCategoria(1, { nombre: 'x'.repeat(151) }), 'validation_error', 'nombre')
  await error(() => cats.crearCategoria(1, { nombre: 'Ok', descripcion: 'x'.repeat(501) }), 'validation_error', 'descripcion')
  await error(() => cats.crearCategoria(1, { nombre: 'Zeta Única' }), 'validation_error', 'nombre')
  await error(() => cats.actualizarCategoria(1, nueva.id, {}), 'validation_error', 'non_field_errors')
  await error(() => cats.actualizarCategoria(1, nueva.id, { negocio_id: 2 }), 'validation_error', 'negocio_id')
  await error(() => cats.actualizarCategoria(1, nueva.id, { nombre: antes[0].nombre }), 'validation_error', 'nombre')
  await error(() => cats.actualizarCategoria(1, 9999, { nombre: 'X' }), 'not_found')
  assert.equal((await todas(1)).length, cantidad, 'Un error no debe dejar cambios parciales.')
  assert.equal((await cats.obtenerCategoria(1, nueva.id)).nombre, 'Zeta Única')
  console.log('OK validación del servidor: vacío, longitudes, duplicado, PATCH vacío, campo ajeno e ID inexistente.')

  // --- Categoría con productos activos ---
  const conProductos = await cats.crearCategoria(1, { nombre: 'Con productos' })
  const producto = await crearProducto(1, { categoria_id: conProductos.id, sku: 'cat-test-1', nombre: 'Producto de prueba', unidad: 'unidad', precio_venta: '10.00' })
  await error(() => cats.actualizarCategoria(1, conProductos.id, { activo: false }), 'validation_error', 'activo')
  assert.equal((await cats.obtenerCategoria(1, conProductos.id)).activo, true)
  await editarProducto(1, producto.id, { activo: false })
  assert.equal((await cats.actualizarCategoria(1, conProductos.id, { activo: false })).activo, false)
  console.log('OK desactivar: bloqueada con productos activos y permitida cuando ya no los hay.')

  // --- Semilla: General (id 1) tiene un producto activo ---
  await error(() => cats.actualizarCategoria(1, 1, { activo: false }), 'validation_error', 'activo')
  assert.equal((await cats.obtenerCategoria(1, 1)).activo, true)
  assert.equal((await cats.actualizarCategoria(1, 2, { descripcion: 'Archivo editado' })).descripcion, 'Archivo editado')
  console.log('OK semilla: categoría con producto activo no se desactiva.')

  // --- Filtros y página llegan al servidor ---
  const unica = await todas(1, { search: 'zeta' })
  assert.deepEqual(unica.map((c) => c.id), [nueva.id])
  assert.equal((await cats.listarCategorias(1, { search: 'no-existe-xyz' })).count, 0)
  const inactivas = await todas(1, { activo: false })
  assert.ok(inactivas.length >= 1 && inactivas.every((c) => !c.activo))
  const activas = await todas(1, { activo: true })
  assert.ok(activas.length >= 1 && activas.every((c) => c.activo))
  assert.equal(activas.length + inactivas.length, (await todas(1)).length)
  const primera = await cats.listarCategorias(1, { page: 1 })
  assert.equal(primera.results.length, 2)
  assert.notEqual(primera.next, null)
  const segunda = await cats.listarCategorias(1, { page: 2 })
  assert.equal(segunda.count, primera.count)
  assert.notDeepEqual(segunda.results.map((c) => c.id), primera.results.map((c) => c.id))
  await error(() => cats.listarCategorias(1, { page: 99 }), 'not_found')
  console.log('OK filtros y paginación: búsqueda, estado y páginas resueltos por el servidor.')

  // --- Aislamiento entre negocios ---
  reset()
  await login('admin_ferreteria')
  const enFerreteria = await cats.crearCategoria(2, { nombre: 'Zeta Única' })
  assert.equal(enFerreteria.negocio_id, 2)
  await error(() => cats.listarCategorias(1), 'permission_denied')
  await login('admin_tienda')
  await cats.crearCategoria(1, { nombre: 'Zeta Única' })
  await error(() => cats.obtenerCategoria(1, enFerreteria.id), 'not_found')
  await error(() => cats.actualizarCategoria(1, enFerreteria.id, { nombre: 'Hack' }), 'not_found')
  assert.equal((await todas(1)).every((c) => c.negocio_id === 1), true)
  await error(() => cats.listarCategorias(2), 'permission_denied')
  console.log('OK contexto: nombres homónimos entre negocios, IDs ajenos y negocio sin acceso.')

  // --- Permisos mínimos ---
  async function conPermisos(codigos) {
    reset()
    await login('admin_tienda')
    const permiso_ids = await idsPermisos(codigos)
    const rol = await roles.crearRol(1, { nombre: 'Rol de prueba', permiso_ids })
    await membresias.crearMembresia(1, { username: 'existente', rol_id: rol.id })
    await cats.crearCategoria(1, { nombre: 'Base' })
    await login('existente')
    const permisos = (await auth.obtenerSesion()).negocios[0].permisos.sort()
    assert.deepEqual(permisos, [...codigos].sort())
  }
  await conPermisos(['crear_categoria'])
  const creada = await cats.crearCategoria(1, { nombre: 'Solo crear' })
  assert.equal(creada.nombre, 'Solo crear')
  await error(() => cats.listarCategorias(1), 'permission_denied')
  await error(() => cats.obtenerCategoria(1, creada.id), 'permission_denied')
  await error(() => cats.actualizarCategoria(1, creada.id, { nombre: 'X' }), 'permission_denied')

  await conPermisos(['editar_categoria'])
  const baseId = (await (async () => { await login('admin_tienda'); return todas(1) })()).find((c) => c.nombre === 'Base').id
  await login('existente')
  assert.equal((await cats.obtenerCategoria(1, baseId)).nombre, 'Base')
  assert.equal((await cats.actualizarCategoria(1, baseId, { descripcion: 'Editada' })).descripcion, 'Editada')
  await error(() => cats.listarCategorias(1), 'permission_denied')
  await error(() => cats.crearCategoria(1, { nombre: 'Otra' }), 'permission_denied')

  await conPermisos(['listar_categorias'])
  assert.ok((await cats.listarCategorias(1)).count >= 1)
  await error(() => cats.crearCategoria(1, { nombre: 'Otra' }), 'permission_denied')
  const existente = (await cats.listarCategorias(1)).results[0]
  await error(() => cats.actualizarCategoria(1, existente.id, { nombre: 'X' }), 'permission_denied')

  reset()
  await login('compartido')
  await error(() => cats.listarCategorias(1), 'permission_denied')
  await error(() => cats.crearCategoria(1, { nombre: 'X' }), 'permission_denied')
  await error(() => cats.listarCategorias(2), 'permission_denied')
  console.log('OK permisos mínimos: crear sin listar, editar sin listar, solo listar y cuenta sin acceso.')

  // --- Escenarios simulados ---
  reset()
  await login('admin_tienda')
  mocks.configurarMocks({ escenario: 'empty' })
  assert.equal((await cats.listarCategorias(1)).count, 0)
  for (const [escenario, codigo] of [['permission_denied', 'permission_denied'], ['not_found', 'not_found'], ['validation_error', 'validation_error'], ['conflict', 'conflict']]) {
    mocks.configurarMocks({ escenario })
    await error(() => cats.listarCategorias(1), codigo)
  }
  mocks.configurarMocks({ escenario: 'not_authenticated' })
  await error(() => cats.listarCategorias(1), 'not_authenticated')
  console.log('OK escenarios: vacío, acceso denegado, no encontrado, validación, conflicto y sesión vencida.')
  mocks.reiniciarMocks()
} finally {
  await server.close()
}
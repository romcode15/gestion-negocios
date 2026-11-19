import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const mocks = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const roles = await load('features/roles/api.ts')
  const membresias = await load('features/membresias/api.ts')
  const validacion = await load('features/membresias/validacion.ts')
  const seleccion = await load('features/membresias/seleccion.ts')
  const { ApiException } = await load('api/errors.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { SelectorRoles } = await load('features/membresias/components/SelectorRoles.tsx')
  const { ListaMembresias } = await load('features/membresias/components/ListaMembresias.tsx')
  const { CrearMembresiaForm } = await load('features/membresias/components/CrearMembresiaForm.tsx')
  const { MembresiasPage } = await load('features/membresias/pages/index.tsx')

  const rol = (id, nombre, negocio_id = 1) => ({ id, nombre, negocio_id, predefinido: false, permiso_ids: [] })
  const usuario = (id, username, is_active = true) => ({ id, username, is_active })
  const membresia = (id, user, rol_id, activo = true) => ({ id, usuario: user, negocio_id: 1, rol_id, activo })
  const pagina = (results, count = results.length) => ({ count, next: count > 2 ? 'mock:/n' : null, previous: null, results })

  // --- Validación y construcción de solicitudes ---
  const vacia = { username: ' ', password: '', rol_id: null, modo: 'nueva' }
  assert.deepEqual(Object.keys(validacion.validarMembresia(vacia)).sort(), ['password', 'rol_id', 'username'])
  assert.deepEqual(Object.keys(validacion.validarMembresia({ ...vacia, username: 'existente', modo: 'existente' })), ['rol_id'])
  assert.deepEqual(validacion.validarMembresia({ username: 'cuenta', password: 'Secreto123!', rol_id: 4, modo: 'nueva' }), {})

  const nueva = validacion.aSolicitudMembresia({ username: ' nueva ', password: 'Secreto123!', rol_id: 4, modo: 'nueva' })
  assert.deepEqual(nueva, { username: 'nueva', password: 'Secreto123!', rol_id: 4 })
  const existente = validacion.aSolicitudMembresia({ username: ' existente ', password: 'NoDebeEnviarse', rol_id: 4, modo: 'existente' })
  assert.deepEqual(existente, { username: 'existente', rol_id: 4 })
  assert.equal(Object.hasOwn(existente, 'password'), false)
  assert.deepEqual(validacion.aSolicitudCambioRol(4), { rol_id: 4 })
  assert.deepEqual(validacion.validarRol(0), ['Selecciona un rol del negocio activo.'])
  assert.throws(() => validacion.aSolicitudCambioRol(null), /obligatorio/)
  console.log('OK validación: modos explícitos, password omitido en cuenta existente y rol numérico.')

  // --- Selección de roles y resolución de nombres ---
  const acumulado = seleccion.conRoles({}, [rol(2, 'Administrador de negocio'), rol(4, 'Consulta')])
  const conOtraPagina = seleccion.conRoles(acumulado, [rol(5, 'Sin permisos', 2)])
  assert.deepEqual(seleccion.opcionesDeRoles(conOtraPagina, [], 1).map((r) => r.id), [2, 4])
  assert.deepEqual(seleccion.opcionesDeRoles(conOtraPagina, [], 2).map((r) => r.id), [5])
  assert.deepEqual(seleccion.opcionesDeRoles({ 9: rol(9, 'Global', null) }, [], null), [])
  assert.deepEqual(seleccion.opcionesDeRoles(conOtraPagina, [rol(6, 'Cajero')], 1).map((r) => r.id), [2, 4, 6])
  assert.equal(seleccion.nombreRol(acumulado, 4), 'Consulta')
  assert.equal(seleccion.nombreRol(acumulado, 99), 'Rol #99')
  console.log('OK selección: paginación acumulada, aislamiento por negocio y nombres sin ampliar el contrato.')

  // --- Render de componentes con permisos ---
  function contexto(permisos = [], negocioId = 1) {
    return {
      sesion: {
        usuario: usuario(2, 'admin_tienda'), permisos_globales: [],
        negocios: [{ id: negocioId, nombre: 'Tienda Central', rol_id: 2, permisos }],
      },
      negocioId, revision: 0, status: 'authenticated', pending: false, error: null, logoutUnconfirmed: false,
      store: {
        enContexto: async () => { throw new Error('La consulta no debe ejecutarse al renderizar.') },
        restaurar: async () => {}, cambiarNegocio: () => {},
      },
    }
  }
  const render = (Component, props = {}, permisos = []) => renderToStaticMarkup(
    React.createElement(SessionContext.Provider, { value: contexto(permisos) }, React.createElement(Component, props)),
  )
  const estadoRoles = (puedeListar, opciones = [], paginaActual = 1) => ({
    opciones, pagina: pagina(opciones), paginaActual, pendiente: false, error: null,
    puedeListar, onPagina() {}, onReintentar() {},
  })

  let html = render(SelectorRoles, { estado: estadoRoles(false), value: null, onSeleccionar() {} })
  assert.match(html, /No tienes permiso para consultar los roles asignables/)
  assert.match(html, /name="rol_id"[^>]*disabled/)
  assert.doesNotMatch(html, /Cargando roles/)
  html = render(SelectorRoles, { estado: { ...estadoRoles(true), pendiente: true }, value: null, onSeleccionar() {} })
  assert.match(html, /Cargando roles/)
  html = render(SelectorRoles, { estado: estadoRoles(true, [rol(2, 'Administrador de negocio'), rol(4, 'Consulta')]), value: 4, onSeleccionar() {} })
  assert.match(html, /Administrador de negocio/)
  assert.match(html, /Consulta/)
  assert.match(html, /Página 1/)

  const miembros = [membresia(1, usuario(2, 'admin_tienda'), 2), membresia(3, usuario(4, 'compartido'), 4, false)]
  const listaProps = {
    page: 1, pagina: pagina(miembros), pendiente: false, error: null,
    rolesPorId: acumulado, estadoRoles: estadoRoles(false), negocioId: 1, puedeAsignar: false,
    onPagina() {}, onReintentar() {}, onActualizado() {},
  }
  html = render(ListaMembresias, listaProps)
  assert.match(html, /admin_tienda/)
  assert.match(html, /compartido/)
  assert.match(html, /Administrador de negocio/)
  assert.match(html, /Consulta/)
  assert.match(html, /Activo/)
  assert.match(html, /Inactivo/)
  assert.doesNotMatch(html, /Guardar rol/)
  assert.match(render(ListaMembresias, { ...listaProps, puedeAsignar: true }), /Guardar rol/)
  assert.match(render(ListaMembresias, { ...listaProps, pendiente: true }), /Cargando membresías/)
  assert.match(render(ListaMembresias, { ...listaProps, pagina: pagina([]) }), /No hay membresías/)
  assert.match(render(ListaMembresias, { ...listaProps, pagina: null, error: new ApiException('permission_denied', 'x') }),
    /No tienes permiso para realizar esta acción/)

  html = render(CrearMembresiaForm, { negocioId: 1, estadoRoles: estadoRoles(false), onCreado() {} })
  assert.match(html, /Crear cuenta nueva/)
  assert.match(html, /Usar cuenta existente/)
  assert.match(html, /name="username"/)
  assert.match(html, /name="password"/)
  assert.match(html, /autocomplete="new-password"/i)
  assert.match(html, /name="modo"/)
  assert.match(html, /No tienes permiso para consultar los roles asignables/)
  assert.equal((html.match(/<form /g) || []).length, 1)

  html = render(MembresiasPage, {}, ['listar_membresias'])
  assert.doesNotMatch(html, /Incorporar miembro/)
  assert.match(html, /No tienes permiso para incorporar miembros/)
  assert.match(html, /No tienes permiso para cambiar roles/)
  html = render(MembresiasPage, {}, ['listar_membresias', 'crear_membresia', 'asignar_rol'])
  assert.match(html, /Incorporar miembro/)
  assert.match(html, /Cargando membresías/)
  assert.match(html, /Cargando roles/)
  assert.doesNotMatch(html, /No tienes permiso para consultar los roles asignables/)
  console.log('OK render: tabla con username/rol/estado, estados de carga y vacío, permisos por acción y modos del formulario.')

  // --- Operaciones con mocks: mutaciones y lecturas posteriores ---
  function reset() { mocks.reiniciarMocks(); mocks.configurarMocks({ latencia: 0 }) }
  const login = (username, password = 'Demo-12345!') => auth.iniciarSesion({ username, password })
  const error = async (action, code, field) => {
    let lanzado
    try {
      await action()
    } catch (cause) {
      lanzado = cause
    }
    assert.ok(lanzado, 'Se esperaba un error ' + code)
    assert.equal(lanzado.code, code)
    if (field) assert.ok(Array.isArray(lanzado.errors[field]), 'Falta el error de campo ' + field)
  }

  reset()
  await login('admin_tienda')
  const rolesTienda = await roles.listarRoles(1)
  assert.deepEqual(rolesTienda.results.map((r) => r.id), [2, 4])
  const primera = await membresias.listarMembresias(1)
  assert.equal(primera.count, 2)
  assert.deepEqual(primera.results.map((m) => m.usuario.username), ['admin_tienda', 'compartido'])
  assert.equal(primera.next, null) // Dos registros llenan la página: no hay página 2 todavía.
  await error(() => membresias.listarMembresias(1, { page: 2 }), 'not_found')

  await error(() => membresias.crearMembresia(1, { username: 'compartido', rol_id: 4 }), 'validation_error', 'username')
  await error(() => membresias.crearMembresia(1, { username: 'existente', rol_id: 3 }), 'validation_error', 'rol_id')
  await error(() => membresias.crearMembresia(1, { username: 'nueva_corta', password: '123', rol_id: 4 }), 'validation_error', 'password')

  const incorporada = await membresias.crearMembresia(1, { username: 'existente', rol_id: 4 })
  assert.equal(incorporada.usuario.id, 5)
  assert.equal(incorporada.rol_id, 4)
  assert.deepEqual(Object.keys(incorporada).sort(), ['activo', 'id', 'negocio_id', 'rol_id', 'usuario'])
  assert.equal((await membresias.listarMembresias(1)).count, 3)

  const conCuenta = await membresias.crearMembresia(1, { username: 'nueva_miembro', password: 'Miembro-12345!', rol_id: 4 })
  assert.equal(conCuenta.usuario.username, 'nueva_miembro')
  const segundaPagina = await membresias.listarMembresias(1, { page: 2 })
  assert.equal(segundaPagina.count, 4)
  assert.equal(segundaPagina.results.length, 2)
  assert.match(segundaPagina.previous, /\?page=1$/)
  await login('nueva_miembro', 'Miembro-12345!')
  assert.equal((await auth.obtenerSesion()).negocios[0].id, 1)
  await login('admin_tienda')

  const cambiada = await membresias.cambiarRolMembresia(1, incorporada.id, { rol_id: 2 })
  assert.equal(cambiada.id, incorporada.id)
  assert.equal(cambiada.rol_id, 2)
  assert.equal((await membresias.listarMembresias(1, { page: 2 })).results[0].rol_id, 2)
  await error(() => membresias.cambiarRolMembresia(1, 2, { rol_id: 4 }), 'not_found')
  await error(() => membresias.cambiarRolMembresia(1, incorporada.id, { rol_id: 3 }), 'validation_error', 'rol_id')
  await error(() => membresias.cambiarRolMembresia(0, incorporada.id, { rol_id: 2 }), 'validation_error', 'negocio_id')
  console.log('OK mocks: altas en ambas modalidades, duplicado, rol ajeno, contraseña inválida, cambio por membresía y lecturas posteriores.')

  // --- Permisos por negocio y escenarios ---
  reset()
  await login('compartido')
  const sesionCompartido = await auth.obtenerSesion()
  assert.deepEqual(sesionCompartido.negocios.map((n) => n.id), [1, 2])
  assert.deepEqual(sesionCompartido.negocios[0].permisos.sort(), ['listar_membresias', 'listar_roles'])
  assert.deepEqual(sesionCompartido.negocios[1].permisos, [])
  assert.equal((await membresias.listarMembresias(1)).count, 2)
  await error(() => membresias.listarMembresias(2), 'permission_denied')
  await error(() => membresias.crearMembresia(1, { username: 'otra', rol_id: 4 }), 'permission_denied')
  await error(() => membresias.cambiarRolMembresia(1, 3, { rol_id: 2 }), 'permission_denied')
  await error(() => roles.listarRoles(1, { page: 2 }), 'not_found')

  await login('admin_tienda')
  mocks.configurarMocks({ escenario: 'empty' })
  assert.equal((await membresias.listarMembresias(1)).count, 0)
  mocks.configurarMocks({ escenario: 'permission_denied' })
  await error(() => membresias.listarMembresias(1), 'permission_denied')
  mocks.configurarMocks({ escenario: 'not_found' })
  await error(() => membresias.listarMembresias(1), 'not_found')
  mocks.configurarMocks({ escenario: 'validation_error' })
  await error(() => membresias.crearMembresia(1, { username: 'x', rol_id: 4 }), 'validation_error', 'non_field_errors')

  // --- La misma cuenta en dos negocios y refresco de sesión ---
  reset()
  await login('compartido')
  assert.equal((await membresias.listarMembresias(1)).results.some((m) => m.usuario.username === 'compartido'), true)
  await login('admin_ferreteria')
  assert.equal((await membresias.listarMembresias(2)).results.some((m) => m.usuario.username === 'compartido'), true)
  await login('admin_tienda')
  await error(() => membresias.crearMembresia(1, { username: 'compartido', rol_id: 4 }), 'validation_error', 'username')
  const propia = (await membresias.listarMembresias(1)).results.find((m) => m.usuario.username === 'admin_tienda')
  await error(() => membresias.cambiarRolMembresia(1, propia.id, { rol_id: 4 }), 'validation_error', 'rol_id')
  assert.equal((await auth.obtenerSesion()).negocios[0].rol_id, 2)
  // Un administrador adicional debe estar activo para permitir la degradación.
  await membresias.crearMembresia(1, { username: 'existente', rol_id: 2 })
  await membresias.cambiarRolMembresia(1, propia.id, { rol_id: 4 })
  const sesionRefrescada = await auth.obtenerSesion()
  assert.deepEqual(sesionRefrescada.negocios[0].permisos.sort(), ['listar_membresias', 'listar_roles'])
  await error(() => membresias.cambiarRolMembresia(1, propia.id, { rol_id: 2 }), 'permission_denied')
  console.log('OK permisos y contexto: aislamiento entre negocios, cuenta compartida, escenarios y sesión reflejando el cambio de rol propio.')
  reset()
  await login('admin_tienda')
  mocks.configurarMocks({ usuariosInactivos: [5] })
  await error(() => membresias.crearMembresia(1, { username: 'existente', rol_id: 4 }), 'validation_error', 'username')
  await error(() => membresias.crearMembresia(1, { username: 'no_existe', rol_id: 4 }), 'validation_error', 'username')
  await roles.crearRol(1, { nombre: 'Rol página 2 A', permiso_ids: [5] })
  await roles.crearRol(1, { nombre: 'Rol página 2 B', permiso_ids: [7] })
  await roles.crearRol(1, { nombre: 'Rol página 3', permiso_ids: [] })
  const { cargarPaginasRoles } = await load('features/membresias/catalogo.ts')
  const catalogo = await cargarPaginasRoles(1)
  assert.equal(catalogo.length, 3)
  assert.equal(catalogo.flatMap((p) => p.results).every((r) => r.negocio_id === 1), true)
  assert.equal(seleccion.nombreRol(seleccion.conRoles({}, catalogo.flatMap((p) => p.results)), catalogo[2].results[0].id), 'Rol página 3')
  console.log('OK cuenta inactiva/inexistente y catálogo de roles de tres páginas sin mezclar negocios.')

  // La consulta asignable no exige listar_roles ni permite delegar privilegios superiores.
  for (const permission of ['crear_membresia', 'asignar_rol']) {
    reset()
    await login('admin_tienda')
    const permissionId = permission === 'crear_membresia' ? 8 : 9
    const limited = await roles.crearRol(1, { nombre: 'Operador limitado', permiso_ids: [permissionId] })
    const empty = await roles.crearRol(1, { nombre: 'Rol vacío', permiso_ids: [] })
    const actor = await membresias.crearMembresia(1, { username: 'existente', rol_id: limited.id })
    await login('existente')
    await error(() => roles.listarRoles(1), 'permission_denied')
    const { cargarPaginasRolesAsignables } = await load('features/membresias/catalogo.ts')
    const asignables = (await cargarPaginasRolesAsignables(1)).flatMap((p) => p.results)
    assert.deepEqual(asignables.map((r) => r.id), [limited.id, empty.id])
    await error(() => roles.listarRolesAsignables(2), 'permission_denied')
    if (permission === 'crear_membresia') {
      await error(() => membresias.crearMembresia(1, { username: 'escalada', password: 'Cuenta-12345!', rol_id: 2 }), 'validation_error', 'rol_id')
      const created = await membresias.crearMembresia(1, { username: 'permitida', password: 'Cuenta-12345!', rol_id: empty.id })
      assert.equal(created.rol_id, empty.id)
    } else {
      await error(() => membresias.cambiarRolMembresia(1, 3, { rol_id: 2 }), 'validation_error', 'rol_id')
      assert.equal((await membresias.cambiarRolMembresia(1, 3, { rol_id: empty.id })).rol_id, empty.id)
      assert.equal((await membresias.cambiarRolMembresia(1, actor.id, { rol_id: limited.id })).rol_id, limited.id)
    }
  }
  reset()
  await login('compartido')
  await error(() => roles.listarRolesAsignables(1), 'permission_denied')
  await login('admin_tienda')
  const backup = await membresias.crearMembresia(1, { username: 'existente', rol_id: 2 })
  mocks.configurarMocks({ usuariosInactivos: [backup.usuario.id] })
  await error(() => membresias.cambiarRolMembresia(1, 1, { rol_id: 4 }), 'validation_error', 'rol_id')
  console.log('OK cierre fase 1: permisos mínimos, catálogo asignable aislado, delegación limitada y último administrador activo.')
  mocks.reiniciarMocks()
} finally {
  await server.close()
}

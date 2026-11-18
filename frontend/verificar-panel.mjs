import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  const validacionUsuario = await load('features/usuarios/validacion.ts')
  const validacionNegocio = await load('features/negocios/validacion.ts')
  const seleccion = await load('features/usuarios/seleccion.ts')
  const { ApiException } = await load('api/errors.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { ListaNegocios } = await load('features/negocios/components/ListaNegocios.tsx')
  const { CrearUsuarioForm } = await load('features/usuarios/components/CrearUsuarioForm.tsx')
  const { SelectorAdministrador } = await load('features/usuarios/components/SelectorAdministrador.tsx')
  const { CrearNegocioForm } = await load('features/negocios/components/CrearNegocioForm.tsx')
  const { NegociosPage } = await load('features/negocios/pages/index.tsx')

  const usuario = (id, username, is_active = true) => ({ id, username, is_active })
  function contexto(permisos = []) {
    return {
      sesion: { usuario: usuario(1, 'plataforma'), permisos_globales: permisos, negocios: [] },
      negocioId: null, revision: 0, status: 'authenticated', pending: false, error: null, logoutUnconfirmed: false,
      store: { enContexto: async () => { throw new Error('La consulta no debe ejecutarse durante el renderizado de prueba.') } },
    }
  }
  const render = (Component, props = {}, permisos = []) => renderToStaticMarkup(
    React.createElement(SessionContext.Provider, { value: contexto(permisos) }, React.createElement(Component, props)),
  )

  assert.deepEqual(Object.keys(validacionUsuario.validarUsuario({ username: ' ', password: '' })).sort(), ['password', 'username'])
  assert.deepEqual(Object.keys(validacionUsuario.validarUsuario({ username: 'cuenta', password: 'Secreto123!' })), [])
  assert.deepEqual(validacionUsuario.aSolicitudUsuario({ username: ' cuenta ', password: 'Secreto123!' }),
    { username: 'cuenta', password: 'Secreto123!' })

  const sinDatos = validacionNegocio.validarNegocio({ nombre: ' ', tipo: '', administrador: null })
  assert.deepEqual(Object.keys(sinDatos).sort(), ['administrador_id', 'nombre', 'tipo'])
  assert.deepEqual(Object.keys(validacionNegocio.validarNegocio({ nombre: 'Tienda', tipo: 'tienda', administrador: usuario(9, 'inactiva', false) })), ['administrador_id'])
  assert.deepEqual(Object.keys(validacionNegocio.validarNegocio({ nombre: 'Tienda', tipo: 'tienda', administrador: usuario(0, 'invalida') })), ['administrador_id'])
  assert.deepEqual(validacionNegocio.aSolicitudNegocio({ nombre: ' Tienda ', tipo: ' tienda ', administrador: usuario(9, 'admin') }),
    { nombre: 'Tienda', tipo: 'tienda', administrador_id: 9 })

  const paginaUno = seleccion.conUsuarios({}, [usuario(1, 'plataforma'), usuario(2, 'admin_tienda')])
  const acumulado = seleccion.conUsuarios(paginaUno, [usuario(3, 'compartido')])
  const elegido = usuario(4, 'creada_ahora')
  assert.deepEqual(seleccion.opcionesDe(acumulado, [], elegido).map((u) => u.id), [1, 2, 3, 4])
  assert.deepEqual(seleccion.opcionesDe(acumulado, [], null, [elegido]).map((u) => u.id), [1, 2, 3, 4])
  assert.deepEqual(seleccion.opcionesDe(acumulado, [usuario(5, 'otra')], elegido).map((u) => u.id), [1, 2, 3, 4, 5])
  console.log('OK validaciones y acumulación: campos requeridos, ID numérico, payload sin username/password y selección entre páginas.')

  const pagina = {
    count: 3, next: 'mock:/api/v1/plataforma/negocios/?page=2', previous: null,
    results: [usuarioNegocio(1, 'Tienda Central', 'tienda', true), usuarioNegocio(2, 'Ferretería Norte', 'ferretería', false)],
  }
  function usuarioNegocio(id, nombre, tipo, activo) { return { id, nombre, tipo, activo } }
  const lista = (props) => render(ListaNegocios, { page: 1, pagina, pendiente: false, error: null, onPagina() {}, onReintentar() {}, ...props })
  let html = lista()
  assert.match(html, /Tienda Central/)
  assert.match(html, /Ferretería Norte/)
  assert.match(html, /Activo/)
  assert.match(html, /Inactivo/)
  assert.match(html, /Página 1/)
  assert.match(html, /Siguiente/)
  assert.doesNotMatch(html, /<h2[^>]*>No hay negocios/)
  assert.match(lista({ pendiente: true }), /Cargando negocios/)
  assert.match(lista({ pagina: null, error: new ApiException('permission_denied', 'x') }), /No tienes permiso para realizar esta acción/)
  assert.match(lista({ pagina: { count: 0, next: null, previous: null, results: [] } }), /No hay negocios/)
  console.log('OK listado: nombre, tipo y estado, paginación, carga, vacío y error de acceso.')

  html = render(CrearUsuarioForm, { onCreado() {} })
  assert.match(html, /Nombre de usuario/)
  assert.match(html, /name="username"/)
  assert.match(html, /name="password"/)
  assert.match(html, /type="password"/)
  assert.match(html, /autocomplete="new-password"/i)
  assert.match(html, /Crear cuenta/)

  html = render(SelectorAdministrador, { value: null, onSeleccionar() {} })
  assert.match(html, /No tienes permiso para listar ni crear cuentas/)
  assert.doesNotMatch(html, /name="administrador_id"/)
  assert.doesNotMatch(html, /Cargando cuentas/)
  html = render(SelectorAdministrador, { value: null, onSeleccionar() {} }, ['listar_usuarios'])
  assert.match(html, /Cargando cuentas/)
  assert.doesNotMatch(html, /No tienes permiso para listar/)
  assert.doesNotMatch(html, /Crear cuenta nueva/)
  html = render(CrearNegocioForm, { onCreado() {} }, ['listar_negocios', 'crear_negocio', 'listar_usuarios', 'crear_usuario'])
  assert.match(html, /Crear cuenta nueva/)
  assert.equal((html.match(/<form /g) || []).length, 2)

  html = render(NegociosPage, {}, ['listar_negocios'])
  assert.doesNotMatch(html, /Crear negocio/)
  assert.match(html, /No tienes permiso para crear negocios/)
  html = render(NegociosPage, {}, ['listar_negocios', 'crear_negocio'])
  assert.match(html, /Crear negocio/)
  assert.match(html, /Cargando negocios/)
  console.log('OK permisos por acción: sin listar_usuarios no hay consulta ni selector; crear_negocio se muestra solo con el permiso.')
} finally {
  await server.close()
}

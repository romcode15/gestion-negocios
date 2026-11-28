import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/negocio/ventas' })
const originals = new Map()
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
  'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle',
  'sessionStorage', 'localStorage']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name],
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const root = createRoot(document.getElementById('root'))
const h = React.createElement
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function flush(ms = 10, veces = 5) {
  for (let i = 0; i < veces; i++) await act(async () => { await pause(ms) })
}
async function render(component) { await act(async () => root.render(component)) }
async function click(element) { assert.ok(element); await act(async () => element.click()); await flush() }
async function change(element, value) {
  assert.ok(element)
  const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  await flush()
}
async function submit(formulario) {
  assert.ok(formulario)
  await act(async () => {
    formulario.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
}
function boton(etiqueta, exigir = true) {
  const encontrado = [...document.querySelectorAll('button')]
    .find((item) => item.textContent.trim() === etiqueta || item.getAttribute('aria-label') === etiqueta)
  if (exigir) assert.ok(encontrado, 'No existe el botón ' + etiqueta)
  return encontrado ?? null
}
function campo(name, formulario = null) {
  const elemento = document.querySelector((formulario ? formulario + ' ' : '') + '[name="' + name + '"]')
  assert.ok(elemento, 'No existe el campo ' + name)
  return elemento
}
function formulario(etiqueta, exigir = true) {
  const elemento = document.querySelector('form[aria-label="' + etiqueta + '"]')
  if (exigir) assert.ok(elemento, 'No existe el formulario ' + etiqueta)
  return elemento
}
function filas() { return [...document.querySelectorAll('table tbody tr')] }
function errores() { return [...document.querySelectorAll('.field-errors')].map((item) => item.textContent).join(' ') }
function consultas(negocio) {
  return peticiones.filter((item) => item.method === 'GET' &&
    new URL(item.path, 'http://mock.local').pathname === '/negocios/' + negocio + '/ventas/')
}
function params(item) { return new URL(item.path, 'http://mock.local').searchParams }

let mock
let originalTransportRequest
let peticiones = []
let manipulador = null

try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  mock = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const ventas = await load('features/ventas/api.ts')
  const { ApiException } = await load('api/errors.ts')
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { ToastContext } = await load('components/feedback/ToastContext.ts')
  const { VentasPage } = await load('features/ventas/pages/index.ts')

  originalTransportRequest = mock.mockTransport.request

  async function sembrar() {
    await auth.iniciarSesion({ username: 'admin_ferreteria', password: 'Demo-12345!' })
    const notas = ['Observación buscar COMUN-01', 'Nota sin relación']
    for (const observaciones of notas) {
      await ventas.registrarVenta(2, {
        clave_operacion: randomUUID(),
        observaciones,
        detalles: [{ producto_id: 4, cantidad: '0.125', precio_unitario_esperado: '8.00' }],
      })
    }
  }

  async function preparar({ permisos = ['listar_ventas'], negocio = 2, username = 'admin_ferreteria',
    otroNegocio = null, sembrarVentas = false } = {}) {
    mock.reiniciarMocks()
    mock.configurarMocks({ latencia: 0 })
    if (sembrarVentas) await sembrar()
    else await auth.iniciarSesion({ username, password: 'Demo-12345!' })
    const base = await auth.obtenerSesion()
    const session = { ...base, negocios: base.negocios.map((item) => ({ ...item })) }
    if (otroNegocio !== null && !session.negocios.some((item) => item.id === otroNegocio)) {
      session.negocios.push({ id: otroNegocio, nombre: 'Negocio adicional', rol_id: 2, permisos: [] })
    }
    if (permisos !== null) {
      session.negocios = session.negocios.map((item) => item.id === negocio ? { ...item, permisos } : item)
    }
    const store = crearSessionStore({
      obtenerSesion: async () => session,
      iniciarSesion: async () => session,
      cerrarSesion: async () => {},
    })
    await store.restaurar()
    if (store.getSnapshot().negocioId !== negocio) store.cambiarNegocio(negocio)
    peticiones = []
    manipulador = null
    mock.mockTransport.request = async (request) => {
      peticiones.push({ method: request.method, path: request.path, body: request.body, signal: request.signal })
      return manipulador ? manipulador(request, originalTransportRequest) : originalTransportRequest(request)
    }
    function Proveedor() {
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      return h(ToastContext.Provider, { value: { notify: () => {} } },
        h(SessionContext.Provider, { value: { ...state, store } }, h(VentasPage, { key: state.revision })))
    }
    await render(h(Proveedor))
    await flush()
    return store
  }

  // 1. Permiso aislado: columnas exactas, ambos estados, dígitos y fechas legibles.
  await preparar({ sembrarVentas: true })
  assert.ok(consultas(2).length >= 1, 'Falta la consulta inicial de listado.')
  assert.equal(peticiones.some((item) => item.method !== 'GET'), false, 'El listado no escribe.')
  assert.equal(peticiones.some((item) => /\/productos\/?|\/existencias\/|\/movimientos\//.test(item.path)), false,
    'El listado no consulta opciones, existencias ni movimientos.')
  const listado = document.querySelector('[aria-label="Listado de ventas"]')
  assert.ok(listado, 'No se montó el listado.')
  assert.deepEqual([...document.querySelectorAll('table th')].map((item) => item.textContent),
    ['ID', 'Fecha', 'Vendedor', 'Estado', 'Total'])
  assert.equal(filas().length, 2, 'El tamaño de página del contrato es 2.')
  assert.match(document.querySelector('.collection-count').textContent, /4 registros/)
  assert.match(listado.textContent, /confirmada/)
  assert.match(listado.textContent, /admin_ferreteria/)
  assert.match(listado.textContent, /1\.00/)
  assert.equal(document.querySelector('table input'), null)
  assert.equal(document.querySelector('table button[aria-label^="Abrir detalle"]') !== null, true)
  for (const id of ['ventas-search', 'ventas-estado', 'ventas-desde', 'ventas-hasta']) {
    assert.ok(document.querySelector('label[for="' + id + '"]'), 'Falta la etiqueta visible de ' + id)
  }
  assert.equal(listado.getAttribute('tabindex'), '0', 'La región de la tabla es enfocable por teclado.')
  const primera = Number(filas()[0].querySelector('td').textContent.trim())
  await click(boton('Abrir detalle de la venta ' + primera))
  assert.match(document.querySelector('output').textContent, new RegExp('#' + primera))
  assert.equal(boton('Abrir detalle de la venta ' + primera).getAttribute('aria-pressed'), 'true')
  await click(boton('Siguiente'))
  assert.match(listadoTexto(), /anulada/, 'Ambos estados aparecen en el listado paginado.')
  assert.match(listadoTexto(), /2025-12-31 11:00 UTC/)
  assert.match(listadoTexto(), /2025-12-31 12:00 UTC/)
  assert.match(listadoTexto(), /2\.00/)
  assert.match(listadoTexto(), /4\.00/)
  assert.ok(document.querySelector('table time[datetime="2025-12-31T11:00:00.000Z"]'))
  await click(boton('Anterior'))
  console.log('OK F7 listado: columnas, ambos estados, importes/fechas legibles, selección y sin consultas prohibidas.')

  // 2. Búsqueda servidor sobre SKU/nombre/observaciones y filtro de estado.
  await change(campo('search', 'form[aria-label="Filtrar ventas"]'), 'Observación buscar')
  await click(boton('Aplicar filtros'))
  let ultima = consultas(2).at(-1)
  assert.equal(params(ultima).get('search'), 'Observación buscar')
  assert.equal(params(ultima).get('page'), '1')
  assert.equal(filas().length, 1, 'La búsqueda se resuelve en servidor, no sobre la página descargada.')
  await change(campo('search', 'form[aria-label="Filtrar ventas"]'), 'Artículo común')
  await click(boton('Aplicar filtros'))
  assert.equal(params(consultas(2).at(-1)).get('search'), 'Artículo común')
  assert.equal(filas().length, 2, 'La búsqueda por nombre/SKU se resuelve en servidor; la tabla solo muestra las columnas del contrato.')
  await change(campo('search', 'form[aria-label="Filtrar ventas"]'), '')
  await change(campo('estado', 'form[aria-label="Filtrar ventas"]'), 'anulada')
  await click(boton('Aplicar filtros'))
  assert.equal(params(consultas(2).at(-1)).get('estado'), 'anulada')
  assert.equal(filas().length, 1)
  assert.match(listadoTexto(), /anulada/)
  assert.doesNotMatch(listadoTexto(), /confirmada/)
  console.log('OK F7 filtros: búsqueda por observaciones/nombre/SKU y estado enviados al servidor.')

  function listadoTexto() { return document.querySelector('[aria-label="Listado de ventas"]').textContent }

  // 3. Fechas con zona, límite superior exclusivo y rango inválido.
  await change(campo('estado', 'form[aria-label="Filtrar ventas"]'), '')
  await change(campo('desde', 'form[aria-label="Filtrar ventas"]'), '2025-12-31')
  await change(campo('hasta', 'form[aria-label="Filtrar ventas"]'), '2026-01-01')
  await click(boton('Aplicar filtros'))
  ultima = consultas(2).at(-1)
  assert.equal(params(ultima).get('desde'), '2025-12-31T00:00:00Z')
  assert.equal(params(ultima).get('hasta'), '2026-01-02T00:00:00Z', 'El límite superior es exclusivo e incluye el día indicado.')
  assert.equal(filas().length, 2)
  const antesRango = consultas(2).length
  await change(campo('hasta', 'form[aria-label="Filtrar ventas"]'), '2025-12-30')
  await click(boton('Aplicar filtros'))
  assert.match(errores(), /Hasta debe ser posterior a desde/)
  assert.equal(consultas(2).length, antesRango, 'Un rango inválido no lanza otra consulta.')
  await click(boton('Limpiar filtros'))
  assert.equal(consultas(2).at(-1) ? params(consultas(2).at(-1)).has('desde') : false, false)
  console.log('OK F7 fechas: ISO con zona, desde inclusivo/hasta exclusivo y rango inválido sin consulta.')

  // 4. Paginación, vacío, error/reintento y recuperación de página sin borrar filtros.
  await click(boton('Siguiente'))
  assert.equal(params(consultas(2).at(-1)).get('page'), '2')
  assert.equal(filas().length, 2)
  assert.match(document.querySelector('[aria-label="Paginación de listado de ventas"]').textContent, /Página 2/)
  await click(boton('Anterior'))
  assert.equal(params(consultas(2).at(-1)).get('page'), '1')
  await change(campo('search', 'form[aria-label="Filtrar ventas"]'), 'no-existe-este-texto')
  await click(boton('Aplicar filtros'))
  assert.match(document.body.textContent, /No hay ventas con estos filtros/)
  await click(boton('Limpiar filtros'))

  manipulador = (_request) => { throw new ApiException('network_error', 'Error de red simulado.', {}, 0) }
  await click(boton('Aplicar filtros'))
  assert.ok(document.querySelector('[role="alert"]'))
  manipulador = null
  await click(boton('Reintentar'))
  assert.equal(filas().length, 2)

  await change(campo('search', 'form[aria-label="Filtrar ventas"]'), 'COMUN-01')
  await click(boton('Aplicar filtros'))
  await click(boton('Siguiente'))
  assert.equal(params(consultas(2).at(-1)).get('page'), '2')
  // Se fuerza un 404 de la página 2 para comprobar la recuperación.
  manipulador = (request, original) => {
    if (params(request).get('page') === '2') {
      manipulador = null
      throw new ApiException('not_found', 'La página ya no existe.', {}, 404)
    }
    return original(request)
  }
  await click(boton('Anterior'))
  await click(boton('Siguiente'))
  const recuperada = consultas(2).at(-1)
  assert.equal(params(recuperada).get('page'), '1', 'La página inválida recupera la primera.')
  assert.equal(params(recuperada).get('search'), 'COMUN-01', 'La recuperación conserva los filtros.')
  console.log('OK F7 estados: paginación, vacío, error/reintento y página inválida sin perder filtros.')

  // 5. Solo registrar / solo anular: detalle por ID sin GET de listado.
  for (const permiso of ['registrar_venta', 'anular_venta']) {
    await preparar({ permisos: [permiso], sembrarVentas: true })
    assert.equal(formulario('Filtrar ventas', false), null)
    assert.equal(document.querySelector('table'), null)
    assert.equal(consultas(2).length, 0, 'Sin listar_ventas no se consulta el listado.')
    const idForm = formulario('Abrir venta por ID')
    for (const invalido of ['0', '-1', '1.5', '9007199254740992', 'abc']) {
      await change(campo('venta_id', 'form[aria-label="Abrir venta por ID"]'), invalido)
      await submit(idForm)
      assert.match(errores(), /ID entero positivo y seguro/)
    }
    assert.equal(document.querySelector('output'), null)
    assert.equal(peticiones.some((item) => /\/ventas\/\d+\/$/.test(item.path)), false, 'F7 no consulta el detalle.')
    await change(campo('venta_id', 'form[aria-label="Abrir venta por ID"]'), '4')
    await submit(idForm)
    assert.match(document.querySelector('output').textContent, /#4/)
    assert.equal(consultas(2).length, 0)
    assert.equal(peticiones.some((item) => /\/ventas\/\d+\/$/.test(item.path)), false)
  }
  console.log('OK F7 sin listado: formulario por ID, ID seguro/errores claros y cero GET de listado o detalle.')

  // 6. Sin permiso, tenant ajeno, inactivos y cambio de contexto con respuesta tardía.
  await preparar({ username: 'compartido', permisos: null, negocio: 2 })
  assert.match(document.body.textContent, /No tienes permiso para listar ventas/)
  assert.equal(formulario('Filtrar ventas', false), null)
  assert.equal(formulario('Abrir venta por ID', false), null)
  assert.equal(consultas(2).length, 0)

  await preparar({ permisos: ['listar_ventas'], negocio: 1, otroNegocio: 1, sembrarVentas: true })
  assert.ok(consultas(1).length >= 1)
  assert.ok(document.querySelector('[role="alert"]'), 'Un negocio ajeno no puede mostrar ventas de otro tenant.')
  assert.doesNotMatch(document.querySelector('#root').textContent, /admin_ferreteria/)

  mock.configurarMocks({ usuariosInactivos: [3] })
  await assert.rejects(() => auth.obtenerSesion(), (error) => error.code === 'not_authenticated')
  mock.configurarMocks({ usuariosInactivos: [] })

  const store = await preparar({ permisos: ['listar_ventas'], negocio: 2, otroNegocio: 1, sembrarVentas: true })
  manipulador = async (request, original) => {
    if (params(request).get('page') === '1') { await pause(120); return original(request) }
    return original(request)
  }
  await click(boton('Limpiar filtros'))
  const antesCambio = consultas(2).length
  await act(async () => store.cambiarNegocio(1))
  await flush(40, 4)
  assert.equal(consultas(2).length, antesCambio, 'No se lanza una consulta nueva al negocio anterior tras el cambio.')
  assert.equal(document.querySelector('table'), null, 'La respuesta tardía del negocio anterior se descarta.')
  assert.ok(document.body.textContent.length > 0)
  console.log('OK F7 contexto: sin permiso, tenant ajeno, inactivos y descarte de respuestas al cambiar de negocio.')
} finally {
  mock.mockTransport.request = originalTransportRequest
  await act(async () => root.unmount())
  await server.close()
  dom.window.close()
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' })
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
originals.set('requestAnimationFrame', Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'))
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => setTimeout(fn, 0) })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const root = createRoot(document.getElementById('root'))
const h = React.createElement
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function flush() { for (let i = 0; i < 5; i++) await act(async () => { await pause(10) }) }
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
async function submit(twice = false) {
  const form = document.querySelector('[role="dialog"] form')
  assert.ok(form, 'No hay formulario en el diálogo.')
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    if (twice) form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
}
function boton(etiqueta, exigir = true) {
  const encontrado = [...document.querySelectorAll('button')]
    .find((item) => item.textContent.trim() === etiqueta || item.getAttribute('aria-label') === etiqueta)
  if (exigir) assert.ok(encontrado, 'No existe el botón ' + etiqueta)
  return encontrado ?? null
}
function campo(name, dialogo = false) {
  const elemento = document.querySelector((dialogo ? '[role="dialog"] ' : '') + '[name="' + name + '"]')
  assert.ok(elemento, 'No existe el campo ' + name)
  return elemento
}
function dialogo() { return document.querySelector('[role="dialog"]') }
function filas() { return [...document.querySelectorAll('table tbody tr')] }
function consultas(negocio) {
  return peticiones.filter((item) => item.method === 'GET' && new URL(item.path, 'http://mock.local').pathname === '/negocios/' + negocio + '/movimientos/')
}
function params(item) { return new URL(item.path, 'http://mock.local').searchParams }
function historial() { return document.querySelector('[aria-label="Historial de movimientos"]') }
function errores() { return [...document.querySelectorAll('.field-errors')].map((item) => item.textContent).join(' ') }

let mock
let originalTransportRequest
let peticiones = []
let manipulador = null

try {
  const load = (path) => server.ssrLoadModule('/src/' + path)
  mock = await load('mocks/services/transport.ts')
  const auth = await load('features/auth/api.ts')
  const movimientos = await load('features/movimientos/api.ts')
  const { ApiException } = await load('api/errors.ts')
  const { crearSessionStore } = await load('app/providers/sessionStore.ts')
  const { SessionContext } = await load('app/providers/SessionContext.ts')
  const { ToastContext } = await load('components/feedback/ToastContext.ts')
  const { MovimientosPage } = await load('features/movimientos/pages/index.tsx')

  originalTransportRequest = mock.mockTransport.request

  async function preparar({ permisos = ['listar_movimientos'], negocio = 1, username = 'admin_tienda', otroNegocio = null } = {}) {
    mock.reiniciarMocks()
    mock.configurarMocks({ latencia: 0 })
    await auth.iniciarSesion({ username, password: 'Demo-12345!' })
    const base = await auth.obtenerSesion()
    const session = {
      ...base,
      negocios: base.negocios.map((item) => item.id === negocio ? { ...item, permisos } : item),
    }
    if (otroNegocio && !session.negocios.some((item) => item.id === otroNegocio.id)) {
      session.negocios.push({ id: otroNegocio.id, nombre: 'Negocio adicional', rol_id: 2, permisos: otroNegocio.permisos ?? [] })
    } else if (otroNegocio) {
      session.negocios = session.negocios.map((item) => item.id === otroNegocio.id ? { ...item, permisos: otroNegocio.permisos ?? [] } : item)
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
        h(SessionContext.Provider, { value: { ...state, store } }, h(MovimientosPage, { key: state.revision })))
    }
    await render(h(Proveedor))
    await flush()
    return store
  }

  // 1. Permiso de lectura aislado: tabla, inactivos, delta firmado y sin escrituras.
  await preparar({ permisos: ['listar_movimientos'] })
  assert.equal(boton('Entrada', false), null)
  assert.equal(boton('Salida', false), null)
  assert.equal(boton('Ajustar', false), null)
  assert.ok(consultas(1).length >= 1)
  assert.equal(peticiones.some((item) => item.path.includes('/productos/opciones/') || item.path.includes('/productos/?') || item.path.includes('/existencias/')), false)
  assert.ok(historial(), 'No se renderizó el historial.')
  assert.equal(filas().length, 2)
  assert.match(historial().textContent, /COMUN-01/)
  assert.match(historial().textContent, /LIQ-01/, 'El producto inactivo sigue en la auditoría.')
  assert.match(historial().textContent, /Carga inicial de demostración/)
  assert.match(historial().textContent, /admin_tienda/, 'El actor del movimiento se muestra.')
  assert.match(historial().textContent, /\+5\.000/)
  assert.match(historial().textContent, /2026-01-01 10:00 UTC/)
  assert.match(historial().textContent, /FechaTipoProductoSKUUnidadDeltaSaldo anteriorSaldo posteriorActorMotivo/)
  assert.equal(document.querySelector('table button, table a, table input'), null, 'No hay acciones de edición/borrado.')
  await act(async () => {
    await movimientos.registrarMovimiento(1, {
      producto_id: 1, tipo: 'salida', cantidad: '1', motivo: 'Salida de auditoría', clave_operacion: randomUUID(),
    })
  })
  const antesRefresco = consultas(1).length
  await act(async () => {
    window.dispatchEvent(new CustomEvent('movimientos:historial-actualizado', { detail: { negocioId: 1 } }))
  })
  await flush()
  assert.ok(consultas(1).length > antesRefresco, 'El evento refresca el historial.')
  assert.match(document.body.textContent, /3 registros/)
  assert.match(historial().textContent, /-1\.000/, 'La salida se muestra como delta negativo.')
  assert.match(historial().textContent, /Salida de auditoría/)
  console.log('OK F9 lectura sola: tabla completa, inactivo, delta firmado, actor y sin acciones de escritura.')

  // 2. Solo escritura: no se monta el historial ni se consulta GET aunque se escriba.
  await preparar({ permisos: ['registrar_entrada'] })
  assert.equal(historial(), null)
  assert.match(document.body.textContent, /El historial requiere el permiso listar_movimientos/)
  assert.equal(consultas(1).length, 0)
  assert.ok(boton('Entrada'))
  await click(boton('Entrada'))
  await change(campo('producto_id', true), '1')
  await change(campo('cantidad', true), '2')
  await change(campo('motivo', true), 'Sin historial')
  await submit()
  assert.equal(dialogo(), null)
  assert.equal(consultas(1).length, 0, 'La escritura sin permiso de lectura no lanza GET.')
  assert.equal(peticiones.filter((item) => item.method === 'POST' && item.path.endsWith('/movimientos/')).length, 1)
  console.log('OK F9 solo escritura: sin historial, sin GET inicial ni refresco.')

  // 3. Filtros válidos: nombres exactos, conversión de zona, rango exclusivo y paginación.
  await preparar({ permisos: ['listar_movimientos'] })
  for (let i = 0; i < 3; i++) {
    await movimientos.registrarMovimiento(1, {
      producto_id: i % 2 ? 2 : 1, tipo: 'entrada', cantidad: '1', motivo: 'Extra ' + i, clave_operacion: randomUUID(),
    })
  }
  const inicio = consultas(1).length
  await change(campo('producto_id'), '1')
  await change(campo('tipo'), 'entrada')
  await change(campo('search'), 'Artículo')
  await click(boton('Aplicar filtros'))
  const filtrada = consultas(1).at(-1)
  assert.ok(consultas(1).length > inicio)
  assert.equal(params(filtrada).get('page'), '1')
  assert.equal(params(filtrada).get('producto_id'), '1')
  assert.equal(params(filtrada).get('tipo'), 'entrada')
  assert.equal(params(filtrada).get('search'), 'Artículo')
  assert.equal(params(filtrada).has('desde'), false)
  assert.equal(params(filtrada).has('hasta'), false)
  assert.ok(filas().length > 0)
  assert.match(historial().textContent, /Artículo común/)
  assert.equal([...historial().textContent.matchAll(/LIQ-01/g)].length, 0)
  await click(boton('Siguiente'))
  const paginaDos = consultas(1).at(-1)
  assert.equal(params(paginaDos).get('page'), '2')
  assert.equal(params(paginaDos).get('producto_id'), '1')
  assert.equal(params(paginaDos).get('tipo'), 'entrada')
  assert.match(document.querySelector('[aria-label="Paginación de historial de movimientos"]').textContent, /Página 2/)
  await click(boton('Anterior'))
  assert.equal(params(consultas(1).at(-1)).get('page'), '1')
  await change(campo('desde'), '2026-01-01')
  await change(campo('hasta'), '2026-01-02')
  await click(boton('Aplicar filtros'))
  const conFechas = consultas(1).at(-1)
  assert.equal(params(conFechas).get('desde'), '2026-01-01T00:00:00Z')
  assert.equal(params(conFechas).get('hasta'), '2026-01-03T00:00:00Z', 'El límite superior es exclusivo: incluye el día indicado.')
  assert.match(historial().textContent, /Artículo común/)
  console.log('OK F9 filtros: nombres del contrato, zona UTC, rango exclusivo, páginas y filtros conservados.')

  // 4. Filtros inválidos: error local, sin GET y sin aplicar cambios parciales.
  const antesInvalidos = consultas(1).length
  await change(campo('producto_id'), 'abc')
  await click(boton('Aplicar filtros'))
  assert.match(errores(), /ID entero positivo/)
  assert.equal(consultas(1).length, antesInvalidos, 'Un filtro inválido no lanza GET.')
  assert.equal(campo('producto_id').value, 'abc', 'El filtro inválido se conserva para corregirlo.')
  await change(campo('producto_id'), '1')
  await change(campo('desde'), '2026-02-01')
  await change(campo('hasta'), '2026-01-01')
  await click(boton('Aplicar filtros'))
  assert.match(errores(), /Hasta debe ser posterior a desde/)
  assert.equal(consultas(1).length, antesInvalidos)
  campo('desde').setAttribute('type', 'text')
  await change(campo('desde'), '2026-02-30')
  await click(boton('Aplicar filtros'))
  assert.match(errores(), /fecha válida/)
  assert.equal(consultas(1).length, antesInvalidos)
  campo('desde').setAttribute('type', 'date')
  await click(boton('Limpiar filtros'))
  assert.equal(campo('producto_id').value, '')
  assert.equal(campo('desde').value, '')
  assert.ok(consultas(1).length > antesInvalidos)
  console.log('OK F9 filtros inválidos: errores por campo, sin GET y limpieza explícita.')

  // 5. Producto ajeno al negocio: error del servidor sin mezclar datos.
  await preparar({ permisos: ['listar_movimientos'] })
  await change(campo('producto_id'), '4')
  await click(boton('Aplicar filtros'))
  assert.match(document.body.textContent, /Revisa los campos indicados/)
  assert.equal(params(consultas(1).at(-1)).get('producto_id'), '4')
  assert.equal(filas().length, 0, 'No se muestran filas del otro negocio.')
  assert.equal([...document.body.textContent.matchAll(/LIQ-01/g)].length, 0)
  console.log('OK F9 tenant: producto ajeno produce error y ninguna fila de otro negocio.')

  // 6. Carga y error: estado visible, filtros conservados y reintento manual.
  await preparar({ permisos: ['listar_movimientos'] })
  manipulador = (_solicitud, _original) => { throw new ApiException('network_error', 'Sin conexión.', {}, 0) }
  await click(boton('Aplicar filtros'))
  await flush()
  assert.match(document.body.textContent, /No se pudo conectar/)
  assert.ok(boton('Reintentar'))
  await change(campo('tipo'), 'salida')
  await click(boton('Aplicar filtros'))
  assert.match(document.body.textContent, /No se pudo conectar/)
  manipulador = null
  await click(boton('Reintentar'))
  assert.equal(filas().length, 0, 'No hay salidas en los datos iniciales.')
  assert.equal(params(consultas(1).at(-1)).get('tipo'), 'salida', 'El reintento conserva el filtro aplicado.')
  await click(boton('Limpiar filtros'))
  assert.equal(filas().length, 2)
  console.log('OK F9 carga/error: mensaje, reintento manual y filtros conservados.')

  // 7. Escrituras con historial: cada confirmación refresca sin duplicar ni cambiar su payload.
  const storeEscrituras = await preparar({ permisos: ['listar_movimientos', 'registrar_entrada', 'registrar_salida', 'ajustar_inventario'] })
  assert.equal(storeEscrituras.getSnapshot().negocioId, 1)
  let getsAntes = consultas(1).length
  assert.equal(getsAntes, 1)
  await click(boton('Entrada'))
  await change(campo('producto_id', true), '1')
  await change(campo('cantidad', true), '2')
  await change(campo('motivo', true), 'Entrada auditada')
  await submit(true)
  assert.equal(dialogo(), null)
  assert.equal(consultas(1).length, getsAntes + 1, 'La entrada refresca una sola vez.')
  assert.match(historial().textContent, /Entrada auditada/)
  getsAntes = consultas(1).length
  await click(boton('Salida'))
  await change(campo('producto_id', true), '1')
  await change(campo('cantidad', true), '1')
  await change(campo('motivo', true), 'Salida auditada')
  await submit()
  assert.equal(consultas(1).length, getsAntes + 1)
  assert.match(historial().textContent, /Salida auditada/)
  getsAntes = consultas(1).length
  await click(boton('Ajustar'))
  await change(campo('producto_id', true), '2')
  await change(campo('stock_objetivo', true), '1.5')
  await change(campo('motivo', true), 'Ajuste auditado')
  await submit()
  assert.equal(consultas(1).length, getsAntes + 1)
  assert.match(historial().textContent, /Ajuste auditado/)
  getsAntes = consultas(1).length
  const conteoAntes = (await movimientos.listarMovimientos(1)).count
  getsAntes = consultas(1).length
  await click(boton('Salida'))
  await change(campo('producto_id', true), '1')
  await change(campo('cantidad', true), '99')
  await change(campo('motivo', true), 'Saldo insuficiente')
  await submit()
  assert.ok(dialogo(), 'Un error de saldo mantiene el modal abierto.')
  assert.match(dialogo().textContent, /Saldo insuficiente/)
  assert.equal(consultas(1).length, getsAntes, 'El error no refresca el historial.')
  assert.equal((await movimientos.listarMovimientos(1)).count, conteoAntes, 'El error no escribe parcialmente.')
  console.log('OK F9 escrituras: entrada, salida y ajuste refrescan; error sin cambios parciales.')

  // 8. Cambio de negocio: cancela la consulta pendiente, descarta filtros y aísla los datos.
  const storeContexto = await preparar({
    permisos: ['listar_movimientos'], negocio: 2, username: 'admin_ferreteria',
    otroNegocio: { id: 1, permisos: ['listar_movimientos'] },
  })
  await change(campo('producto_id'), '4')
  await click(boton('Aplicar filtros'))
  assert.equal(params(consultas(2).at(-1)).get('producto_id'), '4')
  let senalVieja = null
  let abortada = false
  manipulador = (solicitud, original) => {
    if (solicitud.method === 'GET' && solicitud.path.startsWith('/negocios/1/movimientos/')) {
      return new Promise((resolve, reject) => {
        senalVieja = solicitud.signal
        solicitud.signal?.addEventListener('abort', () => { abortada = true; reject(new DOMException('Cancelado', 'AbortError')) }, { once: true })
      })
    }
    return original(solicitud)
  }
  await act(async () => storeContexto.cambiarNegocio(1))
  await act(async () => { await pause(10) })
  assert.ok(senalVieja && !senalVieja.aborted, 'La consulta del negocio anterior quedó pendiente.')
  manipulador = null
  await act(async () => storeContexto.cambiarNegocio(2))
  await flush()
  assert.equal(senalVieja.aborted, true)
  assert.equal(abortada, true)
  assert.ok(consultas(2).length >= 1)
  assert.equal(params(consultas(2).at(-1)).get('page'), '1', 'El cambio de negocio descarta la paginación anterior.')
  assert.equal(params(consultas(2).at(-1)).has('producto_id'), false, 'El cambio de negocio descarta los filtros.')
  assert.equal(campo('producto_id').value, '')
  assert.match(historial().textContent, /COMUN-01/)
  assert.equal([...historial().textContent.matchAll(/LIQ-01/g)].length, 0, 'No aparece el producto inactivo del otro negocio.')
  assert.match(historial().textContent, /3\.500/)
  console.log('OK F9 contexto: consulta cancelada, filtros descartados y datos aislados por negocio.')

  await render(null)
} finally {
  await act(async () => root.unmount())
  await server.close()
  if (originalTransportRequest) mock.mockTransport.request = originalTransportRequest
  dom.window.close()
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
}

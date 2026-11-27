import type { ApiRequest } from '../../api/contracts'
import { ApiException } from '../../api/errors'
import { aEnteroEscalado, formatearDecimal, normalizarDecimal, subtotalVenta, totalVenta } from '../../lib/decimales'
import { normalizarRegistroVenta } from '../../features/ventas/draft/operaciones'
import type { MovimientoVenta, RegistrarVentaSolicitud, VentaDetalle, VentaProductoOpcion, VentaResumen } from '../../features/ventas/types'
import type { EstadoFase2 } from '../data/fase2'
import type { VentaMock } from '../data/fase3'
import { transaccionMock } from './almacen'
import type { AlmacenMock } from './almacen'
import { fechaFiltroMock, movimientoRespuestaMock, paginaMock, validarConsultaMock } from './fase2'
import type { ContextoFase2 } from './fase2'

const permisos = ['registrar_venta', 'listar_ventas', 'anular_venta']
function error(code: string, detail: string, status: number, errors: Record<string, string[]> = {}): never { throw new ApiException(code, detail, errors, status) }
function invalid(field: string, detail: string): never { return error('validation_error', 'Revisa los campos.', 400, { [field]: [detail] }) }
function notFound(): never { return error('not_found', 'Recurso no disponible en este contexto.', 404) }
function conflict(): never { return error('conflict', 'La operación o el precio cambió. Revisa la venta antes de confirmar.', 409) }
function record(value: unknown, allowed: string[], prefix = ''): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(prefix || 'non_field_errors', 'Envía un objeto.')
  const input = value as Record<string, unknown>
  const extra = Object.keys(input).filter((key) => !allowed.includes(key))
  if (extra.length) return error('validation_error', 'Hay campos no permitidos.', 400,
    Object.fromEntries(extra.map((key) => [prefix ? prefix + '.' + key : key, ['Campo no permitido.']])))
  return input
}
function text(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) return invalid(field, 'Texto requerido o fuera de rango.')
  return value.trim()
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return invalid('clave_operacion', 'Usa un UUID válido.')
  return value.toLowerCase()
}
function nextId(items: { id: number }[]) { return Math.max(0, ...items.map((item) => item.id)) + 1 }
function venta(data: AlmacenMock, negocioId: number, id: number) { return data.ventas.ventas.find((v) => v.id === id && v.negocio_id === negocioId) ?? notFound() }
function option(data: EstadoFase2, negocioId: number, id: number): VentaProductoOpcion {
  const p = data.productos.find((p) => p.id === id && p.negocio_id === negocioId && p.activo && data.categorias.some((c) => c.id === p.categoria_id && c.negocio_id === negocioId && c.activo))
  if (!p) return notFound()
  const { sku, nombre, unidad, precio_venta } = p
  return { id, negocio_id: negocioId, sku, nombre, unidad, precio_venta, disponible: data.saldos.find((s) => s.producto_id === id && s.negocio_id === negocioId)!.cantidad }
}
function resumen(v: VentaMock, ctx: ContextoFase2): VentaResumen {
  return { id: v.id, negocio_id: v.negocio_id, estado: v.estado, total: v.total,
    vendedor: { ...ctx.usuarios.find((u) => u.id === v.vendedor_id)! }, creado_en: v.creado_en }
}
function detalle(v: VentaMock, ctx: ContextoFase2): VentaDetalle {
  const anulacion = v.anulacion
  return { ...resumen(v, ctx), clave_operacion: v.clave_operacion, observaciones: v.observaciones,
    detalles: structuredClone(v.detalles).sort((a, b) => a.id - b.id),
    anulacion: anulacion ? { id: anulacion.id, usuario: { ...ctx.usuarios.find((u) => u.id === anulacion.usuario_id)! },
      motivo: anulacion.motivo, clave_operacion: anulacion.clave_operacion, creado_en: anulacion.creado_en } : null }
}
function delta(data: AlmacenMock, ctx: ContextoFase2, v: VentaMock, productoId: number, cantidad: string, operacion: 'venta' | 'anulacion', detalleId: number) {
  const inventory = data.inventario
  const p = inventory.productos.find((p) => p.id === productoId && p.negocio_id === v.negocio_id)!
  const saldo = inventory.saldos.find((s) => s.producto_id === productoId && s.negocio_id === v.negocio_id)!
  const amount = aEnteroEscalado(cantidad, { escala: 3, precision: 14, unidad: p.unidad })
  const before = aEnteroEscalado(saldo.cantidad, { escala: 3, precision: 14 })
  const after = before + (operacion === 'venta' ? -amount : amount)
  if (after < 0n) return invalid('detalles', 'Saldo insuficiente.')
  const posterior = normalizarDecimal(formatearDecimal(after), { escala: 3, precision: 14, unidad: p.unidad })
  if (!Number.isSafeInteger(saldo.version + 1)) return invalid('detalles', 'Versión fuera de rango.')
  const id = nextId(inventory.movimientos), clave_operacion = crypto.randomUUID()
  const tipo = operacion === 'venta' ? 'salida' : 'entrada', motivo = `${operacion === 'venta' ? 'Venta' : 'Anulación de venta'} #${v.id}`
  inventory.movimientos.push({ id, negocio_id: v.negocio_id, producto_id: productoId, usuario_id: ctx.usuario.id,
    tipo, cantidad: formatearDecimal(operacion === 'venta' ? -amount : amount), saldo_anterior: saldo.cantidad, saldo_posterior: posterior,
    motivo, clave_operacion, creado_en: new Date().toISOString() })
  inventory.operaciones[v.negocio_id + ':' + clave_operacion] = { movimiento_id: id,
    huella: JSON.stringify({ actor: ctx.usuario.id, producto_id: productoId, tipo, cantidad: formatearDecimal(amount), motivo }) }
  saldo.cantidad = posterior; saldo.version++
  data.ventas.vinculos.push({ venta_id: v.id, detalle_id: detalleId, operacion, movimiento_id: id })
}
function registrar(data: AlmacenMock, request: ApiRequest, ctx: ContextoFase2, negocioId: number): VentaDetalle {
  const body = record(request.body, ['clave_operacion', 'observaciones', 'detalles'])
  const key = uuid(body.clave_operacion)
  if (Array.isArray(body.detalles)) body.detalles.forEach((line, index) => record(line, ['producto_id', 'cantidad', 'precio_unitario_esperado'], `detalles.${index}`))
  const input = normalizarRegistroVenta(body as unknown as RegistrarVentaSolicitud)
  const huella = JSON.stringify({ actor: ctx.usuario.id, observaciones: input.observaciones, detalles: [...input.detalles].sort((a, b) => a.producto_id - b.producto_id) })
  const scopedKey = negocioId + ':' + key, previous = data.ventas.registros[scopedKey]
  if (previous) {
    if (previous.huella !== huella) return conflict()
    return detalle(venta(data, negocioId, previous.venta_id), ctx)
  }
  const v: VentaMock = { id: nextId(data.ventas.ventas), negocio_id: negocioId, vendedor_id: ctx.usuario.id, estado: 'confirmada',
    total: '0.00', creado_en: new Date().toISOString(), clave_operacion: key, observaciones: input.observaciones!, detalles: [], anulacion: null }
  let detailId = Math.max(0, ...data.ventas.ventas.flatMap((v) => v.detalles.map((d) => d.id))) + 1
  for (const [index, line] of input.detalles.entries()) {
    const field = `detalles.${index}`
    const p = data.inventario.productos.find((p) => p.id === line.producto_id && p.negocio_id === negocioId && p.activo &&
      data.inventario.categorias.some((c) => c.id === p.categoria_id && c.negocio_id === negocioId && c.activo))
    if (!p) return invalid(field + '.producto_id', 'Selecciona un producto activo del negocio.')
    const amount = aEnteroEscalado(line.cantidad, { escala: 3, precision: 14, unidad: p.unidad, campo: field + '.cantidad' })
    if (p.precio_venta !== line.precio_unitario_esperado) return conflict()
    const saldo = data.inventario.saldos.find((s) => s.producto_id === p.id && s.negocio_id === negocioId)!
    if (amount > aEnteroEscalado(saldo.cantidad, { escala: 3, precision: 14 })) return invalid(field + '.cantidad', 'Saldo insuficiente.')
    let subtotal: string
    try { subtotal = subtotalVenta(line.cantidad, p.precio_venta, p.unidad) } catch (e) {
      if (e instanceof ApiException) return invalid(field + '.cantidad', e.detail)
      throw e
    }
    const detail = { id: detailId++, producto_id: p.id, sku: p.sku, nombre: p.nombre, unidad: p.unidad, cantidad: line.cantidad, precio_unitario: p.precio_venta, subtotal }
    v.detalles.push(detail)
    delta(data, ctx, v, p.id, line.cantidad, 'venta', detail.id)
  }
  v.total = totalVenta(v.detalles.map((d) => d.subtotal))
  data.ventas.ventas.push(v); data.ventas.registros[scopedKey] = { huella, venta_id: v.id }
  return detalle(v, ctx)
}
function anular(data: AlmacenMock, request: ApiRequest, ctx: ContextoFase2, negocioId: number, ventaId: number) {
  const v = venta(data, negocioId, ventaId)
  const body = record(request.body, ['clave_operacion', 'motivo'])
  const key = uuid(body.clave_operacion), motivo = text(body.motivo, 'motivo', 255)
  const huella = JSON.stringify({ actor: ctx.usuario.id, venta_id: ventaId, motivo }), scopedKey = negocioId + ':' + key
  const previous = data.ventas.anulaciones[scopedKey]
  if (previous) {
    if (previous.huella !== huella) return conflict()
    return detalle(venta(data, negocioId, previous.venta_id), ctx)
  }
  if (v.anulacion || v.estado === 'anulada') return conflict()
  for (const line of [...v.detalles].sort((a, b) => a.producto_id - b.producto_id)) delta(data, ctx, v, line.producto_id, line.cantidad, 'anulacion', line.id)
  v.estado = 'anulada'
  v.anulacion = { id: nextId(data.ventas.ventas.flatMap((v) => v.anulacion ? [v.anulacion] : [])), usuario_id: ctx.usuario.id, motivo, clave_operacion: key, creado_en: new Date().toISOString() }
  data.ventas.anulaciones[scopedKey] = { huella, venta_id: ventaId }
  return detalle(v, ctx)
}
function run(data: AlmacenMock, request: ApiRequest, ctx: ContextoFase2, url: URL, negocioId: number, tail: string): unknown {
  const { method } = request, params = url.searchParams
  const auth = (codes: string[]) => ctx.autorizar(codes, negocioId)
  const query = (allowed: string[]) => validarConsultaMock(params, allowed)
  const only = (methods: string[]) => { if (!methods.includes(method)) error('method_not_allowed', 'Método no permitido.', 405) }
  if (tail.startsWith('productos/')) {
    only(['GET']); auth(['registrar_venta'])
    if (tail === 'productos/opciones/') {
      query(['search', 'page'])
      const search = params.has('search') ? text(params.get('search'), 'search', 150, false).toLowerCase() : ''
      const rows = data.inventario.productos.filter((p) => p.negocio_id === negocioId && p.activo &&
        data.inventario.categorias.some((c) => c.id === p.categoria_id && c.activo && c.negocio_id === negocioId) &&
        (p.nombre.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search))).sort((a, b) => a.id - b.id)
        .map((p) => option(data.inventario, negocioId, p.id))
      return paginaMock(rows, url, ctx)
    }
    const match = tail.match(/^productos\/([1-9]\d*)\/$/)
    if (!match || !Number.isSafeInteger(Number(match[1]))) return notFound()
    query([]); return option(data.inventario, negocioId, Number(match[1]))
  }
  if (tail === '') {
    only(['GET', 'POST'])
    if (method === 'POST') { auth(['registrar_venta']); query([]); return registrar(data, request, ctx, negocioId) }
    auth(['listar_ventas']); query(['page', 'search', 'estado', 'desde', 'hasta'])
    const search = params.has('search') ? text(params.get('search'), 'search', 150, false).toLowerCase() : ''
    const estado = params.get('estado')
    if (estado !== null && estado !== 'confirmada' && estado !== 'anulada') return invalid('estado', 'Estado inválido.')
    const desde = fechaFiltroMock(params.get('desde'), 'desde'), hasta = fechaFiltroMock(params.get('hasta'), 'hasta')
    if (desde !== undefined && hasta !== undefined && desde >= hasta) return invalid('hasta', 'Hasta debe ser posterior a desde.')
    const rows = data.ventas.ventas.filter((v) => v.negocio_id === negocioId && (estado === null || estado === v.estado) &&
      (desde === undefined || Date.parse(v.creado_en) >= desde) && (hasta === undefined || Date.parse(v.creado_en) < hasta) &&
      (v.observaciones.toLowerCase().includes(search) || v.detalles.some((d) => d.nombre.toLowerCase().includes(search) || d.sku.toLowerCase().includes(search))))
      .sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en) || b.id - a.id).map((v) => resumen(v, ctx))
    return paginaMock(rows, url, ctx)
  }
  const match = tail.match(/^([1-9]\d*)\/(anulacion\/|movimientos\/)?$/)
  if (!match || !Number.isSafeInteger(Number(match[1]))) return notFound()
  const id = Number(match[1]), child = match[2]
  if (child === 'anulacion/') { only(['POST']); auth(['anular_venta']); query([]); return anular(data, request, ctx, negocioId, id) }
  only(['GET']); auth(permisos)
  const v = venta(data, negocioId, id)
  if (!child) { query([]); return detalle(v, ctx) }
  query(['page'])
  const rows: MovimientoVenta[] = data.ventas.vinculos.filter((link) => link.venta_id === id).map((link) => ({ detalle_id: link.detalle_id, operacion: link.operacion,
    movimiento: movimientoRespuestaMock(data.inventario, data.inventario.movimientos.find((m) => m.id === link.movimiento_id)!, ctx) }))
    .sort((a, b) => Date.parse(a.movimiento.creado_en) - Date.parse(b.movimiento.creado_en) || a.movimiento.id - b.movimiento.id)
  return paginaMock(rows, url, ctx)
}
export function resolverFase3(request: ApiRequest, ctx: ContextoFase2): { handled: false } | { handled: true; value: unknown } {
  const url = new URL(request.path, 'http://mock.local')
  const match = url.pathname.match(/^\/negocios\/([1-9]\d*)\/ventas\/(.*)$/)
  if (!match) return { handled: false }
  const negocioId = Number(match[1]); ctx.autorizar([], negocioId)
  return { handled: true, value: transaccionMock(request.method !== 'GET', (draft) => run(draft, request, ctx, url, negocioId, match[2])) }
}

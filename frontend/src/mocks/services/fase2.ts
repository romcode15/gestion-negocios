import type { ApiRequest } from '../../api/contracts'
import { ApiException } from '../../api/errors'
import type { Usuario } from '../../features/usuarios/types'
import type { Categoria } from '../../features/categorias/types'
import type { Producto, ProductoOpcion, ProductoResumen, Unidad } from '../../features/productos/types'
import type { Existencia } from '../../features/existencias/types'
import type { Movimiento } from '../../features/movimientos/types'
import { aEnteroEscalado, formatearDecimal, normalizarDecimal } from '../../lib/decimales'
import { crearDatosFase2 } from '../data/fase2'
import type { EstadoFase2, MovimientoMock } from '../data/fase2'
type ProductoMock = EstadoFase2['productos'][number]
export interface ContextoFase2 { usuario: Usuario; usuarios: Usuario[]; autorizar: (codes: string[], negocioId: number) => void; vacio: boolean }
let state = crearDatosFase2()
export function reiniciarFase2() { state = crearDatosFase2() }
function error(code: string, detail: string, status: number, errors: Record<string, string[]> = {}): never { throw new ApiException(code, detail, errors, status) }
function invalid(field: string, message: string): never { return error('validation_error', 'Revisa los campos indicados.', 400, { [field]: [message] }) }
function notFound(): never { return error('not_found', 'Recurso no disponible en este contexto.', 404) }
function conflict(): never { return error('conflict', 'La operación o el saldo cambió. Revisa los datos antes de volver a enviar.', 409) }
function record(value: unknown, allowed: string[], patch = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('non_field_errors', 'Envía un objeto.')
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length) return error('validation_error', 'Hay campos no permitidos.', 400, Object.fromEntries(unknown.map((key) => [key, ['Campo no permitido.']])))
  if (patch && !Object.keys(input).length) return invalid('non_field_errors', 'Envía al menos un campo editable.')
  return input
}
function text(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== 'string') return invalid(field, 'Envía un texto.')
  const clean = value.trim()
  if ((required && !clean) || clean.length > max) return invalid(field, 'Texto requerido o longitud fuera de rango.')
  return clean
}
function id(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid(field, 'Usa un ID entero positivo.')
  return value
}
function boolean(value: unknown, field: string): boolean { return typeof value === 'boolean' ? value : invalid(field, 'Envía un booleano.') }
function unit(value: unknown): Unidad { return value === 'unidad' || value === 'kg' || value === 'litro' ? value : invalid('unidad', 'Unidad inválida.') }
function nextId(items: { id: number }[]) { return Math.max(0, ...items.map((item) => item.id)) + 1 }
function quantity(value: unknown, field: string, unidad?: Unidad): bigint { return aEnteroEscalado(value, { escala: 3, precision: 14, campo: field, unidad }) }
function category(data: EstadoFase2, negocioId: number, categoriaId: number): Categoria | undefined { return data.categorias.find((c) => c.negocio_id === negocioId && c.id === categoriaId) }
function product(data: EstadoFase2, negocioId: number, productoId: number): ProductoMock | undefined { return data.productos.find((p) => p.negocio_id === negocioId && p.id === productoId) }
function productResponse(data: EstadoFase2, p: ProductoMock): Producto { return { ...p, categoria_nombre: category(data, p.negocio_id, p.categoria_id)!.nombre } }
function option(p: ProductoMock): ProductoOpcion { const { id, negocio_id, sku, nombre, unidad } = p; return { id, negocio_id, sku, nombre, unidad } }
function summary(data: EstadoFase2, p: ProductoMock): ProductoResumen { return { ...option(p), activo: p.activo, categoria_id: p.categoria_id, categoria_nombre: category(data, p.negocio_id, p.categoria_id)!.nombre } }
function stock(data: EstadoFase2, p: ProductoMock): Existencia {
  const saldo = data.saldos.find((s) => s.producto_id === p.id && s.negocio_id === p.negocio_id)!
  return { id: saldo.id, negocio_id: p.negocio_id, producto: summary(data, p), cantidad: saldo.cantidad, stock_minimo: p.stock_minimo,
    bajo_minimo: quantity(saldo.cantidad, 'cantidad') < quantity(p.stock_minimo, 'stock_minimo'), version: saldo.version }
}
function movement(data: EstadoFase2, m: MovimientoMock, ctx: ContextoFase2): Movimiento {
  const { producto_id, usuario_id, ...fields } = m
  return { ...fields, producto: option(product(data, m.negocio_id, producto_id)!), usuario: { ...ctx.usuarios.find((u) => u.id === usuario_id)! } }
}
function validateQuery(params: URLSearchParams, allowed: string[]) {
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid(key, 'Parámetro no permitido o repetido.')
  }
}
function booleanFilter(params: URLSearchParams, field: string): boolean | undefined {
  const value = params.get(field)
  if (value === null) return undefined
  if (value !== 'true' && value !== 'false') return invalid(field, 'Usa true o false.')
  return value === 'true'
}
function idFilter(params: URLSearchParams, field: string): number | undefined {
  const value = params.get(field)
  if (value === null) return undefined
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) return invalid(field, 'Usa un ID positivo.')
  return Number(value)
}
function timestamp(value: string | null, field: string): number | undefined {
  if (value === null) return undefined
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/)
  if (!match) return invalid(field, 'Usa fecha ISO 8601 con zona horaria.')
  const [, y, mo, d, h, mi, s, zone] = match
  const time = Date.parse(value)
  if (!Number.isFinite(time) || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 ||
      Number(d) > new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate() || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) return invalid(field, 'Fecha inválida.')
  return time
}
function paginate<T>(items: T[], url: URL, ctx: ContextoFase2) {
  if (ctx.vacio) items = []
  const raw = url.searchParams.get('page') ?? '1'
  const page = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(page) || page < 1 || (page > 1 && (page - 1) * 2 >= items.length)) return notFound()
  const link = (n: number) => { const params = new URLSearchParams(url.searchParams); params.set('page', String(n)); return 'mock:/api/v1' + url.pathname + '?' + params.toString() }
  return { count: items.length, next: page * 2 < items.length ? link(page + 1) : null, previous: page > 1 ? link(page - 1) : null, results: items.slice((page - 1) * 2, page * 2) }
}
function run(data: EstadoFase2, request: ApiRequest, url: URL, negocioId: number, resource: string, detail: string | undefined, ctx: ContextoFase2): unknown {
  const { method, body } = request
  const params = url.searchParams
  const isOptions = detail === 'opciones'
  if (detail && !isOptions && !/^[1-9]\d*$/.test(detail)) return notFound()
  const detailId = detail && !isOptions ? Number(detail) : undefined
  const methods = resource === 'categorias' || resource === 'productos' ? (isOptions ? ['GET'] : detail ? ['GET', 'PATCH'] : ['GET', 'POST'])
    : resource === 'existencias' ? (isOptions ? [] : ['GET']) : resource === 'movimientos' && !detail ? ['GET', 'POST'] : resource === 'ajustes' && !detail ? ['POST'] : []
  if (!methods.length) return notFound()
  if (!methods.includes(method)) return error('method_not_allowed', 'Método no permitido.', 405)
  const auth = (codes: string[]) => ctx.autorizar(codes, negocioId)
  if (resource === 'categorias' || resource === 'productos') {
    const categories = resource === 'categorias'
    const singular = categories ? 'categoria' : 'producto'
    if (isOptions) auth(categories ? ['crear_producto', 'editar_producto'] : ['registrar_entrada', 'registrar_salida', 'ajustar_inventario'])
    else if (method === 'GET') auth(detail ? ['listar_' + resource, 'editar_' + singular] : ['listar_' + resource])
    else auth([method === 'POST' ? 'crear_' + singular : 'editar_' + singular])
    if (method === 'GET' && !detailId) {
      validateQuery(params, isOptions ? ['page', 'search'] : categories ? ['page', 'search', 'activo'] : ['page', 'search', 'activo', 'categoria_id'])
      const search = params.has('search') ? text(params.get('search'), 'search', 150, false).toLowerCase() : ''
      const active = isOptions ? true : booleanFilter(params, 'activo')
      if (categories) {
        const items = data.categorias.filter((c) => c.negocio_id === negocioId && (active === undefined || c.activo === active) && c.nombre.toLowerCase().includes(search)).sort((a, b) => a.id - b.id)
        return paginate(isOptions ? items.map(({ id, negocio_id, nombre }) => ({ id, negocio_id, nombre })) : items, url, ctx)
      }
      const categoryId = idFilter(params, 'categoria_id')
      if (categoryId !== undefined && !category(data, negocioId, categoryId)) return invalid('categoria_id', 'Categoría no disponible.')
      const items = data.productos.filter((p) => p.negocio_id === negocioId && (active === undefined || p.activo === active) &&
        (categoryId === undefined || p.categoria_id === categoryId) && (p.nombre.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search))).sort((a, b) => a.id - b.id)
      return paginate(isOptions ? items.map(option) : items.map((p) => productResponse(data, p)), url, ctx)
    }
    validateQuery(params, [])
    if (categories) {
      const existing = detailId ? category(data, negocioId, detailId) ?? notFound() : undefined
      if (method === 'GET') return existing
      const input = record(body, method === 'POST' ? ['nombre', 'descripcion'] : ['nombre', 'descripcion', 'activo'], method === 'PATCH')
      const candidate: Categoria = existing ? { ...existing } : { id: nextId(data.categorias), negocio_id: negocioId, nombre: '', descripcion: '', activo: true }
      if (method === 'POST' || Object.hasOwn(input, 'nombre')) candidate.nombre = text(input.nombre, 'nombre', 150)
      if (Object.hasOwn(input, 'descripcion')) candidate.descripcion = text(input.descripcion, 'descripcion', 500, false)
      if (Object.hasOwn(input, 'activo')) candidate.activo = boolean(input.activo, 'activo')
      if (data.categorias.some((c) => c.negocio_id === negocioId && c.id !== candidate.id && c.nombre === candidate.nombre)) return invalid('nombre', 'El nombre ya existe en este negocio.')
      if (!candidate.activo && data.productos.some((p) => p.negocio_id === negocioId && p.categoria_id === candidate.id && p.activo)) return invalid('activo', 'Hay productos activos en la categoría.')
      if (existing) Object.assign(existing, candidate); else data.categorias.push(candidate)
      return candidate
    }
    const existing = detailId ? product(data, negocioId, detailId) ?? notFound() : undefined
    if (method === 'GET') return productResponse(data, existing!)
    const input = record(body, ['categoria_id', 'sku', 'nombre', 'descripcion', 'unidad', 'precio_venta', 'stock_minimo', ...(method === 'PATCH' ? ['activo'] : [])], method === 'PATCH')
    const candidate: ProductoMock = existing ? { ...existing } : { id: nextId(data.productos), negocio_id: negocioId, categoria_id: 0, sku: '', nombre: '', descripcion: '', unidad: 'unidad', precio_venta: '0.00', stock_minimo: '0.000', activo: true }
    if (method === 'POST' || Object.hasOwn(input, 'categoria_id')) candidate.categoria_id = id(input.categoria_id, 'categoria_id')
    const cat = category(data, negocioId, candidate.categoria_id)
    if (!cat) return invalid('categoria_id', 'Categoría no disponible.')
    if (method === 'POST' || Object.hasOwn(input, 'sku')) {
      candidate.sku = text(input.sku, 'sku', 50).toUpperCase()
      if (!/^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(candidate.sku)) return invalid('sku', 'Formato de SKU inválido.')
    }
    if (method === 'POST' || Object.hasOwn(input, 'nombre')) candidate.nombre = text(input.nombre, 'nombre', 150)
    if (Object.hasOwn(input, 'descripcion')) candidate.descripcion = text(input.descripcion, 'descripcion', 500, false)
    if (method === 'POST' || Object.hasOwn(input, 'unidad')) candidate.unidad = unit(input.unidad)
    if (method === 'POST' || Object.hasOwn(input, 'precio_venta')) candidate.precio_venta = normalizarDecimal(input.precio_venta, { escala: 2, precision: 12, campo: 'precio_venta' })
    if (Object.hasOwn(input, 'stock_minimo')) candidate.stock_minimo = formatearDecimal(quantity(input.stock_minimo, 'stock_minimo', candidate.unidad))
    quantity(candidate.stock_minimo, 'stock_minimo', candidate.unidad)
    if (Object.hasOwn(input, 'activo')) candidate.activo = boolean(input.activo, 'activo')
    if ((method === 'POST' || candidate.activo || candidate.categoria_id !== existing?.categoria_id) && !cat.activo) return invalid('categoria_id', 'Selecciona una categoría activa del negocio.')
    if (data.productos.some((p) => p.negocio_id === negocioId && p.id !== candidate.id && p.sku === candidate.sku)) return invalid('sku', 'El SKU ya existe en este negocio.')
    if (existing && candidate.unidad !== existing.unidad && data.movimientos.some((m) => m.producto_id === existing.id && m.negocio_id === negocioId)) return invalid('unidad', 'La unidad no puede cambiar después de un movimiento.')
    if (existing) Object.assign(existing, candidate)
    else { data.productos.push(candidate); data.saldos.push({ id: nextId(data.saldos), negocio_id: negocioId, producto_id: candidate.id, cantidad: '0.000', version: 0 }) }
    return productResponse(data, candidate)
  }
  if (resource === 'existencias') {
    auth(detailId ? ['consultar_existencias', 'ajustar_inventario'] : ['consultar_existencias'])
    if (detailId) { validateQuery(params, []); return stock(data, product(data, negocioId, detailId) ?? notFound()) }
    validateQuery(params, ['page', 'search', 'categoria_id', 'activo', 'bajo_minimo'])
    const search = params.has('search') ? text(params.get('search'), 'search', 150, false).toLowerCase() : ''
    const categoryId = idFilter(params, 'categoria_id')
    if (categoryId !== undefined && !category(data, negocioId, categoryId)) return invalid('categoria_id', 'Categoría no disponible.')
    const active = booleanFilter(params, 'activo'), low = booleanFilter(params, 'bajo_minimo')
    const rows = data.productos.filter((p) => p.negocio_id === negocioId && (categoryId === undefined || p.categoria_id === categoryId) &&
      (active === undefined || p.activo === active) && (p.nombre.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search)))
      .sort((a, b) => a.id - b.id).map((p) => stock(data, p)).filter((s) => low === undefined || s.bajo_minimo === low)
    return paginate(rows, url, ctx)
  }
  if (resource === 'movimientos' && method === 'GET') {
    auth(['listar_movimientos'])
    validateQuery(params, ['page', 'search', 'producto_id', 'tipo', 'desde', 'hasta'])
    const search = params.has('search') ? text(params.get('search'), 'search', 150, false).toLowerCase() : ''
    const productId = idFilter(params, 'producto_id')
    if (productId !== undefined && !product(data, negocioId, productId)) return invalid('producto_id', 'Producto no disponible.')
    const tipo = params.get('tipo')
    if (tipo !== null && !['entrada', 'salida', 'ajuste'].includes(tipo)) return invalid('tipo', 'Tipo inválido.')
    const desde = timestamp(params.get('desde'), 'desde'), hasta = timestamp(params.get('hasta'), 'hasta')
    if (desde !== undefined && hasta !== undefined && desde >= hasta) return invalid('hasta', 'Hasta debe ser posterior a desde.')
    const rows = data.movimientos.filter((m) => m.negocio_id === negocioId && (productId === undefined || m.producto_id === productId) &&
      (tipo === null || m.tipo === tipo) && (desde === undefined || Date.parse(m.creado_en) >= desde) && (hasta === undefined || Date.parse(m.creado_en) < hasta))
      .map((m) => movement(data, m, ctx)).filter((m) => m.producto.nombre.toLowerCase().includes(search) || m.producto.sku.toLowerCase().includes(search))
      .sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en) || b.id - a.id)
    return paginate(rows, url, ctx)
  }
  validateQuery(params, [])
  const adjustment = resource === 'ajustes'
  const input = record(body, adjustment ? ['producto_id', 'stock_objetivo', 'version_esperada', 'motivo', 'clave_operacion'] : ['producto_id', 'tipo', 'cantidad', 'motivo', 'clave_operacion'])
  const tipo = adjustment ? 'ajuste' : input.tipo
  if (tipo !== 'ajuste' && tipo !== 'entrada' && tipo !== 'salida' || (!adjustment && tipo === 'ajuste')) return invalid('tipo', 'Usa entrada o salida.')
  auth([adjustment ? 'ajustar_inventario' : tipo === 'entrada' ? 'registrar_entrada' : 'registrar_salida'])
  const productId = id(input.producto_id, 'producto_id'), motivo = text(input.motivo, 'motivo', 255)
  const key = typeof input.clave_operacion === 'string' ? input.clave_operacion.toLowerCase() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) return invalid('clave_operacion', 'Envía un UUID válido.')
  const amount = quantity(adjustment ? input.stock_objetivo : input.cantidad, adjustment ? 'stock_objetivo' : 'cantidad')
  if (!adjustment && amount === 0n) return invalid('cantidad', 'La cantidad debe ser positiva.')
  const version = input.version_esperada
  if (adjustment && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)) return invalid('version_esperada', 'Envía una versión entera no negativa.')
  const normalized = adjustment ? { actor: ctx.usuario.id, producto_id: productId, tipo, stock_objetivo: formatearDecimal(amount), version_esperada: version, motivo }
    : { actor: ctx.usuario.id, producto_id: productId, tipo, cantidad: formatearDecimal(amount), motivo }
  const huella = JSON.stringify(normalized), operationKey = negocioId + ':' + key
  const previous = data.operaciones[operationKey]
  if (previous) {
    if (previous.huella !== huella) return conflict()
    return movement(data, data.movimientos.find((m) => m.id === previous.movimiento_id)!, ctx)
  }
  const p = product(data, negocioId, productId)
  if (!p || !p.activo || !category(data, negocioId, p.categoria_id)?.activo) return invalid('producto_id', 'Selecciona un producto activo del negocio.')
  quantity(formatearDecimal(amount), adjustment ? 'stock_objetivo' : 'cantidad', p.unidad)
  const saldo = data.saldos.find((s) => s.producto_id === productId && s.negocio_id === negocioId)!
  if (adjustment && saldo.version !== version) return conflict()
  const before = quantity(saldo.cantidad, 'cantidad')
  const delta = adjustment ? amount - before : tipo === 'salida' ? -amount : amount
  if (delta === 0n) return invalid('stock_objetivo', 'El objetivo debe cambiar el saldo.')
  const after = before + delta
  if (after < 0n) return invalid('cantidad', 'Saldo insuficiente.')
  quantity(formatearDecimal(after), adjustment ? 'stock_objetivo' : 'cantidad', p.unidad)
  if (!Number.isSafeInteger(saldo.version + 1)) return invalid('version_esperada', 'Versión fuera de rango.')
  const m: MovimientoMock = { id: nextId(data.movimientos), negocio_id: negocioId, producto_id: p.id, usuario_id: ctx.usuario.id,
    tipo, cantidad: formatearDecimal(delta), saldo_anterior: saldo.cantidad, saldo_posterior: formatearDecimal(after), motivo,
    clave_operacion: key, creado_en: new Date().toISOString() }
  saldo.cantidad = m.saldo_posterior; saldo.version++
  data.movimientos.push(m); data.operaciones[operationKey] = { huella, movimiento_id: m.id }
  return movement(data, m, ctx)
}
export function resolverFase2(request: ApiRequest, ctx: ContextoFase2): { handled: false } | { handled: true; value: unknown } {
  const url = new URL(request.path, 'http://mock.local')
  const match = url.pathname.match(/^\/negocios\/(\d+)\/(categorias|productos|existencias|movimientos|ajustes)\/(?:([^/]+)\/)?$/)
  if (!match) return { handled: false }
  const negocioId = Number(match[1])
  ctx.autorizar([], negocioId)
  // Copia transaccional: ninguna validación fallida altera las colecciones compartidas.
  const draft = structuredClone(state)
  const value = run(draft, request, url, negocioId, match[2], match[3], ctx)
  if (request.method !== 'GET') state = draft
  return { handled: true, value }
}

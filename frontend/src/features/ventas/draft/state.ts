import { ApiException } from '../../../api/errors'
import { aEnteroEscalado, formatearDecimal, normalizarDecimal } from '../../../lib/decimales'
import type { ProductoVentaDraft, VentaDraft } from './types'

export const MAX_LINEAS_VENTA = 100
export function draftVacio(): VentaDraft { return { lineas: [], observaciones: '' } }
function invalid(campo: string, mensaje: string): never {
  throw new ApiException('validation_error', 'Revisa el borrador de venta.', { [campo]: [mensaje] }, 400)
}
function productoValido(producto: ProductoVentaDraft, negocioId: number): ProductoVentaDraft {
  if (!Number.isSafeInteger(producto.id) || producto.id <= 0 || producto.negocio_id !== negocioId) {
    return invalid('producto_id', 'Selecciona un producto del negocio activo.')
  }
  if (!['unidad', 'kg', 'litro'].includes(producto.unidad)) return invalid('unidad', 'Unidad inválida.')
  return { id: producto.id, negocio_id: negocioId, sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad,
    precio_venta: normalizarDecimal(producto.precio_venta, { escala: 2, precision: 12, campo: 'precio_unitario_esperado' }),
    disponible: normalizarDecimal(producto.disponible, { escala: 3, precision: 14, campo: 'disponible', unidad: producto.unidad }) }
}
function cantidadValida(cantidad: string, producto: ProductoVentaDraft): string {
  const options = { escala: 3, precision: 14, campo: 'cantidad', unidad: producto.unidad }
  const scaled = aEnteroEscalado(cantidad, options)
  if (scaled <= 0n) return invalid('cantidad', 'La cantidad debe ser positiva.')
  return formatearDecimal(scaled)
}
export function agregarLinea(draft: VentaDraft, negocioId: number, producto: ProductoVentaDraft, cantidad = '1'): VentaDraft {
  const valid = productoValido(producto, negocioId)
  const existing = draft.lineas.find((linea) => linea.producto.id === valid.id)
  if (!existing && draft.lineas.length >= MAX_LINEAS_VENTA) return invalid('detalles', 'El máximo es 100 productos distintos.')
  // Repetir no acepta automáticamente un precio/unidad nuevos del catálogo.
  const appliedProduct = existing?.producto ?? valid
  let next = cantidadValida(cantidad, appliedProduct)
  if (existing) {
    next = cantidadValida(formatearDecimal(aEnteroEscalado(existing.cantidad, { escala: 3, precision: 14 }) +
      aEnteroEscalado(next, { escala: 3, precision: 14 })), appliedProduct)
  }
  const line = { producto: appliedProduct, cantidad: next, precio_unitario_esperado: existing?.precio_unitario_esperado ?? valid.precio_venta }
  return { ...draft, lineas: existing ? draft.lineas.map((item) => item === existing ? line : item) : [...draft.lineas, line] }
}
export function cambiarCantidadLinea(draft: VentaDraft, productoId: number, cantidad: string): VentaDraft {
  const line = draft.lineas.find((item) => item.producto.id === productoId)
  if (!line) return invalid('producto_id', 'El producto no está en este borrador.')
  const valid = cantidadValida(cantidad, line.producto)
  return { ...draft, lineas: draft.lineas.map((item) => item === line ? { ...item, cantidad: valid } : item) }
}
export function revisarProductoLinea(draft: VentaDraft, negocioId: number, producto: ProductoVentaDraft): VentaDraft {
  const valid = productoValido(producto, negocioId)
  const line = draft.lineas.find((item) => item.producto.id === valid.id)
  if (!line) return invalid('producto_id', 'El producto no está en este borrador.')
  cantidadValida(line.cantidad, valid)
  return { ...draft, lineas: draft.lineas.map((item) => item === line
    ? { ...item, producto: valid, precio_unitario_esperado: valid.precio_venta } : item) }
}
export function cambiarObservacionesDraft(draft: VentaDraft, observaciones: string): VentaDraft {
  if (typeof observaciones !== 'string' || observaciones.length > 500) return invalid('observaciones', 'Usa texto de hasta 500 caracteres.')
  return { ...draft, observaciones }
}

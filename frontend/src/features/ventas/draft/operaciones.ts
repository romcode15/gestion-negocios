import { ApiException } from '../../../api/errors'
import { generarClaveOperacion } from '../../../api/operacionInventario'
import { normalizarDecimal } from '../../../lib/decimales'
import type { AnularVentaSolicitud, RegistrarVentaSolicitud } from '../types'
import type { VentaDraft } from './types'

function invalid(field: string, message: string): never { throw new ApiException('validation_error', 'Revisa los campos.', { [field]: [message] }, 400) }
function texto(value: unknown, max: number, field: string, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) return invalid(field, 'Texto requerido o fuera de rango.')
  return value.trim()
}
export function normalizarRegistroVenta(input: Omit<RegistrarVentaSolicitud, 'clave_operacion'>): Omit<RegistrarVentaSolicitud, 'clave_operacion'> {
  if (!Array.isArray(input.detalles) || input.detalles.length < 1 || input.detalles.length > 100) return invalid('detalles', 'Usa entre 1 y 100 productos distintos.')
  const ids = new Set<number>()
  const detalles = input.detalles.map((line, index) => {
    const field = `detalles.${index}`
    if (!line || typeof line !== 'object' || !Number.isSafeInteger(line.producto_id) || line.producto_id <= 0 || ids.has(line.producto_id)) return invalid(field + '.producto_id', 'ID inválido o repetido.')
    ids.add(line.producto_id)
    const cantidad = normalizarDecimal(line.cantidad, { escala: 3, precision: 14, campo: field + '.cantidad' })
    if (cantidad === '0.000') return invalid(field + '.cantidad', 'La cantidad debe ser positiva.')
    const precio_unitario_esperado = normalizarDecimal(line.precio_unitario_esperado, { escala: 2, precision: 12, campo: field + '.precio_unitario_esperado' })
    return { producto_id: line.producto_id, cantidad, precio_unitario_esperado }
  })
  return { observaciones: texto(input.observaciones === undefined ? '' : input.observaciones, 500, 'observaciones', false), detalles }
}
function congelar<T extends object>(value: T): Readonly<T> {
  for (const item of Object.values(value)) if (item && typeof item === 'object') congelar(item)
  return Object.freeze(value)
}
function operacion<T extends object>(normalizar: (input: T) => T, huella: (input: T) => string) {
  let fingerprint = '', payload: Readonly<T & { clave_operacion: string }> | null = null
  return {
    preparar(input: T) {
      const normalized = normalizar(input), next = huella(normalized)
      if (!payload || next !== fingerprint) {
        const candidate = congelar({ ...structuredClone(normalized), clave_operacion: generarClaveOperacion() })
        fingerprint = next; payload = candidate
      }
      return payload
    },
    nueva() { fingerprint = ''; payload = null },
  }
}
export function crearOperacionVenta() {
  return operacion<Omit<RegistrarVentaSolicitud, 'clave_operacion'>>(normalizarRegistroVenta,
    (input) => JSON.stringify({ observaciones: input.observaciones, detalles: [...input.detalles].sort((a, b) => a.producto_id - b.producto_id) }))
}
export function crearOperacionAnulacion() {
  return operacion<Omit<AnularVentaSolicitud, 'clave_operacion'>>((input) => ({ motivo: texto(input.motivo, 255, 'motivo') }), JSON.stringify)
}
export function solicitudDesdeDraft(draft: VentaDraft): Omit<RegistrarVentaSolicitud, 'clave_operacion'> {
  return normalizarRegistroVenta({ observaciones: draft.observaciones, detalles: draft.lineas.map((line) => ({
    producto_id: line.producto.id, cantidad: line.cantidad, precio_unitario_esperado: line.precio_unitario_esperado,
  })) })
}

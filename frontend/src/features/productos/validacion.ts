import { aEnteroEscalado } from '../../lib/decimales'
import type { Unidad } from './types'

export interface FormProducto {
  categoria_id: number | null
  sku: string
  nombre: string
  descripcion: string
  unidad: Unidad
  precio_venta: string
  stock_minimo: string
}

const PATRON_SKU = /^[A-Z0-9][A-Z0-9._-]{0,49}$/

export function normalizarSku(valor: string): string {
  return valor.trim().toUpperCase()
}

function decimalValido(valor: string, escala: number, precision: number, unidad?: Unidad): string | null {
  try {
    aEnteroEscalado(valor, { escala, precision, unidad })
    return null
  } catch (error) {
    const e = error as { errors?: Record<string, string[]> }
    return Object.values(e.errors ?? {})[0]?.[0] ?? 'Valor inválido.'
  }
}

export function validarProducto(f: FormProducto): Record<string, string[]> {
  const errores: Record<string, string[]> = {}
  if (f.categoria_id === null) errores.categoria_id = ['Selecciona una categoría.']
  const sku = normalizarSku(f.sku)
  if (!sku) errores.sku = ['El SKU es obligatorio.']
  else if (!PATRON_SKU.test(sku)) errores.sku = ['SKU inválido: letras, números, punto, guion y guion bajo.']
  const nombre = f.nombre.trim()
  if (!nombre) errores.nombre = ['El nombre es obligatorio.']
  else if (nombre.length > 150) errores.nombre = ['Máximo 150 caracteres.']
  if (f.descripcion.trim().length > 500) errores.descripcion = ['Máximo 500 caracteres.']
  const precio = decimalValido(f.precio_venta.trim(), 2, 12)
  if (precio) errores.precio_venta = [precio]
  const minimo = decimalValido(f.stock_minimo.trim() || '0', 3, 14, f.unidad)
  if (minimo) errores.stock_minimo = [minimo]
  return errores
}
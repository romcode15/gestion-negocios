import { ApiException } from '../api/errors'
export interface OpcionesDecimal { escala: number; precision: number; campo?: string; permitirNegativo?: boolean; unidad?: 'unidad' | 'kg' | 'litro' }
export function aEnteroEscalado(value: unknown, { escala, precision, campo = 'cantidad', permitirNegativo = false, unidad }: OpcionesDecimal): bigint {
  function invalid(message: string): never { throw new ApiException('validation_error', 'Revisa los campos indicados.', { [campo]: [message] }, 400) }
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return invalid('Usa una cadena decimal sin coma ni exponentes.')
  const negative = value.startsWith('-')
  const [integer, fractional = ''] = (negative ? value.slice(1) : value).split('.')
  if (fractional.length > escala) return invalid('Se excedió la precisión decimal permitida.')
  const magnitude = BigInt(integer) * 10n ** BigInt(escala) + BigInt(fractional.padEnd(escala, '0') || '0')
  if (magnitude >= 10n ** BigInt(precision)) return invalid('El valor está fuera de rango.')
  const result = negative ? -magnitude : magnitude
  if (!permitirNegativo && result < 0n) return invalid('El valor no puede ser negativo.')
  if (unidad === 'unidad' && result % 10n ** BigInt(escala) !== 0n) return invalid('Esta unidad requiere cantidades enteras.')
  return result
}
export function formatearDecimal(value: bigint, escala = 3): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(escala + 1, '0')
  return (negative ? '-' : '') + (escala ? digits.slice(0, -escala) + '.' + digits.slice(-escala) : digits)
}
export function normalizarDecimal(value: unknown, options: OpcionesDecimal): string { return formatearDecimal(aEnteroEscalado(value, options), options.escala) }

// HALF_UP una vez por línea. La suma usa subtotales ya redondeados.
export function subtotalVenta(cantidad: string, precioUnitario: string, unidad?: OpcionesDecimal['unidad']): string {
  const quantity = aEnteroEscalado(cantidad, { escala: 3, precision: 14, campo: 'cantidad', unidad })
  if (quantity <= 0n) throw new ApiException('validation_error', 'La cantidad debe ser positiva.', { cantidad: ['Usa una cantidad positiva.'] }, 400)
  const price = aEnteroEscalado(precioUnitario, { escala: 2, precision: 12, campo: 'precio_unitario_esperado' })
  const result = formatearDecimal((quantity * price + 500n) / 1000n, 2)
  return normalizarDecimal(result, { escala: 2, precision: 14, campo: 'subtotal' })
}
export function totalVenta(subtotales: readonly string[]): string {
  const sum = subtotales.reduce((total, value) => total + aEnteroEscalado(value, { escala: 2, precision: 14, campo: 'total' }), 0n)
  return normalizarDecimal(formatearDecimal(sum, 2), { escala: 2, precision: 14, campo: 'total' })
}

import type { ApiError } from '../../../../api/types'
import type { VentaDraft } from '../../draft'

// Los índices pertenecen al snapshot enviado, nunca al orden visible actual.
export function erroresLineaVenta(errors: ApiError['errors'], snapshot: VentaDraft, productoId: number): Record<string, string[]> {
  const index = snapshot.lineas.findIndex((linea) => linea.producto.id === productoId)
  if (index < 0) return {}
  const prefix = `detalles.${index}.`
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), [...value]]))
}

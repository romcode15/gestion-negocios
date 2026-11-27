import { createContext, useContext } from 'react'
import type { VentaDraftValue } from './types'

export const VentaDraftContext = createContext<VentaDraftValue | null>(null)
export function useVentaDraft(): VentaDraftValue {
  const context = useContext(VentaDraftContext)
  if (!context) throw new Error('useVentaDraft necesita VentaDraftProvider en un contexto autorizado.')
  return context
}

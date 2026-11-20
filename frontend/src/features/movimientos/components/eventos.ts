// Señal local del módulo para que F9 refresque el historial sin consultas denegadas.
export const EVENTO_HISTORIAL_ACTUALIZADO = 'movimientos:historial-actualizado'

export function notificarHistorialActualizado(negocioId: number): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENTO_HISTORIAL_ACTUALIZADO, { detail: { negocioId } }))
}

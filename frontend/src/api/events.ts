import type { ApiException } from './errors'
const listeners = new Set<(error: ApiException) => void>()
export function suscribirErroresApi(listener: (error: ApiException) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function notificarErrorApi(error: ApiException) {
  for (const listener of listeners) listener(error)
}

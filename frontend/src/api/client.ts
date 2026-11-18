import type { ApiRequest } from './contracts'
import { httpTransport } from './http'
import { mockTransport } from '../mocks/services/transport'
import { ApiException } from './errors'
import { notificarErrorApi } from './events'
const mode = import.meta.env.VITE_API_MODE ?? 'mock'
if (mode !== 'mock' && mode !== 'http') throw new Error('VITE_API_MODE debe ser mock o http.')
const transport = mode === 'mock' ? mockTransport : httpTransport
export async function request<T>(options: ApiRequest): Promise<T> {
  try {
    const result = await transport.request<T>(options)
    options.signal?.throwIfAborted()
    return result
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof ApiException) notificarErrorApi(error)
    throw error
  }
}
export function rutaPagina(path: string, page = 1): string {
  if (!Number.isInteger(page) || page < 1) throw new ApiException('validation_error', 'Página inválida.', { page: ['Usa un entero positivo.'] }, 400)
  return path + '?page=' + page
}
export function contextoNegocio(id: number): string {
  if (!Number.isInteger(id) || id <= 0) throw new ApiException('validation_error', 'Negocio inválido.', { negocio_id: ['Usa un ID positivo.'] }, 400)
  return '/negocios/' + id
}

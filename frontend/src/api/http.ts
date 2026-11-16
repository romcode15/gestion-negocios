import type { ApiRequest, Transport } from './contracts'
import { ApiException, isAbortError } from './errors'
function csrfCookie(): string {
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrftoken='))
  return value ? decodeURIComponent(value.slice('csrftoken='.length)) : ''
}
function normalize(value: unknown, status: number): ApiException {
  if (typeof value === 'object' && value !== null && 'code' in value && 'detail' in value &&
      typeof value.code === 'string' && typeof value.detail === 'string') {
    const errors: Record<string, string[]> = {}
    if ('errors' in value && typeof value.errors === 'object' && value.errors !== null) {
      for (const [field, messages] of Object.entries(value.errors)) {
        if (Array.isArray(messages) && messages.every((message) => typeof message === 'string')) errors[field] = messages
      }
    }
    return new ApiException(value.code, value.detail, errors, status)
  }
  return new ApiException('http_error', 'No se pudo completar la solicitud.', {}, status)
}
export const httpTransport: Transport = {
  async request<T>({ method, path, body, signal }: ApiRequest): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new ApiException('invalid_path', 'Ruta inválida.')
    try {
      const headers: Record<string, string> = {}
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (method !== 'GET') headers['X-CSRFToken'] = csrfCookie()
      const response = await fetch('/api/v1' + path, {
        method, credentials: 'include', headers, signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      if (response.status === 204) return undefined as T
      let value: unknown
      try { value = await response.json() } catch (error) {
        if (isAbortError(error)) throw error
        throw new ApiException('invalid_response', 'El servidor devolvió una respuesta inválida.', {}, response.status)
      }
      if (!response.ok) {
        const error = normalize(value, response.status)
        if (error.code === 'csrf_failed') {
          // Recuperar token; la mutación original nunca se repite automáticamente.
          try { await fetch('/api/v1/auth/csrf/', { credentials: 'include', signal }) } catch (refreshError) {
            if (isAbortError(refreshError)) throw refreshError
          }
        }
        throw error
      }
      return value as T
    } catch (error) {
      if (error instanceof ApiException || isAbortError(error)) throw error
      throw new ApiException('network_error', 'No se pudo conectar con el servidor.')
    }
  },
}

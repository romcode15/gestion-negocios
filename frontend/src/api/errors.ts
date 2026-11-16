import type { ApiError } from './types'
export class ApiException extends Error implements ApiError {
  code: string
  detail: string
  errors: Record<string, string[]>
  status: number
  constructor(code: string, detail: string, errors: Record<string, string[]> = {}, status = 0) {
    super(detail)
    this.name = 'ApiException'
    this.code = code
    this.detail = detail
    this.errors = errors
    this.status = status
  }
}
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

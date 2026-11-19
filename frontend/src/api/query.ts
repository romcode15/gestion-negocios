import { ApiException } from './errors'
export function rutaConsulta(path: string, params: object): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (!['string', 'boolean', 'number'].includes(typeof value)) throw new ApiException('validation_error', 'Filtro inválido.', { [key]: ['Usa texto, booleano o número según contrato.'] }, 400)
    query.set(key, String(value))
  }
  return query.size ? path + '?' + query.toString() : path
}
export function idRuta(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiException('validation_error', 'ID inválido.', { id: ['Usa un entero positivo.'] }, 400)
  return id
}

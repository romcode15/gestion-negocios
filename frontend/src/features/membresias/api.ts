import { request, rutaPagina, contextoNegocio } from '../../api/client'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { CambiarRolSolicitud, CrearMembresiaSolicitud, Membresia } from './types'
import { ApiException } from '../../api/errors'
export function listarMembresias(negocioId: number, { page, ...options }: ListOptions = {}): Promise<Pagina<Membresia>> { return request({ method: 'GET', path: rutaPagina(contextoNegocio(negocioId) + '/membresias/', page), ...options }) }
export function crearMembresia(negocioId: number, input: CrearMembresiaSolicitud, options: RequestOptions = {}): Promise<Membresia> { return request({ method: 'POST', path: contextoNegocio(negocioId) + '/membresias/', body: input, ...options }) }
export function cambiarRolMembresia(negocioId: number, membresiaId: number, input: CambiarRolSolicitud, options: RequestOptions = {}): Promise<Membresia> {
  if (!Number.isInteger(membresiaId) || membresiaId <= 0) return Promise.reject(new ApiException('validation_error', 'Membresía inválida.', { membresia_id: ['Usa un ID positivo.'] }, 400))
  return request({ method: 'PATCH', path: contextoNegocio(negocioId) + '/membresias/' + membresiaId + '/', body: input, ...options })
}

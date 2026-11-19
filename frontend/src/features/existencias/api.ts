import { request, contextoNegocio } from '../../api/client'
import { rutaConsulta, idRuta } from '../../api/query'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { Existencia, FiltrosExistencias } from './types'
export function listarExistencias(negocioId: number, { signal, page = 1, ...filters }: ListOptions & FiltrosExistencias = {}): Promise<Pagina<Existencia>> {
  return request({ method: 'GET', path: rutaConsulta(contextoNegocio(negocioId) + '/existencias/', { page, ...filters }), signal })
}
export function obtenerExistencia(negocioId: number, productoId: number, options: RequestOptions = {}): Promise<Existencia> {
  return request({ method: 'GET', path: contextoNegocio(negocioId) + '/existencias/' + idRuta(productoId) + '/', ...options })
}

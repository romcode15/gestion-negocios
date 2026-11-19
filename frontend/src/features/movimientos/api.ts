import { request, contextoNegocio } from '../../api/client'
import { rutaConsulta } from '../../api/query'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { Movimiento, FiltrosMovimientos, RegistrarMovimientoSolicitud, RegistrarAjusteSolicitud } from './types'
export function listarMovimientos(negocioId: number, { signal, page = 1, ...filters }: ListOptions & FiltrosMovimientos = {}): Promise<Pagina<Movimiento>> {
  return request({ method: 'GET', path: rutaConsulta(contextoNegocio(negocioId) + '/movimientos/', { page, ...filters }), signal })
}
export function registrarMovimiento(negocioId: number, input: RegistrarMovimientoSolicitud, options: RequestOptions = {}): Promise<Movimiento> {
  return request({ method: 'POST', path: contextoNegocio(negocioId) + '/movimientos/', body: input, ...options })
}
export function registrarAjuste(negocioId: number, input: RegistrarAjusteSolicitud, options: RequestOptions = {}): Promise<Movimiento> {
  return request({ method: 'POST', path: contextoNegocio(negocioId) + '/ajustes/', body: input, ...options })
}

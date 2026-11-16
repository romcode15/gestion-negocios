import { request, rutaPagina } from '../../api/client'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { CrearNegocioSolicitud, Negocio } from './types'
export function listarNegocios({ page, ...options }: ListOptions = {}): Promise<Pagina<Negocio>> { return request({ method: 'GET', path: rutaPagina('/plataforma/negocios/', page), ...options }) }
export function crearNegocio(input: CrearNegocioSolicitud, options: RequestOptions = {}): Promise<Negocio> { return request({ method: 'POST', path: '/plataforma/negocios/', body: input, ...options }) }

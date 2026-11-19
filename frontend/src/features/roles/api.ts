import { request, rutaPagina, contextoNegocio } from '../../api/client'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { CrearRolSolicitud, Permiso, Rol } from './types'
export function listarPermisos(negocioId: number, { page, ...options }: ListOptions = {}): Promise<Pagina<Permiso>> { return request({ method: 'GET', path: rutaPagina(contextoNegocio(negocioId) + '/permisos/', page), ...options }) }
export function listarRoles(negocioId: number, { page, ...options }: ListOptions = {}): Promise<Pagina<Rol>> { return request({ method: 'GET', path: rutaPagina(contextoNegocio(negocioId) + '/roles/', page), ...options }) }
export function listarRolesAsignables(negocioId: number, { page, ...options }: ListOptions = {}): Promise<Pagina<Rol>> { return request({ method: 'GET', path: rutaPagina(contextoNegocio(negocioId) + '/roles/asignables/', page), ...options }) }
export function crearRol(negocioId: number, input: CrearRolSolicitud, options: RequestOptions = {}): Promise<Rol> { return request({ method: 'POST', path: contextoNegocio(negocioId) + '/roles/', body: input, ...options }) }

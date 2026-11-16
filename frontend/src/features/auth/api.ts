import { request } from '../../api/client'
import type { RequestOptions } from '../../api/contracts'
import type { LoginSolicitud, Sesion } from './types'
export function obtenerCsrf(options: RequestOptions = {}): Promise<void> {
  return request({ method: 'GET', path: '/auth/csrf/', ...options })
}
export async function iniciarSesion(input: LoginSolicitud, options: RequestOptions = {}): Promise<Sesion> {
  await obtenerCsrf(options)
  return request({ method: 'POST', path: '/auth/login/', body: input, ...options })
}
export function obtenerSesion(options: RequestOptions = {}): Promise<Sesion> { return request({ method: 'GET', path: '/auth/me/', ...options }) }
export function cerrarSesion(options: RequestOptions = {}): Promise<void> { return request({ method: 'POST', path: '/auth/logout/', ...options }) }

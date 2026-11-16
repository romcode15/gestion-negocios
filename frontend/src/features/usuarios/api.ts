import { request, rutaPagina } from '../../api/client'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { CrearUsuarioSolicitud, Usuario } from './types'
export function listarUsuarios({ page, ...options }: ListOptions = {}): Promise<Pagina<Usuario>> { return request({ method: 'GET', path: rutaPagina('/plataforma/usuarios/', page), ...options }) }
export function crearUsuario(input: CrearUsuarioSolicitud, options: RequestOptions = {}): Promise<Usuario> { return request({ method: 'POST', path: '/plataforma/usuarios/', body: input, ...options }) }

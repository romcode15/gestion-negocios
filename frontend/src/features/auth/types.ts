import type { Usuario } from '../usuarios/types'
export interface NegocioSesion { id: number; nombre: string; rol_id: number; permisos: string[] }
export interface Sesion { usuario: Usuario; permisos_globales: string[]; negocios: NegocioSesion[] }
export interface LoginSolicitud { username: string; password: string }

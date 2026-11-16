import type { Usuario } from '../usuarios/types'
export interface Membresia { id: number; usuario: Usuario; negocio_id: number; rol_id: number; activo: boolean }
export type CrearMembresiaSolicitud = { username: string; rol_id: number } & ({ password: string } | { password?: never })
export interface CambiarRolSolicitud { rol_id: number }

export interface Permiso { id: number; codigo: string; ambito: 'plataforma' | 'negocio' }
export interface Rol { id: number; nombre: string; negocio_id: number | null; predefinido: boolean; permiso_ids: number[] }
export interface CrearRolSolicitud { nombre: string; permiso_ids: number[] }

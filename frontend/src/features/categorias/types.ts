export interface Categoria { id: number; negocio_id: number; nombre: string; descripcion: string; activo: boolean }
export interface CategoriaOpcion { id: number; negocio_id: number; nombre: string }
export interface CrearCategoriaSolicitud { nombre: string; descripcion?: string }
export interface ActualizarCategoriaSolicitud { nombre?: string; descripcion?: string; activo?: boolean }
export interface FiltrosCategorias { search?: string; activo?: boolean }

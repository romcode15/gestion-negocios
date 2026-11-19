export type Unidad = 'unidad' | 'kg' | 'litro'
export interface Producto { id: number; negocio_id: number; categoria_id: number; categoria_nombre: string; sku: string; nombre: string; descripcion: string; unidad: Unidad; precio_venta: string; stock_minimo: string; activo: boolean }
export interface ProductoOpcion { id: number; negocio_id: number; sku: string; nombre: string; unidad: Unidad }
export interface ProductoResumen extends ProductoOpcion { activo: boolean; categoria_id: number; categoria_nombre: string }
export interface CrearProductoSolicitud { categoria_id: number; sku: string; nombre: string; descripcion?: string; unidad: Unidad; precio_venta: string; stock_minimo?: string }
export interface ActualizarProductoSolicitud { categoria_id?: number; sku?: string; nombre?: string; descripcion?: string; unidad?: Unidad; precio_venta?: string; stock_minimo?: string; activo?: boolean }
export interface FiltrosProductos { search?: string; categoria_id?: number; activo?: boolean }

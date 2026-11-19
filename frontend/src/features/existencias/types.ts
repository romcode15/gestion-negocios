import type { ProductoResumen } from '../productos/types'
export interface Existencia { id: number; negocio_id: number; producto: ProductoResumen; cantidad: string; stock_minimo: string; bajo_minimo: boolean; version: number }
export interface FiltrosExistencias { search?: string; categoria_id?: number; activo?: boolean; bajo_minimo?: boolean }

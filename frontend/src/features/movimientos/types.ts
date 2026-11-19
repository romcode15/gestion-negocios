import type { ProductoOpcion } from '../productos/types'
import type { Usuario } from '../usuarios/types'
export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste'
export interface Movimiento { id: number; negocio_id: number; producto: ProductoOpcion; usuario: Usuario; tipo: TipoMovimiento; cantidad: string; saldo_anterior: string; saldo_posterior: string; motivo: string; clave_operacion: string; creado_en: string }
export interface RegistrarMovimientoSolicitud { producto_id: number; tipo: 'entrada' | 'salida'; cantidad: string; motivo: string; clave_operacion: string }
export interface RegistrarAjusteSolicitud { producto_id: number; stock_objetivo: string; version_esperada: number; motivo: string; clave_operacion: string }
export interface FiltrosMovimientos { search?: string; producto_id?: number; tipo?: TipoMovimiento; desde?: string; hasta?: string }

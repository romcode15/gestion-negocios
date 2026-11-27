import type { Usuario } from '../usuarios/types'
import type { Unidad } from '../productos/types'
import type { Movimiento } from '../movimientos/types'

export type EstadoVenta = 'confirmada' | 'anulada'
export interface VentaProductoOpcion { id: number; negocio_id: number; sku: string; nombre: string; unidad: Unidad; precio_venta: string; disponible: string }
export interface VentaResumen { id: number; negocio_id: number; estado: EstadoVenta; total: string; vendedor: Usuario; creado_en: string }
export interface DetalleVenta { id: number; producto_id: number; sku: string; nombre: string; unidad: Unidad; cantidad: string; precio_unitario: string; subtotal: string }
export interface AnulacionVenta { id: number; usuario: Usuario; motivo: string; clave_operacion: string; creado_en: string }
export interface VentaDetalle extends VentaResumen { clave_operacion: string; observaciones: string; detalles: DetalleVenta[]; anulacion: AnulacionVenta | null }
export interface MovimientoVenta { detalle_id: number; operacion: 'venta' | 'anulacion'; movimiento: Movimiento }
export interface LineaVentaSolicitud { producto_id: number; cantidad: string; precio_unitario_esperado: string }
export interface RegistrarVentaSolicitud { clave_operacion: string; observaciones?: string; detalles: LineaVentaSolicitud[] }
export interface AnularVentaSolicitud { clave_operacion: string; motivo: string }
export interface FiltrosVentas { search?: string; estado?: EstadoVenta; desde?: string; hasta?: string }
export interface FiltrosProductosVenta { search?: string }

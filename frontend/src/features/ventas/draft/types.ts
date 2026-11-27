import type { VentaProductoOpcion } from '../types'

export type ProductoVentaDraft = VentaProductoOpcion
export interface LineaVentaDraft {
  producto: ProductoVentaDraft
  cantidad: string
  precio_unitario_esperado: string
}
export interface VentaDraft {
  lineas: readonly LineaVentaDraft[]
  observaciones: string
}
export interface VentaDraftActions {
  agregar(producto: ProductoVentaDraft, cantidad?: string): void
  cambiarCantidad(productoId: number, cantidad: string): void
  revisarProducto(producto: ProductoVentaDraft): void
  quitar(productoId: number): void
  cambiarObservaciones(observaciones: string): void
  vaciar(): void
}
export interface VentaDraftValue extends VentaDraftActions {
  negocioId: number
  busy: boolean
  draft: VentaDraft
  snapshot(): VentaDraft
  iniciarEnvio(): VentaDraft
  terminarEnvio(exito?: boolean): void
}

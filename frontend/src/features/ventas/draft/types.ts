import type { Producto } from '../../productos/types'

// Estado local de interfaz; F2 define las respuestas de API en ventas/types.ts.
export type ProductoVentaDraft = Pick<Producto, 'id' | 'negocio_id' | 'sku' | 'nombre' | 'unidad' | 'precio_venta'> & {
  disponible: string
}
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

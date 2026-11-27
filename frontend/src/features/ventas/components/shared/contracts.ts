import type { ApiError } from '../../../../api/types'
import type { ProductoVentaDraft, VentaDraft, VentaDraftActions } from '../../draft'

// Contratos de composición de F1. F2 define los DTO exactos; los genéricos
// permiten a Kelvin usarlos sin duplicar VentaResumen/VentaDetalle aquí.
export interface SelectorProductosVentaProps {
  onAgregar: VentaDraftActions['agregar']
  busy?: boolean
}
export interface CarritoVentaProps {
  draft: VentaDraft
  onCambiarCantidad: VentaDraftActions['cambiarCantidad']
  onQuitar: VentaDraftActions['quitar']
  onVaciar: VentaDraftActions['vaciar']
  busy?: boolean
  error?: ApiError | null
  snapshotEnviado?: VentaDraft
}
export interface ConfirmarVentaProps {
  draft: VentaDraft
  busy: boolean
  onCambiarObservaciones: VentaDraftActions['cambiarObservaciones']
  onIniciarEnvio: () => VentaDraft
  onTerminarEnvio: (exito?: boolean) => void
  onRevisarProducto: (producto: ProductoVentaDraft) => void
}
export interface ListaVentasProps<Resumen extends { id: number }> {
  seleccionadoId: number | null
  refreshKey: number
  onSeleccionar: (venta: Resumen) => void
}
export interface DetalleVentaPanelProps<Detalle extends { id: number }> {
  ventaId: number | null
  refreshKey: number
  onCargada: (venta: Detalle | null) => void
  onSolicitarAnulacion: (venta: Detalle) => void
}
export interface AnularVentaModalProps<Detalle extends { id: number }> {
  venta: Detalle
  onClose: () => void
  onAnulada: (venta: Detalle) => void
}

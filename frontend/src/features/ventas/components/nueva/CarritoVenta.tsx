import type { CarritoVentaProps } from '../shared/contracts'
import { PiezaVentaPendiente } from '../shared/PiezaVentaPendiente'

// Diana/F5 (#92) implementa la presentación y edición, usando el borrador común.
export function CarritoVenta(_props: CarritoVentaProps) {
  return <PiezaVentaPendiente titulo="Carrito de venta" issue={92} />
}

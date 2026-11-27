import type { ConfirmarVentaProps } from '../shared/contracts'
import { PiezaVentaPendiente } from '../shared/PiezaVentaPendiente'

// Diana/F6 (#93) implementa confirmación, pending, snapshot y envío único.
export function ConfirmarVenta(_props: ConfirmarVentaProps) {
  return <PiezaVentaPendiente titulo="Confirmación de venta" issue={93} />
}

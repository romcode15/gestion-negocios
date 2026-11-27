import type { SelectorProductosVentaProps } from '../shared/contracts'
import { PiezaVentaPendiente } from '../shared/PiezaVentaPendiente'

// Diana/F4 (#91) sustituye este stub conservando el contrato público.
export function SelectorProductosVenta(_props: SelectorProductosVentaProps) {
  return <PiezaVentaPendiente titulo="Productos para vender" issue={91} />
}

import { usePermiso } from '../../../app/providers/SessionContext'
import { PageHeading } from '../../../components/ui/PageHeading'
import { PiezaVentaPendiente } from '../components/shared/PiezaVentaPendiente'

// Kelvin es dueño de esta página desde F7. Contratos: shared/contracts.ts.
// El detalle será panel y AnularVentaModal el único diálogo, no anidado.
export function VentasPage() {
  const puedeListar = usePermiso('listar_ventas')
  return <section>
    <PageHeading title="Ventas" description="Consulta y anulación de ventas del negocio activo." />
    {!puedeListar && <p role="note">No tienes permiso para listar ventas. F8 habilitará la consulta por un ID conocido.</p>}
    {puedeListar && <PiezaVentaPendiente titulo="Listado de ventas" issue={94} />}
    <PiezaVentaPendiente titulo="Detalle y trazabilidad de venta" issue={95} />
    <PiezaVentaPendiente titulo="Anulación total" issue={96} />
  </section>
}

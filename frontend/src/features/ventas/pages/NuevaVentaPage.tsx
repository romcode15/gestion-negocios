import { PageHeading } from '../../../components/ui/PageHeading'
import { VentaDraftProvider, useVentaDraft } from '../draft'
import { SelectorProductosVenta } from '../components/nueva/SelectorProductosVenta'
import { CarritoVenta } from '../components/nueva/CarritoVenta'
import { ConfirmarVenta } from '../components/nueva/ConfirmarVenta'

// Henry mantiene composición/provider; Diana completa las tres piezas separadas.
export function NuevaVentaPage() {
  return <VentaDraftProvider><ContenidoNuevaVenta /></VentaDraftProvider>
}
function ContenidoNuevaVenta() {
  const { draft, busy, agregar, cambiarCantidad, quitar, vaciar, cambiarObservaciones, revisarProducto, iniciarEnvio, terminarEnvio } = useVentaDraft()
  return <section>
    <PageHeading title="Nueva venta" description="Prepara una venta en el contexto del negocio activo." />
    <p role="note">Carrito local: no reserva existencias. Selector, edición y confirmación pendientes de F4–F6.</p>
    <SelectorProductosVenta onAgregar={agregar} busy={busy} />
    <CarritoVenta draft={draft} onCambiarCantidad={cambiarCantidad} onQuitar={quitar} onVaciar={vaciar} busy={busy} />
    <ConfirmarVenta draft={draft} busy={busy} onCambiarObservaciones={cambiarObservaciones}
      onRevisarProducto={revisarProducto} onIniciarEnvio={iniciarEnvio} onTerminarEnvio={terminarEnvio} />
  </section>
}

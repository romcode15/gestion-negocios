import { EmptyState } from '../../../../components/feedback/Feedback'

export function PiezaVentaPendiente({ titulo, issue }: { titulo: string; issue: number }) {
  return <section aria-label={titulo}>
    <h2>{titulo}</h2>
    <EmptyState title="Pendiente de implementación">
      Esta base reserva la integración de la issue #{issue}. Todavía no realiza operaciones de venta.
    </EmptyState>
  </section>
}

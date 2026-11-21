import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import { AccessDenied, EmptyState } from '../../../components/feedback/Feedback'
import { ListaExistencias } from '../components/ListaExistencias'

export function ExistenciasPage() {
  const { negocioId } = useSesion()
  return (
    <section>
      <h1>Existencias</h1>
      {negocioId === null
        ? <EmptyState title="Sin negocio activo">Selecciona un negocio para ver sus existencias.</EmptyState>
        : <ExistenciasNegocio key={negocioId} />}
    </section>
  )
}

function ExistenciasNegocio() {
  const puedeConsultar = usePermiso('consultar_existencias')
  if (!puedeConsultar) return <AccessDenied />
  return <ListaExistencias />
}
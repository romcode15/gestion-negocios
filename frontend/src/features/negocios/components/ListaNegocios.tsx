import type { ApiError, Pagina } from '../../../api/types'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import type { Negocio } from '../types'

type Props = {
  page: number
  pagina: Pagina<Negocio> | null
  pendiente: boolean
  error: ApiError | null
  onPagina: (page: number) => void
  onReintentar: () => void
}

export function ListaNegocios({ page, pagina, pendiente, error, onPagina, onReintentar }: Props) {
  return <section>
    <h2>Negocios registrados</h2>
    {pendiente && <Loading>Cargando negocios…</Loading>}
    {!pendiente && error && <ApiFeedback error={error} onRetry={onReintentar} />}
    {!pendiente && !error && pagina?.results.length === 0 && <EmptyState title="No hay negocios">
      <p>Todavía no hay negocios registrados en la plataforma.</p>
    </EmptyState>}
    {!pendiente && !error && pagina && pagina.results.length > 0 && <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">Estado</th></tr></thead>
        <tbody>{pagina.results.map((negocio) => <tr key={negocio.id}>
          <td>{negocio.nombre}</td>
          <td>{negocio.tipo}</td>
          <td>{negocio.activo ? 'Activo' : 'Inactivo'}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {pagina && <div className="paginacion">
      <span aria-live="polite">Página {page} · {pagina.count} negocio(s)</span>
      <Button disabled={pendiente || page === 1 || !pagina.previous} onClick={() => onPagina(Math.max(1, page - 1))}>Anterior</Button>
      <Button disabled={pendiente || !pagina.next} onClick={() => onPagina(page + 1)}>Siguiente</Button>
    </div>}
  </section>
}

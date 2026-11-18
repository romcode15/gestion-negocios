import type { ApiException } from '../../../api/errors'
import type { Pagina } from '../../../api/types'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import type { Rol } from '../../roles/types'
import type { EstadoRoles } from '../seleccion'
import { nombreRol } from '../seleccion'
import type { Membresia } from '../types'
import { CambiarRolForm } from './CambiarRolForm'

type Props = {
  page: number
  pagina: Pagina<Membresia> | null
  pendiente: boolean
  error: ApiException | null
  rolesPorId: Record<number, Rol>
  estadoRoles: EstadoRoles
  negocioId: number | null
  puedeAsignar: boolean
  onPagina: (page: number) => void
  onReintentar: () => void
  onActualizado: (membresia: Membresia) => void
}

export function ListaMembresias({
  page, pagina, pendiente, error, rolesPorId, estadoRoles, negocioId, puedeAsignar,
  onPagina, onReintentar, onActualizado,
}: Props) {
  return <section>
    <h2>Miembros del negocio</h2>
    {pendiente && <Loading>Cargando membresías…</Loading>}
    {!pendiente && error && <ApiFeedback error={error} onRetry={onReintentar} />}
    {!pendiente && !error && pagina?.results.length === 0 && <EmptyState title="No hay membresías">
      <p>Todavía no hay miembros registrados en este negocio.</p>
    </EmptyState>}
    {!pendiente && !error && pagina && pagina.results.length > 0 && <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr>
          <th scope="col">Usuario</th>
          <th scope="col">Rol</th>
          <th scope="col">Estado</th>
          {puedeAsignar && <th scope="col">Cambiar rol</th>}
        </tr></thead>
        <tbody>{pagina.results.map((membresia) => <tr key={membresia.id}>
          <td>{membresia.usuario.username}</td>
          <td>{nombreRol(rolesPorId, membresia.rol_id)}</td>
          <td>{membresia.activo ? 'Activo' : 'Inactivo'}</td>
          {puedeAsignar && <td>
            <CambiarRolForm key={membresia.id + ':' + membresia.rol_id} membresia={membresia}
              negocioId={negocioId} estadoRoles={estadoRoles} onActualizado={onActualizado} />
          </td>}
        </tr>)}</tbody>
      </table>
    </div>}
    {pagina && <div className="paginacion">
      <span aria-live="polite">Página {page} · {pagina.count} membresía(s)</span>
      <Button disabled={pendiente || page === 1 || !pagina.previous} onClick={() => onPagina(Math.max(1, page - 1))}>Anterior</Button>
      <Button disabled={pendiente || !pagina.next} onClick={() => onPagina(page + 1)}>Siguiente</Button>
    </div>}
  </section>
}

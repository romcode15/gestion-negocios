import type { ApiError, Pagina } from '../../../api/types'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import type { Negocio } from '../types'
import { StatusBadge } from '../../../components/ui/StatusBadge'
type Props = { page: number; pagina: Pagina<Negocio> | null; pendiente: boolean; error: ApiError | null; onPagina: (page: number) => void; onReintentar: () => void }
export function ListaNegocios({ page, pagina, pendiente, error, onPagina, onReintentar }: Props) {
  return <PaginatedTable title="Negocios registrados" loadingLabel="Cargando negocios…" emptyTitle="No hay negocios"
    page={page} pagina={pagina} pending={pendiente} error={error} onPage={onPagina} onRetry={onReintentar} rowKey={(row) => row.id}
    columns={[{ key: 'nombre', header: 'Nombre', render: (row) => row.nombre }, { key: 'tipo', header: 'Tipo', render: (row) => row.tipo },
      { key: 'activo', header: 'Estado', render: (row) => <StatusBadge active={row.activo} /> }]} />
}

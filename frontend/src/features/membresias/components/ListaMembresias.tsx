import type { ApiException } from '../../../api/errors'
import type { Pagina } from '../../../api/types'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import type { TableColumn } from '../../../components/ui/DataTable'
import type { Rol } from '../../roles/types'
import type { EstadoRoles } from '../seleccion'
import { nombreRol } from '../seleccion'
import type { Membresia } from '../types'
import { CambiarRolForm } from './CambiarRolForm'
type Props = { page: number; pagina: Pagina<Membresia> | null; pendiente: boolean; error: ApiException | null; rolesPorId: Record<number, Rol>; estadoRoles: EstadoRoles; negocioId: number | null; puedeAsignar: boolean; onPagina: (page: number) => void; onReintentar: () => void; onActualizado: (membresia: Membresia) => void }
export function ListaMembresias({ page, pagina, pendiente, error, rolesPorId, estadoRoles, negocioId, puedeAsignar, onPagina, onReintentar, onActualizado }: Props) {
  const columns: TableColumn<Membresia>[] = [
    { key: 'usuario', header: 'Usuario', render: (row) => row.usuario.username },
    { key: 'rol', header: 'Rol', render: (row) => nombreRol(rolesPorId, row.rol_id) },
    { key: 'activo', header: 'Estado', render: (row) => row.activo ? 'Activo' : 'Inactivo' },
  ]
  if (puedeAsignar) columns.push({ key: 'cambiar', header: 'Cambiar rol', render: (row) =>
    <CambiarRolForm key={row.id + ':' + row.rol_id} membresia={row} negocioId={negocioId} estadoRoles={estadoRoles} onActualizado={onActualizado} /> })
  return <PaginatedTable title="Miembros del negocio" loadingLabel="Cargando membresías…" emptyTitle="No hay membresías"
    page={page} pagina={pagina} pending={pendiente} error={error} onPage={onPagina} onRetry={onReintentar} columns={columns} rowKey={(row) => row.id} />
}

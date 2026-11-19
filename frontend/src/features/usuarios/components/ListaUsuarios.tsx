import { useCallback, useState } from 'react'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import { listarUsuarios } from '../api'
import { StatusBadge } from '../../../components/ui/StatusBadge'
export function ListaUsuarios({ refresh }: { refresh: number }) {
  const [page, setPage] = useState(1)
  const cargar = useCallback(({ signal }: ContextoConsulta) => { void refresh; return listarUsuarios({ page, signal }) }, [page, refresh])
  const { data, pending, error, reintentar } = useConsultaContexto(cargar)
  return <PaginatedTable title="Cuentas registradas" loadingLabel="Cargando cuentas…" emptyTitle="No hay cuentas"
    page={page} pagina={data} pending={pending} error={error} onPage={setPage} onRetry={reintentar} rowKey={(row) => row.id}
    columns={[{ key: 'username', header: 'Usuario', render: (row) => row.username }, { key: 'is_active', header: 'Estado', render: (row) => <StatusBadge active={row.is_active} /> }]} />
}

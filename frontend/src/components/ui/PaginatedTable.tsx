import type { Key } from 'react'
import type { Pagina, ApiError } from '../../api/types'
import { DataTable } from './DataTable'
import type { TableColumn } from './DataTable'
import { Pagination } from './Pagination'
import { Loading, EmptyState } from '../feedback/Feedback'
import { ApiFeedback } from '../feedback/ApiFeedback'
type Props<T> = { title: string; loadingLabel: string; emptyTitle: string; page: number; pagina: Pagina<T> | null; pending: boolean; error: ApiError | null; onPage: (page: number) => void; onRetry: () => void; columns: TableColumn<T>[]; rowKey: (row: T) => Key }
export function PaginatedTable<T>({ title, loadingLabel, emptyTitle, page, pagina, pending, error, onPage, onRetry, columns, rowKey }: Props<T>) {
  return <section className="collection-card"><div className="collection-heading"><h2>{title}</h2>{pagina && !pending && !error && <span className="collection-count">{pagina.count} registros</span>}</div>
    {pending && <Loading>{loadingLabel}</Loading>}
    {!pending && error && <ApiFeedback error={error} onRetry={onRetry} />}
    {!pending && !error && pagina && (pagina.results.length === 0 ? <EmptyState title={emptyTitle} /> :
      <DataTable rows={pagina.results} columns={columns} rowKey={rowKey} caption={title} />)}
    {pagina && <Pagination page={page} count={pagina.count} next={pagina.next} previous={pagina.previous} pending={pending} onPage={onPage} label={title.toLowerCase()} />}
  </section>
}

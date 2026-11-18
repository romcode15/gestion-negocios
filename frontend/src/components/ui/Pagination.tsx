import { Button } from './Button'
type Props = { page: number; count: number; next: string | null; previous: string | null; pending?: boolean; disabled?: boolean; onPage: (page: number) => void; label?: string }
export function Pagination({ page, count, next, previous, pending = false, disabled = false, onPage, label = 'resultados' }: Props) {
  return <div className="paginacion" role="group" aria-label={'Paginación de ' + label}>
    <span aria-live="polite">Página {page} · {count} {label}</span>
    <Button disabled={disabled || pending || page <= 1 || !previous} onClick={() => onPage(page - 1)}>Anterior</Button>
    <Button disabled={disabled || pending || !next} onClick={() => onPage(page + 1)}>Siguiente</Button>
  </div>
}

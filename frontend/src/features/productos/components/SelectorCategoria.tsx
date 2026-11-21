import { useCallback, useState } from 'react'
import type { Pagina } from '../../../api/types'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Loading } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import { SelectField } from '../../../components/ui/SelectField'
import { listarCategoriasOpciones } from '../../categorias/api'
import type { CategoriaOpcion } from '../../categorias/types'

interface Props {
  value: number | null
  nombreActual?: string
  onChange: (id: number | null) => void
  errors?: string[]
}

export function SelectorCategoria({ value, nombreActual, onChange, errors }: Props) {
  const [page, setPage] = useState(1)
  const [conocidas, setConocidas] = useState<Record<number, string>>(
    value !== null && nombreActual ? { [value]: nombreActual } : {},
  )
  const cargar = useCallback(
    ({ negocioId, signal }: ContextoConsulta): Promise<Pagina<CategoriaOpcion> | null> =>
      negocioId === null ? Promise.resolve(null) : listarCategoriasOpciones(negocioId, { page, signal }),
    [page],
  )
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)

  if (error) return <ApiFeedback error={error} onRetry={reintentar} />
  if (pending && !data) return <Loading>Cargando categorías…</Loading>

  const opciones = data?.results ?? []
  const todas = { ...conocidas }
  for (const o of opciones) todas[o.id] = o.nombre
  const visibles = opciones.slice()
  if (value !== null && !visibles.some((o) => o.id === value) && todas[value]) {
    visibles.unshift({ id: value, negocio_id: 0, nombre: todas[value] })
  }

  return (
    <>
      <SelectField
        label="Categoría"
        name="categoria_id"
        value={value === null ? '' : String(value)}
        errors={errors}
        required
        onChange={(e) => {
          const id = e.target.value === '' ? null : Number(e.target.value)
          if (id !== null) setConocidas((prev) => ({ ...prev, [id]: todas[id] }))
          onChange(id)
        }}
      >
        <option value="">Selecciona una categoría</option>
        {visibles.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </SelectField>
      {data && (data.previous !== null || data.next !== null) && (
        <p>
          <Button type="button" disabled={data.previous === null || pending} onClick={() => setPage((p) => p - 1)}>Categorías anteriores</Button>{' '}
          <span>Página {page}</span>{' '}
          <Button type="button" disabled={data.next === null || pending} onClick={() => setPage((p) => p + 1)}>Categorías siguientes</Button>
        </p>
      )}
    </>
  )
}
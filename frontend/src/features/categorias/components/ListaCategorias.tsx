import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiException } from '../../../api/errors'
import type { Pagina } from '../../../api/types'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { Button } from '../../../components/ui/Button'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import { SelectField } from '../../../components/ui/SelectField'
import { TextField } from '../../../components/ui/TextField'
import { listarCategorias } from '../api'
import type { Categoria, FiltrosCategorias } from '../types'

type EstadoFiltro = '' | 'true' | 'false'

interface Props {
  onEditar: ((categoria: Categoria) => void) | null
  refresco?: number
}

export function ListaCategorias({ onEditar, refresco = 0 }: Props) {
  const [page, setPage] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<EstadoFiltro>('')
  const [filtros, setFiltros] = useState<{ search: string; activo: EstadoFiltro }>({ search: '', activo: '' })

  const cargar = useCallback(
    async ({ negocioId, signal }: ContextoConsulta): Promise<Pagina<Categoria> | null> => {
      if (negocioId === null) return null
      const f: FiltrosCategorias = {}
      if (filtros.search) f.search = filtros.search
      if (filtros.activo) f.activo = filtros.activo === 'true'
      try {
        return await listarCategorias(negocioId, { page, signal, ...f })
      } catch (error) {
        // Una edición puede sacar del filtro la última fila de esta página.
        if (!signal.aborted && error instanceof ApiException && error.status === 404 && page > 1) setPage(1)
        throw error
      }
    },
    [page, filtros],
  )
  const { data, error, pending, reintentar } = useConsultaContexto(cargar, refresco)

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setFiltros({ search: busqueda.trim(), activo: estado })
    setPage(1)
  }

  return (
    <>
      <form onSubmit={aplicar} role="search" aria-label="Filtrar categorías">
        <TextField label="Buscar por nombre" name="search" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} maxLength={150} autoComplete="off" />
        <SelectField label="Estado" name="activo" value={estado}
          onChange={(e) => setEstado(e.target.value as EstadoFiltro)}>
          <option value="">Todas</option>
          <option value="true">Activas</option>
          <option value="false">Inactivas</option>
        </SelectField>
        <Button type="submit">Filtrar</Button>
      </form>

      <PaginatedTable
        title="Categorías del negocio activo"
        loadingLabel="Cargando categorías…"
        emptyTitle="No hay categorías"
        page={page}
        pagina={data}
        pending={pending}
        error={error}
        onPage={setPage}
        onRetry={reintentar}
        rowKey={(categoria) => categoria.id}
        columns={[
          { key: 'nombre', header: 'Nombre', render: (c) => c.nombre },
          { key: 'descripcion', header: 'Descripción', render: (c) => c.descripcion || '—' },
          { key: 'estado', header: 'Estado', render: (c) => (c.activo ? 'Activa' : 'Inactiva') },
          ...(onEditar
            ? [{
                key: 'acciones',
                header: 'Acciones',
                render: (c: Categoria) => (
                  <Button type="button" onClick={() => onEditar(c)} aria-label={`Editar ${c.nombre}`}>Editar</Button>
                ),
              }]
            : []),
        ]}
      />
    </>
  )
}

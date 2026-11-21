import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import type { Pagina } from '../../../api/types'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { Button } from '../../../components/ui/Button'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import { SelectField } from '../../../components/ui/SelectField'
import { TextField } from '../../../components/ui/TextField'
import { listarProductos } from '../api'
import type { FiltrosProductos, Producto } from '../types'

type EstadoFiltro = '' | 'true' | 'false'

interface Props {
  onEditar: ((producto: Producto) => void) | null
}

export function ListaProductos({ onEditar }: Props) {
  const [page, setPage] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [categoriaTexto, setCategoriaTexto] = useState('')
  const [estado, setEstado] = useState<EstadoFiltro>('')
  const [errorCategoria, setErrorCategoria] = useState<string[]>([])
  const [filtros, setFiltros] = useState<FiltrosProductos>({})

  const cargar = useCallback(
    ({ negocioId, signal }: ContextoConsulta): Promise<Pagina<Producto> | null> =>
      negocioId === null ? Promise.resolve(null) : listarProductos(negocioId, { page, signal, ...filtros }),
    [page, filtros],
  )
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const f: FiltrosProductos = {}
    const s = busqueda.trim()
    if (s) f.search = s
    const c = categoriaTexto.trim()
    if (c) {
      if (!/^[1-9]\d*$/.test(c)) { setErrorCategoria(['Usa un ID entero positivo.']); return }
      f.categoria_id = Number(c)
    }
    setErrorCategoria([])
    if (estado) f.activo = estado === 'true'
    setFiltros(f)
    setPage(1)
  }

  return (
    <>
      <form onSubmit={aplicar} role="search" aria-label="Filtrar productos">
        <TextField label="Buscar por nombre o SKU" name="search" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} maxLength={150} autoComplete="off" />
        <TextField label="ID de categoría" name="categoria_id" inputMode="numeric" value={categoriaTexto}
          onChange={(e) => setCategoriaTexto(e.target.value)} errors={errorCategoria} autoComplete="off" />
        <SelectField label="Estado" name="activo" value={estado} onChange={(e) => setEstado(e.target.value as EstadoFiltro)}>
          <option value="">Todos</option>
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
        </SelectField>
        <Button type="submit">Filtrar</Button>
      </form>

      <PaginatedTable
        title="Productos del negocio activo"
        loadingLabel="Cargando productos…"
        emptyTitle="No hay productos"
        page={page}
        pagina={data}
        pending={pending}
        error={error}
        onPage={setPage}
        onRetry={reintentar}
        rowKey={(p) => p.id}
        columns={[
          { key: 'sku', header: 'SKU', render: (p) => p.sku },
          { key: 'nombre', header: 'Nombre', render: (p) => p.nombre },
          { key: 'categoria', header: 'Categoría', render: (p) => p.categoria_nombre },
          { key: 'unidad', header: 'Unidad', render: (p) => p.unidad },
          { key: 'precio', header: 'Precio', render: (p) => p.precio_venta },
          { key: 'minimo', header: 'Mínimo', render: (p) => p.stock_minimo },
          { key: 'estado', header: 'Estado', render: (p) => (p.activo ? 'Activo' : 'Inactivo') },
          ...(onEditar
            ? [{
                key: 'acciones',
                header: 'Acciones',
                render: (p: Producto) => (
                  <Button type="button" onClick={() => onEditar(p)} aria-label={`Editar ${p.nombre}`}>Editar</Button>
                ),
              }]
            : []),
        ]}
      />
    </>
  )
}
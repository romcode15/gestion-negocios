import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import type { Pagina } from '../../../api/types'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { Button } from '../../../components/ui/Button'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import { SelectField } from '../../../components/ui/SelectField'
import { TextField } from '../../../components/ui/TextField'
import { listarExistencias } from '../api'
import type { Existencia, FiltrosExistencias } from '../types'

type Tri = '' | 'true' | 'false'

const ETIQUETA_UNIDAD = { unidad: 'unidad', kg: 'kg', litro: 'litro' } as const

export function ListaExistencias() {
  const [page, setPage] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [categoriaTexto, setCategoriaTexto] = useState('')
  const [estado, setEstado] = useState<Tri>('')
  const [bajo, setBajo] = useState<Tri>('')
  const [errorCategoria, setErrorCategoria] = useState<string[]>([])
  const [filtros, setFiltros] = useState<FiltrosExistencias>({})

  const cargar = useCallback(
    ({ negocioId, signal }: ContextoConsulta): Promise<Pagina<Existencia> | null> =>
      negocioId === null ? Promise.resolve(null) : listarExistencias(negocioId, { page, signal, ...filtros }),
    [page, filtros],
  )
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const f: FiltrosExistencias = {}
    const s = busqueda.trim()
    if (s) f.search = s
    const c = categoriaTexto.trim()
    if (c) {
      if (!/^[1-9]\d*$/.test(c) || !Number.isSafeInteger(Number(c))) { setErrorCategoria(['Usa un ID entero positivo válido.']); return }
      f.categoria_id = Number(c)
    }
    setErrorCategoria([])
    if (estado) f.activo = estado === 'true'
    if (bajo) f.bajo_minimo = bajo === 'true'
    setFiltros(f)
    setPage(1)
  }

  return (
    <>
      <form onSubmit={aplicar} role="search" aria-label="Filtrar existencias">
        <TextField label="Buscar por nombre o SKU" name="search" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} maxLength={150} autoComplete="off" />
        <TextField label="ID de categoría" name="categoria_id" inputMode="numeric" value={categoriaTexto}
          onChange={(e) => setCategoriaTexto(e.target.value)} errors={errorCategoria} autoComplete="off" />
        <SelectField label="Estado del producto" name="activo" value={estado}
          onChange={(e) => setEstado(e.target.value as Tri)}>
          <option value="">Todos</option>
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
        </SelectField>
        <SelectField label="Stock" name="bajo_minimo" value={bajo}
          onChange={(e) => setBajo(e.target.value as Tri)}>
          <option value="">Todos</option>
          <option value="true">Bajo el mínimo</option>
          <option value="false">En o sobre el mínimo</option>
        </SelectField>
        <Button type="submit">Filtrar</Button>
      </form>

      <PaginatedTable
        title="Existencias del negocio activo"
        loadingLabel="Cargando existencias…"
        emptyTitle="No hay existencias"
        page={page}
        pagina={data}
        pending={pending}
        error={error}
        onPage={setPage}
        onRetry={reintentar}
        rowKey={(e) => e.id}
        columns={[
          { key: 'producto', header: 'Producto', render: (e) => e.producto.nombre },
          { key: 'sku', header: 'SKU', render: (e) => e.producto.sku },
          { key: 'categoria', header: 'Categoría', render: (e) => e.producto.categoria_nombre },
          { key: 'saldo', header: 'Saldo', render: (e) => `${e.cantidad} ${ETIQUETA_UNIDAD[e.producto.unidad]}` },
          { key: 'minimo', header: 'Mínimo', render: (e) => `${e.stock_minimo} ${ETIQUETA_UNIDAD[e.producto.unidad]}` },
          { key: 'bajo', header: 'Alerta', render: (e) => (e.bajo_minimo ? <strong>Bajo el mínimo</strong> : 'Normal') },
          { key: 'estado', header: 'Estado', render: (e) => (e.producto.activo ? 'Activo' : 'Inactivo') },
        ]}
      />
    </>
  )
}

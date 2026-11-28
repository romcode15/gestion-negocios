import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiException } from '../../../../api/errors'
import { usePermiso, useSesion } from '../../../../app/providers/SessionContext'
import { useConsultaContexto } from '../../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../../app/providers/useConsultaContexto'
import { Button } from '../../../../components/ui/Button'
import type { TableColumn } from '../../../../components/ui/DataTable'
import { PaginatedTable } from '../../../../components/ui/PaginatedTable'
import { SelectField } from '../../../../components/ui/SelectField'
import { TextField } from '../../../../components/ui/TextField'
import { listarVentas } from '../../api'
import type { EstadoVenta, FiltrosVentas, VentaResumen } from '../../types'
import type { ListaVentasProps } from '../shared/contracts'

type FiltrosForm = { search: string; estado: '' | EstadoVenta; desde: string; hasta: string }
type Errores = Partial<Record<keyof FiltrosForm, string>>

const VACIOS: FiltrosForm = { search: '', estado: '', desde: '', hasta: '' }
const ESTADOS: EstadoVenta[] = ['confirmada', 'anulada']
const DIA = 86_400_000

// Los campos de fecha son días civiles. El contrato exige ISO 8601 con zona:
// `desde` es el inicio del día (inclusivo) y `hasta` el del día siguiente
// (exclusivo), de modo que el día indicado se incluye completo.
function inicioUtc(fecha: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const tiempo = Date.parse(fecha + 'T00:00:00Z')
  if (!Number.isFinite(tiempo) || new Date(tiempo).toISOString().slice(0, 10) !== fecha) return null
  return fecha + 'T00:00:00Z'
}
function finExclusivoUtc(fecha: string): string | null {
  const inicio = inicioUtc(fecha)
  return inicio === null ? null : new Date(Date.parse(inicio) + DIA).toISOString().slice(0, 10) + 'T00:00:00Z'
}
function formatearFecha(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}
function validar(filtros: FiltrosForm): { errores: Errores; aplicados: FiltrosVentas } {
  const errores: Errores = {}
  const aplicados: FiltrosVentas = {}
  const search = filtros.search.trim()
  if (search.length > 150) errores.search = 'El texto no puede superar 150 caracteres.'
  else if (search) aplicados.search = search
  if (filtros.estado) {
    if (!ESTADOS.includes(filtros.estado)) errores.estado = 'Estado inválido.'
    else aplicados.estado = filtros.estado
  }
  const desde = inicioUtc(filtros.desde)
  if (filtros.desde && desde === null) errores.desde = 'Usa una fecha válida.'
  else if (desde) aplicados.desde = desde
  const hasta = finExclusivoUtc(filtros.hasta)
  if (filtros.hasta && hasta === null) errores.hasta = 'Usa una fecha válida.'
  else if (hasta) aplicados.hasta = hasta
  if (aplicados.desde && aplicados.hasta && aplicados.desde >= aplicados.hasta) {
    errores.hasta = 'Hasta debe ser posterior a desde.'
  }
  return { errores, aplicados }
}

export function ListaVentas({ seleccionadoId, refreshKey, onSeleccionar }: ListaVentasProps<VentaResumen>) {
  const { negocioId, sesion, revision } = useSesion()
  const puedeListar = usePermiso('listar_ventas')
  const [filtros, setFiltros] = useState<FiltrosForm>({ ...VACIOS })
  const [aplicados, setAplicados] = useState<FiltrosVentas>({})
  const [errores, setErrores] = useState<Errores>({})
  const [page, setPage] = useState(1)

  // Solo se consulta el listado; nunca opciones, productos ni existencias.
  const cargar = useCallback(async ({ signal }: ContextoConsulta) => {
    if (negocioId === null || !puedeListar) return null
    try {
      return await listarVentas(negocioId, { ...aplicados, page, signal })
    } catch (error) {
      // Una anulación o un filtro más estrecho puede dejar la página actual
      // fuera de rango: se recupera la primera sin descartar los filtros.
      if (!signal.aborted && error instanceof ApiException && error.status === 404 && page > 1) setPage(1)
      throw error
    }
  }, [negocioId, puedeListar, aplicados, page])
  const consulta = useConsultaContexto(cargar, refreshKey)

  // Cambiar de negocio o de sesión limpia selección local y filtros, y el store
  // ya descarta las respuestas pendientes mediante `revision`.
  const contexto = revision + ':' + negocioId + ':' + (sesion?.usuario.id ?? '')
  const contextoAnterior = useRef(contexto)
  useEffect(() => {
    if (contextoAnterior.current === contexto) return
    contextoAnterior.current = contexto
    setFiltros({ ...VACIOS })
    setAplicados({})
    setErrores({})
    setPage(1)
  }, [contexto])

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const resultado = validar(filtros)
    setErrores(resultado.errores)
    if (Object.keys(resultado.errores).length) return
    setAplicados({ ...resultado.aplicados })
    setPage(1)
  }

  function limpiar() {
    setFiltros({ ...VACIOS })
    setAplicados({})
    setErrores({})
    setPage(1)
  }

  function cambiar(campo: keyof FiltrosForm, valor: string) {
    setFiltros((anterior) => ({ ...anterior, [campo]: valor }))
    if (errores[campo]) setErrores((anterior) => ({ ...anterior, [campo]: undefined }))
  }

  const columnas: TableColumn<VentaResumen>[] = [
    { key: 'id', header: 'ID', render: (venta) => (
      <button type="button" aria-pressed={seleccionadoId === venta.id}
        aria-label={'Abrir detalle de la venta ' + venta.id} onClick={() => onSeleccionar(venta)}>
        {venta.id}
      </button>
    ) },
    { key: 'fecha', header: 'Fecha', render: (venta) => <time dateTime={venta.creado_en}>{formatearFecha(venta.creado_en)}</time> },
    { key: 'vendedor', header: 'Vendedor', render: (venta) => venta.vendedor.username },
    { key: 'estado', header: 'Estado', render: (venta) => venta.estado },
    { key: 'total', header: 'Total', render: (venta) => venta.total },
  ]

  if (!puedeListar) return <p role="note">El listado de ventas requiere el permiso listar_ventas.</p>

  return <>
    <form onSubmit={aplicar} role="search" aria-label="Filtrar ventas">
      <h2>Filtros de ventas</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0 14px' }}>
        <TextField id="ventas-search" name="search" label="Buscar en observaciones, nombre o SKU"
          value={filtros.search} maxLength={150} autoComplete="off"
          errors={errores.search ? [errores.search] : undefined}
          onChange={(evento) => cambiar('search', evento.target.value)} />
        <SelectField id="ventas-estado" name="estado" label="Estado" value={filtros.estado}
          errors={errores.estado ? [errores.estado] : undefined}
          onChange={(evento) => cambiar('estado', evento.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((estado) => <option key={estado} value={estado}>{estado}</option>)}
        </SelectField>
        <TextField id="ventas-desde" name="desde" label="Desde" type="date" value={filtros.desde}
          errors={errores.desde ? [errores.desde] : undefined}
          onChange={(evento) => cambiar('desde', evento.target.value)} />
        <TextField id="ventas-hasta" name="hasta" label="Hasta" type="date" value={filtros.hasta}
          hint="El límite superior es exclusivo: se incluye el día completo indicado."
          errors={errores.hasta ? [errores.hasta] : undefined}
          onChange={(evento) => cambiar('hasta', evento.target.value)} />
      </div>
      <div className="filtros-acciones">
        <Button type="submit">Aplicar filtros</Button>
        <Button type="button" onClick={limpiar}>Limpiar filtros</Button>
      </div>
    </form>
    <PaginatedTable
      title="Listado de ventas"
      loadingLabel="Cargando ventas…"
      emptyTitle="No hay ventas con estos filtros"
      page={page}
      pagina={consulta.data}
      pending={consulta.pending}
      error={consulta.error}
      onPage={setPage}
      onRetry={consulta.reintentar}
      columns={columnas}
      rowKey={(venta) => venta.id}
    />
  </>
}

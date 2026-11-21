import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSesion } from '../../../app/providers/SessionContext'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { Button } from '../../../components/ui/Button'
import type { TableColumn } from '../../../components/ui/DataTable'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import { SelectField } from '../../../components/ui/SelectField'
import { TextField } from '../../../components/ui/TextField'
import { listarMovimientos } from '../api'
import type { Movimiento, TipoMovimiento } from '../types'
import { EVENTO_HISTORIAL_ACTUALIZADO } from './eventos'

type Filtros = { producto_id: string; tipo: string; search: string; desde: string; hasta: string }
type Aplicados = { producto_id?: number; tipo?: TipoMovimiento; search?: string; desde?: string; hasta?: string }
type Errores = Partial<Record<keyof Filtros, string>>

const VACIOS: Filtros = { producto_id: '', tipo: '', search: '', desde: '', hasta: '' }
const TIPOS: TipoMovimiento[] = ['entrada', 'salida', 'ajuste']
const DIA = 86_400_000

// Las fechas de entrada son días civiles; el contrato exige ISO 8601 con zona.
// `desde` es el inicio del día (inclusivo) y `hasta` el inicio del día siguiente (exclusivo).
function inicioUtc(fecha: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const tiempo = Date.parse(fecha + 'T00:00:00Z')
  if (!Number.isFinite(tiempo)) return null
  if (new Date(tiempo).toISOString().slice(0, 10) !== fecha) return null
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
function delta(valor: string): string {
  return valor.startsWith('-') || /^0(?:\.0+)?$/.test(valor) ? valor : '+' + valor
}
function validar(filtros: Filtros): { errores: Errores; aplicados: Aplicados } {
  const errores: Errores = {}
  const aplicados: Aplicados = {}
  const id = filtros.producto_id.trim()
  if (id) {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) errores.producto_id = 'Usa un ID entero positivo.'
    else aplicados.producto_id = Number(id)
  }
  if (filtros.tipo) {
    if (!TIPOS.includes(filtros.tipo as TipoMovimiento)) errores.tipo = 'Tipo inválido.'
    else aplicados.tipo = filtros.tipo as TipoMovimiento
  }
  const search = filtros.search.trim()
  if (search.length > 150) errores.search = 'El texto no puede superar 150 caracteres.'
  else if (search) aplicados.search = search
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

const COLUMNAS: TableColumn<Movimiento>[] = [
  { key: 'fecha', header: 'Fecha', render: (m) => <time dateTime={m.creado_en}>{formatearFecha(m.creado_en)}</time> },
  { key: 'tipo', header: 'Tipo', render: (m) => m.tipo },
  { key: 'producto', header: 'Producto', render: (m) => m.producto.nombre },
  { key: 'sku', header: 'SKU', render: (m) => m.producto.sku },
  { key: 'unidad', header: 'Unidad', render: (m) => m.producto.unidad },
  { key: 'delta', header: 'Delta', render: (m) => <strong>{delta(m.cantidad)}</strong> },
  { key: 'anterior', header: 'Saldo anterior', render: (m) => m.saldo_anterior },
  { key: 'posterior', header: 'Saldo posterior', render: (m) => m.saldo_posterior },
  { key: 'actor', header: 'Actor', render: (m) => m.usuario.username },
  { key: 'motivo', header: 'Motivo', render: (m) => m.motivo },
]

export function HistorialMovimientos() {
  const { negocioId } = useSesion()
  const [filtros, setFiltros] = useState<Filtros>(VACIOS)
  const [aplicados, setAplicados] = useState<Aplicados>({})
  const [errores, setErrores] = useState<Errores>({})
  const [page, setPage] = useState(1)

  // Solo se consulta el historial; nunca productos/opciones ni existencias.
  const cargar = useCallback(({ signal }: ContextoConsulta) => {
    if (negocioId === null) return Promise.resolve(null)
    return listarMovimientos(negocioId, { ...aplicados, page, signal })
  }, [negocioId, aplicados, page])
  const consulta = useConsultaContexto(cargar)

  // Un cambio de negocio descarta filtros, página y cualquier respuesta pendiente.
  const negocioAnterior = useRef(negocioId)
  useEffect(() => {
    if (negocioAnterior.current === negocioId) return
    negocioAnterior.current = negocioId
    setFiltros({ ...VACIOS })
    setAplicados({})
    setErrores({})
    setPage(1)
  }, [negocioId])

  // Las escrituras avisan mediante un evento local; se recarga solo si este
  // componente está montado, lo que ya implica permiso de listar_movimientos.
  const recargar = useRef(consulta.reintentar)
  const negocioActual = useRef(negocioId)
  useEffect(() => {
    recargar.current = consulta.reintentar
    negocioActual.current = negocioId
  })
  useEffect(() => {
    function alActualizar(evento: Event) {
      const detalle = (evento as CustomEvent<{ negocioId: number }>).detail
      if (detalle && detalle.negocioId === negocioActual.current) recargar.current()
    }
    window.addEventListener(EVENTO_HISTORIAL_ACTUALIZADO, alActualizar)
    return () => window.removeEventListener(EVENTO_HISTORIAL_ACTUALIZADO, alActualizar)
  }, [])

  // El sugerido de producto usa únicamente resúmenes ya recibidos en la página.
  const conocidos = useMemo(() => {
    const vistos = new Map<number, Movimiento['producto']>()
    for (const movimiento of consulta.data?.results ?? []) vistos.set(movimiento.producto.id, movimiento.producto)
    return [...vistos.values()]
  }, [consulta.data])

  function aplicar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const resultado = validar(filtros)
    setErrores(resultado.errores)
    if (Object.keys(resultado.errores).length) return
    setAplicados(resultado.aplicados)
    setPage(1)
  }

  function limpiar() {
    setFiltros({ ...VACIOS })
    setAplicados({})
    setErrores({})
    setPage(1)
  }

  function cambiar(campo: keyof Filtros, valor: string) {
    setFiltros((anterior) => ({ ...anterior, [campo]: valor }))
    if (errores[campo]) setErrores((anterior) => ({ ...anterior, [campo]: undefined }))
  }

  return <>
    <form onSubmit={aplicar} aria-label="Filtros del historial">
      <h2>Filtros del historial</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0 14px' }}>
        <TextField id="historial-producto" name="producto_id" label="ID de producto" inputMode="numeric"
          value={filtros.producto_id} list="historial-productos-conocidos"
          hint="Escribe un ID conocido o elige uno de los resúmenes ya visibles; también puedes buscar por nombre o SKU."
          errors={errores.producto_id ? [errores.producto_id] : undefined}
          onChange={(event) => cambiar('producto_id', event.target.value)} />
        <datalist id="historial-productos-conocidos">
          {conocidos.map((producto) => <option key={producto.id} value={producto.id}>{producto.sku} — {producto.nombre}</option>)}
        </datalist>
        <SelectField id="historial-tipo" name="tipo" label="Tipo" value={filtros.tipo}
          errors={errores.tipo ? [errores.tipo] : undefined}
          onChange={(event) => cambiar('tipo', event.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
        </SelectField>
        <TextField id="historial-search" name="search" label="Buscar por nombre o SKU"
          value={filtros.search} maxLength={150}
          errors={errores.search ? [errores.search] : undefined}
          onChange={(event) => cambiar('search', event.target.value)} />
        <TextField id="historial-desde" name="desde" label="Desde" type="date" value={filtros.desde}
          errors={errores.desde ? [errores.desde] : undefined}
          onChange={(event) => cambiar('desde', event.target.value)} />
        <TextField id="historial-hasta" name="hasta" label="Hasta" type="date" value={filtros.hasta}
          hint="El límite superior es exclusivo: se incluye el día completo indicado."
          errors={errores.hasta ? [errores.hasta] : undefined}
          onChange={(event) => cambiar('hasta', event.target.value)} />
      </div>
      <div className="filtros-acciones">
        <Button type="submit">Aplicar filtros</Button>
        <Button type="button" onClick={limpiar}>Limpiar filtros</Button>
      </div>
    </form>
    <PaginatedTable
      title="Historial de movimientos"
      loadingLabel="Cargando historial de movimientos…"
      emptyTitle="No hay movimientos con estos filtros"
      page={page}
      pagina={consulta.data}
      pending={consulta.pending}
      error={consulta.error}
      onPage={setPage}
      onRetry={consulta.reintentar}
      columns={COLUMNAS}
      rowKey={(movimiento) => movimiento.id}
    />
  </>
}

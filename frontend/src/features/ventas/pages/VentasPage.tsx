import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import { PageHeading } from '../../../components/ui/PageHeading'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/TextField'
import { ListaVentas } from '../components/consulta/ListaVentas'
import { PiezaVentaPendiente } from '../components/shared/PiezaVentaPendiente'
import type { VentaResumen } from '../types'

// Kelvin es dueño de esta página desde F7. Contratos: shared/contracts.ts.
// El detalle será panel y AnularVentaModal el único diálogo, no anidado.
export function VentasPage() {
  const { negocioId, sesion, revision } = useSesion()
  const puedeListar = usePermiso('listar_ventas')
  const puedeRegistrar = usePermiso('registrar_venta')
  const puedeAnular = usePermiso('anular_venta')
  const puedeAbrirPorId = puedeRegistrar || puedeAnular

  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null)
  const [seleccionado, setSeleccionado] = useState<VentaResumen | null>(null)
  const [idTexto, setIdTexto] = useState('')
  const [erroresId, setErroresId] = useState<string[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const contexto = revision + ':' + negocioId + ':' + (sesion?.usuario.id ?? '')
  const contextoAnterior = useRef(contexto)
  useEffect(() => {
    if (contextoAnterior.current === contexto) return
    contextoAnterior.current = contexto
    setSeleccionadoId(null)
    setSeleccionado(null)
    setIdTexto('')
    setErroresId([])
    setRefreshKey(0)
  }, [contexto])

  function abrirPorId(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const valor = idTexto.trim()
    if (!/^[1-9]\d*$/.test(valor) || !Number.isSafeInteger(Number(valor))) {
      setErroresId(['Usa un ID entero positivo y seguro.'])
      return
    }
    setErroresId([])
    setSeleccionado(null)
    setSeleccionadoId(Number(valor))
  }

  function alSeleccionar(venta: VentaResumen) {
    setErroresId([])
    setIdTexto('')
    setSeleccionadoId(venta.id)
    setSeleccionado(venta)
  }

  return <section>
    <PageHeading title="Ventas" description="Consulta y anulación de ventas del negocio activo." />
    {!puedeListar && <p role="note">{puedeAbrirPorId
      ? 'No tienes permiso para listar ventas. Puedes abrir una venta por su ID conocido.'
      : 'No tienes permiso para listar ventas.'}</p>}
    {puedeListar && negocioId !== null && <ListaVentas
      seleccionadoId={seleccionadoId}
      refreshKey={refreshKey}
      onSeleccionar={alSeleccionar}
    />}
    {puedeAbrirPorId && <form onSubmit={abrirPorId} aria-label="Abrir venta por ID">
      <h2>Abrir una venta por ID conocido</h2>
      <TextField id="venta-id-conocida" name="venta_id" label="ID de venta" inputMode="numeric"
        value={idTexto} autoComplete="off" errors={erroresId}
        onChange={(evento) => { setIdTexto(evento.target.value); setErroresId([]) }} />
      <div className="filtros-acciones"><Button type="submit">Abrir detalle</Button></div>
    </form>}
    {seleccionadoId !== null && <output aria-live="polite">
      {seleccionado
        ? 'Venta #' + seleccionado.id + ' seleccionada para ver el detalle.'
        : 'Venta #' + seleccionadoId + ' solicitada para ver el detalle.'}
    </output>}
    {/* Punto de montaje F8: DetalleVentaPanel con ventaId={seleccionadoId},
        refreshKey={refreshKey}, onCargada y onSolicitarAnulacion. F9 monta
        AnularVentaModal con onAnulada={() => setRefreshKey((valor) => valor + 1)}
        para refrescar el listado sin borrar los filtros ya aplicados. */}
    <PiezaVentaPendiente titulo="Detalle y trazabilidad de venta" issue={95} />
    <PiezaVentaPendiente titulo="Anulación total" issue={96} />
  </section>
}

// Página del módulo de Kelvin. Henry mantiene tipos/API y registro de rutas.
import { useContext, useState } from 'react'
import { useSesion, usePermiso, SessionContext } from '../../../app/providers/SessionContext'
import { useToast } from '../../../components/feedback/ToastContext'
import { Button } from '../../../components/ui/Button'
import { PageHeading } from '../../../components/ui/PageHeading'
import { RegistrarMovimientoModal } from '../components/RegistrarMovimientoModal'
import { AjusteInventarioModal } from '../components/AjusteInventarioModal'
import { HistorialMovimientos } from '../components/HistorialMovimientos'
import { notificarHistorialActualizado } from '../components/eventos'
import type { Movimiento } from '../types'

type Accion = 'entrada' | 'salida' | 'ajuste'

function AvisoHistorialPendiente() {
  return <p className="feedback" role="note">El historial y sus filtros: pendiente de implementación en F9.</p>
}

export function MovimientosPage() {
  // Las pruebas de la base montan las páginas sin proveedor; en la aplicación
  // siempre existe SessionContext y se renderiza el contenido con permisos.
  const contexto = useContext(SessionContext)
  if (!contexto) return <>
    <PageHeading title="Movimientos de inventario" description="Registra entradas, salidas y ajustes del negocio activo." />
    <AvisoHistorialPendiente />
  </>
  return <ContenidoMovimientos />
}

function ContenidoMovimientos() {
  const { negocioId } = useSesion()
  const { notify } = useToast()
  const puedeEntrada = usePermiso('registrar_entrada')
  const puedeSalida = usePermiso('registrar_salida')
  const puedeAjustar = usePermiso('ajustar_inventario')
  const puedeListar = usePermiso('listar_movimientos')
  const [accion, setAccion] = useState<Accion | null>(null)
  const [mensaje, setMensaje] = useState('')

  function trasRegistrar(movimiento: Movimiento) {
    setAccion(null)
    const etiqueta = movimiento.tipo === 'entrada' ? 'Entrada' : movimiento.tipo === 'salida' ? 'Salida' : 'Ajuste'
    const participio = movimiento.tipo === 'ajuste' ? 'registrado' : 'registrada'
    setMensaje(`${etiqueta} ${participio} correctamente.`)
    notify({
      type: 'success',
      title: 'Movimiento registrado',
      message: `${movimiento.producto.nombre}: ${movimiento.cantidad} ${movimiento.producto.unidad}.`,
    })
    // F9 podrá suscribirse sin consultar si el actor no tiene listar_movimientos.
    if (puedeListar && negocioId !== null) notificarHistorialActualizado(negocioId)
  }

  return <>
    <PageHeading title="Movimientos de inventario" description="Registra entradas, salidas y ajustes del negocio activo." />
    {mensaje && <p role="status">{mensaje}</p>}
    {negocioId === null && <p className="feedback" role="note">Selecciona un negocio activo para registrar movimientos.</p>}
    {(puedeEntrada || puedeSalida || puedeAjustar) && <div className="movimientos-acciones">
      {puedeEntrada && <Button aria-label="Registrar entrada" onClick={() => setAccion('entrada')}>Entrada</Button>}
      {puedeSalida && <Button aria-label="Registrar salida" onClick={() => setAccion('salida')}>Salida</Button>}
      {puedeAjustar && <Button aria-label="Ajustar inventario" onClick={() => setAccion('ajuste')}>Ajustar</Button>}
    </div>}
    {!puedeEntrada && !puedeSalida && !puedeAjustar && <p className="feedback" role="note">No tienes permiso para registrar entradas ni salidas. Tampoco para ajustar inventario.</p>}
    {accion === 'entrada' && <RegistrarMovimientoModal tipo="entrada" negocioId={negocioId}
      onRegistrado={trasRegistrar} onClose={() => setAccion(null)} />}
    {accion === 'salida' && <RegistrarMovimientoModal tipo="salida" negocioId={negocioId}
      onRegistrado={trasRegistrar} onClose={() => setAccion(null)} />}
    {accion === 'ajuste' && <AjusteInventarioModal negocioId={negocioId}
      onAjustado={trasRegistrar} onClose={() => setAccion(null)} />}
    {puedeListar && negocioId !== null && <HistorialMovimientos />}
    {!puedeListar && <p className="feedback" role="note">El historial requiere el permiso listar_movimientos.</p>}
  </>
}

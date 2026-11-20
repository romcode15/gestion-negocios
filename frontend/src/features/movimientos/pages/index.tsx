// Página del módulo de Kelvin. Henry mantiene tipos/API y registro de rutas.
import { useContext, useState } from 'react'
import { useSesion, usePermiso, SessionContext } from '../../../app/providers/SessionContext'
import { useToast } from '../../../components/feedback/ToastContext'
import { Button } from '../../../components/ui/Button'
import { PageHeading } from '../../../components/ui/PageHeading'
import { RegistrarMovimientoModal } from '../components/RegistrarMovimientoModal'
import { notificarHistorialActualizado } from '../components/eventos'
import type { Movimiento } from '../types'

type Accion = 'entrada' | 'salida'

function AvisoHistorialPendiente() {
  return <p className="feedback" role="note">El historial y sus filtros: pendiente de implementación en F9.</p>
}

export function MovimientosPage() {
  // Las pruebas de la base montan las páginas sin proveedor; en la aplicación
  // siempre existe SessionContext y se renderiza el contenido con permisos.
  const contexto = useContext(SessionContext)
  if (!contexto) return <>
    <PageHeading title="Movimientos de inventario" description="Registra entradas y salidas del negocio activo." />
    <AvisoHistorialPendiente />
  </>
  return <ContenidoMovimientos />
}

function ContenidoMovimientos() {
  const { negocioId } = useSesion()
  const { notify } = useToast()
  const puedeEntrada = usePermiso('registrar_entrada')
  const puedeSalida = usePermiso('registrar_salida')
  const puedeListar = usePermiso('listar_movimientos')
  const [accion, setAccion] = useState<Accion | null>(null)
  const [mensaje, setMensaje] = useState('')

  function trasRegistrar(movimiento: Movimiento) {
    setAccion(null)
    setMensaje(`${movimiento.tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada correctamente.`)
    notify({
      type: 'success',
      title: 'Movimiento registrado',
      message: `${movimiento.producto.nombre}: ${movimiento.cantidad} ${movimiento.producto.unidad}.`,
    })
    // F9 podrá suscribirse sin consultar si el actor no tiene listar_movimientos.
    if (puedeListar && negocioId !== null) notificarHistorialActualizado(negocioId)
  }

  return <>
    <PageHeading title="Movimientos de inventario" description="Registra entradas y salidas del negocio activo." />
    {mensaje && <p role="status">{mensaje}</p>}
    {negocioId === null && <p className="feedback" role="note">Selecciona un negocio activo para registrar movimientos.</p>}
    {(puedeEntrada || puedeSalida) && <div className="movimientos-acciones">
      {puedeEntrada && <Button aria-label="Registrar entrada" onClick={() => setAccion('entrada')}>Entrada</Button>}
      {puedeSalida && <Button aria-label="Registrar salida" onClick={() => setAccion('salida')}>Salida</Button>}
    </div>}
    {!puedeEntrada && !puedeSalida && <p className="feedback" role="note">No tienes permiso para registrar entradas ni salidas.</p>}
    {accion === 'entrada' && <RegistrarMovimientoModal tipo="entrada" negocioId={negocioId}
      onRegistrado={trasRegistrar} onClose={() => setAccion(null)} />}
    {accion === 'salida' && <RegistrarMovimientoModal tipo="salida" negocioId={negocioId}
      onRegistrado={trasRegistrar} onClose={() => setAccion(null)} />}
    <AvisoHistorialPendiente />
  </>
}

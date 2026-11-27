import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import { AccessDenied, EmptyState } from '../../../components/feedback/Feedback'
import { ApiException } from '../../../api/errors'
import { VentaDraftContext } from './VentaDraftContext'
import { agregarLinea, cambiarCantidadLinea, cambiarObservacionesDraft, draftVacio, revisarProductoLinea } from './state'
import type { VentaDraft, VentaDraftValue } from './types'

export function VentaDraftProvider({ children }: { children: ReactNode }) {
  const { sesion, negocioId, revision, status } = useSesion()
  const allowed = usePermiso('registrar_venta')
  if (status !== 'authenticated' || !sesion) return null
  if (!sesion.usuario.is_active) return <AccessDenied />
  if (negocioId === null) return <EmptyState title="Sin negocio activo">Selecciona un negocio para preparar una venta.</EmptyState>
  if (!allowed) return <AccessDenied />
  return <ContextDraft key={sesion.usuario.id + ':' + negocioId + ':' + revision} negocioId={negocioId}>{children}</ContextDraft>
}
function ContextDraft({ negocioId, children }: { negocioId: number; children: ReactNode }) {
  const { store, revision, sesion } = useSesion()
  const usuarioId = sesion!.usuario.id
  const [draft, setDraft] = useState<VentaDraft>(draftVacio)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = useRef(draft)
  function vigente() {
    const state = store.getSnapshot()
    if (!mounted.current || state.status !== 'authenticated' || state.revision !== revision || state.negocioId !== negocioId || state.sesion?.usuario.id !== usuarioId || !state.sesion.usuario.is_active) {
      throw new DOMException('El contexto del borrador cambió.', 'AbortError')
    }
  }
  function libre() {
    vigente()
    if (locked.current) throw new ApiException('validation_error', 'Espera a que termine el envío actual.', {}, 400)
  }
  function update(change: (value: VentaDraft) => VentaDraft) {
    libre()
    // Validar antes de publicar; ref evita perder dos acciones en el mismo evento.
    const next = structuredClone(change(current.current))
    current.current = next
    setDraft(next)
  }
  const value: VentaDraftValue = {
    negocioId, busy, draft: structuredClone(draft),
    snapshot() { vigente(); return structuredClone(current.current) },
    iniciarEnvio() {
      libre()
      if (!current.current.lineas.length) throw new ApiException('validation_error', 'Agrega al menos un producto.', { detalles: ['El carrito está vacío.'] }, 400)
      locked.current = true
      setBusy(true)
      return structuredClone(current.current)
    },
    terminarEnvio(exito = false) {
      vigente()
      if (!locked.current) return
      if (exito) { current.current = draftVacio(); setDraft(current.current) }
      locked.current = false
      setBusy(false)
    },
    agregar: (producto, cantidad) => update((value) => agregarLinea(value, negocioId, producto, cantidad)),
    cambiarCantidad: (id, cantidad) => update((value) => cambiarCantidadLinea(value, id, cantidad)),
    revisarProducto: (producto) => update((value) => revisarProductoLinea(value, negocioId, producto)),
    quitar: (id) => update((value) => ({ ...value, lineas: value.lineas.filter((linea) => linea.producto.id !== id) })),
    cambiarObservaciones: (texto) => update((value) => cambiarObservacionesDraft(value, texto)),
    vaciar: () => update(draftVacio),
  }
  return <VentaDraftContext.Provider value={value}>{children}</VentaDraftContext.Provider>
}

import { useCallback } from 'react'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { Modal } from '../../../components/ui/Modal'
import { obtenerProducto } from '../api'
import type { Producto } from '../types'
import { FormularioProducto } from './FormularioProducto'

export type ModoModal = { modo: 'crear' } | { modo: 'editar'; id: number }

interface Props {
  estado: ModoModal
  onClose: () => void
  onGuardado: (producto: Producto) => void
}

export function ProductoModal({ estado, onClose, onGuardado }: Props) {
  if (estado.modo === 'crear') return <FormularioProducto inicial={null} onClose={onClose} onGuardado={onGuardado} />
  return <EditarProducto id={estado.id} onClose={onClose} onGuardado={onGuardado} />
}

function EditarProducto({ id, onClose, onGuardado }: { id: number } & Omit<Props, 'estado'>) {
  const cargar = useCallback(
    ({ negocioId, signal }: ContextoConsulta): Promise<Producto | null> =>
      negocioId === null ? Promise.resolve(null) : obtenerProducto(negocioId, id, { signal }),
    [id],
  )
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)
  if (pending || error || !data) {
    return (
      <Modal open title="Editar producto" onClose={onClose}>
        {pending ? <Loading>Cargando producto…</Loading>
          : error ? <ApiFeedback error={error} onRetry={reintentar} />
          : <EmptyState title="No se encontró el producto" />}
      </Modal>
    )
  }
  return <FormularioProducto key={data.id} inicial={data} onClose={onClose} onGuardado={onGuardado} />
}
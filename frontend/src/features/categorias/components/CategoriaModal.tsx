import { useCallback } from 'react'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Modal } from '../../../components/ui/Modal'
import { obtenerCategoria } from '../api'
import type { Categoria } from '../types'
import { FormularioCategoria } from './FormularioCategoria'

export type ModoModal = { modo: 'crear' } | { modo: 'editar'; id: number }

interface Props {
  estado: ModoModal
  onClose: () => void
  onGuardado: (categoria: Categoria) => void
}

export function CategoriaModal({ estado, onClose, onGuardado }: Props) {
  if (estado.modo === 'crear') {
    return <FormularioCategoria inicial={null} onClose={onClose} onGuardado={onGuardado} />
  }
  return <EditarCategoria id={estado.id} onClose={onClose} onGuardado={onGuardado} />
}

function EditarCategoria({ id, onClose, onGuardado }: { id: number } & Omit<Props, 'estado'>) {
  const cargar = useCallback(
    ({ negocioId, signal }: ContextoConsulta): Promise<Categoria | null> =>
      negocioId === null ? Promise.resolve(null) : obtenerCategoria(negocioId, id, { signal }),
    [id],
  )
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)

  if (pending || error || !data) {
    return (
      <Modal open title="Editar categoría" onClose={onClose}>
        {pending ? <Loading>Cargando categoría…</Loading>
          : error ? <ApiFeedback error={error} onRetry={reintentar} />
          : <EmptyState title="No se encontró la categoría" />}
      </Modal>
    )
  }
  return <FormularioCategoria key={data.id} inicial={data} onClose={onClose} onGuardado={onGuardado} />
}
import { useCallback, useState } from 'react'
import { usePermiso } from '../../../app/providers/SessionContext'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { ErrorMessage } from '../../../components/feedback/Feedback'
import { listarNegocios } from '../api'
import { CrearNegocioForm } from '../components/CrearNegocioForm'
import { ListaNegocios } from '../components/ListaNegocios'

export function NegociosPage() {
  const puedeCrear = usePermiso('crear_negocio', 'plataforma')
  const [page, setPage] = useState(1)
  const cargar = useCallback(({ signal }: ContextoConsulta) => listarNegocios({ page, signal }), [page])
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)

  function trasCrear() {
    setPage(1)
    reintentar()
  }

  return <>
    <ListaNegocios page={page} pagina={data} pendiente={pending} error={error}
      onPagina={setPage} onReintentar={reintentar} />
    {puedeCrear
      ? <CrearNegocioForm onCreado={trasCrear} />
      : <ErrorMessage>No tienes permiso para crear negocios.</ErrorMessage>}
  </>
}

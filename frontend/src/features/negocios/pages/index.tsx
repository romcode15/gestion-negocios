import { useCallback, useState } from 'react'
import { usePermiso } from '../../../app/providers/SessionContext'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { ErrorMessage } from '../../../components/feedback/Feedback'
import { CrearUsuarioForm } from '../../usuarios/components/CrearUsuarioForm'
import { ListaUsuarios } from '../../usuarios/components/ListaUsuarios'
import { listarNegocios } from '../api'
import { CrearNegocioForm } from '../components/CrearNegocioForm'
import { ListaNegocios } from '../components/ListaNegocios'

function NegociosRegistrados({ refresh }: { refresh: number }) {
  const [page, setPage] = useState(1)
  const cargar = useCallback(({ signal }: ContextoConsulta) => {
    void refresh
    return listarNegocios({ page, signal })
  }, [page, refresh])
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)
  return <ListaNegocios page={page} pagina={data} pendiente={pending} error={error}
    onPagina={setPage} onReintentar={reintentar} />
}
export function NegociosPage() {
  const puedeListar = usePermiso('listar_negocios', 'plataforma')
  const puedeCrear = usePermiso('crear_negocio', 'plataforma')
  const puedeListarUsuarios = usePermiso('listar_usuarios', 'plataforma')
  const puedeCrearUsuario = usePermiso('crear_usuario', 'plataforma')
  const [refresh, setRefresh] = useState(0)
  function trasCrear() { setRefresh((version) => version + 1) }
  return <>
    <h1>Panel de plataforma</h1>
    {puedeListar ? <NegociosRegistrados key={refresh} refresh={refresh} /> : <p role="note">No tienes permiso para listar negocios.</p>}
    {puedeCrear ? <CrearNegocioForm onCreado={trasCrear} /> : <ErrorMessage>No tienes permiso para crear negocios.</ErrorMessage>}
    {!puedeCrear && puedeListarUsuarios && <ListaUsuarios refresh={refresh} />}
    {!puedeCrear && puedeCrearUsuario && <section><h2>Crear cuenta nueva</h2><CrearUsuarioForm onCreado={trasCrear} /></section>}
  </>
}

import { useCallback, useState } from 'react'
import { useSesion, usePermiso } from '../../../app/providers/SessionContext'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import type { Pagina } from '../../../api/types'
import { AccessDenied, EmptyState, ErrorMessage, Loading } from '../../../components/feedback/Feedback'
import { listarRoles } from '../api'
import type { Rol } from '../types'

export function RolesPage() {
  const { negocioId } = useSesion()
  const puedeListar = usePermiso('listar_roles')

  return (
    <section>
      <h1>Roles del negocio</h1>
      {negocioId === null ? (
        <EmptyState title="Sin negocio activo">Selecciona un negocio para ver sus roles.</EmptyState>
      ) : !puedeListar ? (
        <AccessDenied />
      ) : (
        // key={negocioId}: al cambiar de negocio se reinicia todo (página, errores, datos)
        <TablaRoles key={negocioId} />
      )}
    </section>
  )
}

function TablaRoles() {
  const [page, setPage] = useState(1)

  const cargar = useCallback(
    ({ negocioId, signal }: ContextoConsulta): Promise<Pagina<Rol> | null> => {
      if (negocioId === null) return Promise.resolve(null)
      return listarRoles(negocioId, { page, signal })
    },
    [page],
  )

  const { data, error, pending, reintentar } = useConsultaContexto(cargar)

  if (pending) return <Loading>Cargando roles…</Loading>

  if (error) {
    return (
      <>
        <ErrorMessage>{error.detail}</ErrorMessage>
        <button type="button" onClick={reintentar}>Reintentar</button>
      </>
    )
  }

  if (!data || data.results.length === 0) return <EmptyState />

  return (
    <>
      <table>
        <caption>Roles del negocio activo</caption>
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Tipo</th>
            <th scope="col">Permisos</th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((rol) => (
            <tr key={rol.id}>
              <td>{rol.nombre}</td>
              <td>{rol.predefinido ? 'Predefinido' : 'Propio del negocio'}</td>
              <td>{rol.permiso_ids.length === 0 ? 'Sin permisos' : `${rol.permiso_ids.length} permisos`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <button type="button" disabled={data.previous === null} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>{' '}
        <span>Página {page}</span>{' '}
        <button type="button" disabled={data.next === null} onClick={() => setPage((p) => p + 1)}>
          Siguiente
        </button>
      </p>
    </>
  )
}
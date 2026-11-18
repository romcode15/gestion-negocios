import { useCallback, useMemo, useState } from 'react'
import { useSesion, usePermiso } from '../../../app/providers/SessionContext'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import type { Pagina } from '../../../api/types'
import { AccessDenied, EmptyState, ErrorMessage, Loading } from '../../../components/feedback/Feedback'
import { usePermisosDelegables } from '../components/usePermisosDelegables'
import { listarRoles } from '../api'
import type { Rol } from '../types'

export function RolesPage() {
  const { negocioId } = useSesion()
  const puedeListar = usePermiso('listar_roles')
  const puedeCrear = usePermiso('crear_rol')

  return (
    <section>
      <h1>Roles del negocio</h1>
      {negocioId === null ? (
        <EmptyState title="Sin negocio activo">Selecciona un negocio para ver sus roles.</EmptyState>
      ) : !puedeListar ? (
        <AccessDenied />
      ) : puedeCrear ? (
        // key={negocioId}: al cambiar de negocio se reinicia todo
        <RolesConNombres key={negocioId} />
      ) : (
        <TablaRoles key={negocioId} nombres={null} />
      )}
    </section>
  )
}

// Solo se usa si el usuario tiene crear_rol: ahí sí puede consultar el catálogo.
function RolesConNombres() {
  const { data } = usePermisosDelegables()
  const nombres = useMemo(
    () => (data ? new Map(data.map((permiso) => [permiso.id, permiso.codigo])) : null),
    [data],
  )
  return <TablaRoles nombres={nombres} />
}

function descripcionPermisos(rol: Rol, nombres: Map<number, string> | null): string {
  if (rol.permiso_ids.length === 0) return 'Sin permisos'
  if (nombres === null) return `${rol.permiso_ids.length} permisos (IDs: ${rol.permiso_ids.join(', ')})`
  return rol.permiso_ids.map((id) => nombres.get(id) ?? `Permiso #${id}`).join(', ')
}

function TablaRoles({ nombres }: { nombres: Map<number, string> | null }) {
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
              <td>{descripcionPermisos(rol, nombres)}</td>
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
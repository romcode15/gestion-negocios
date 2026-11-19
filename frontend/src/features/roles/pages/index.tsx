import { useCallback, useMemo, useState } from 'react'
import { useSesion, usePermiso } from '../../../app/providers/SessionContext'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import type { Pagina } from '../../../api/types'
import { AccessDenied, EmptyState } from '../../../components/feedback/Feedback'
import { PaginatedTable } from '../../../components/ui/PaginatedTable'
import { usePermisosDelegables } from '../components/usePermisosDelegables'
import { CrearRolForm } from '../components/CrearRolForm'
import { listarRoles } from '../api'
import type { Rol } from '../types'

export function RolesPage() {
  const { negocioId } = useSesion()
  const puedeListar = usePermiso('listar_roles')
  const puedeCrear = usePermiso('crear_rol')
  const [refresco, setRefresco] = useState(0)

  return (
    <section>
      <h1>Roles del negocio</h1>
      {negocioId === null ? (
        <EmptyState title="Sin negocio activo">Selecciona un negocio para ver sus roles.</EmptyState>
      ) : !puedeListar && !puedeCrear ? (
        <AccessDenied />
      ) : (
        // key={negocioId}: al cambiar de negocio se borra el formulario, las opciones y los errores
        <div key={negocioId}>
          {puedeCrear && <CrearRolForm onCreado={() => setRefresco((n) => n + 1)} />}
          {puedeListar && (puedeCrear ? (
            <RolesConNombres key={refresco} />
          ) : (
            <TablaRoles key={refresco} nombres={null} />
          ))}
        </div>
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

  return <PaginatedTable title="Roles del negocio activo" loadingLabel="Cargando roles…" emptyTitle="No hay roles"
    page={page} pagina={data} pending={pending} error={error} onPage={setPage} onRetry={reintentar}
    rowKey={(rol) => rol.id} columns={[
      { key: 'nombre', header: 'Nombre', render: (rol) => rol.nombre },
      { key: 'tipo', header: 'Tipo', render: (rol) => rol.predefinido ? 'Predefinido' : 'Propio del negocio' },
      { key: 'permisos', header: 'Permisos', render: (rol) => descripcionPermisos(rol, nombres) },
    ]} />
}

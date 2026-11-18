import { useCallback, useMemo, useState } from 'react'
import type { Pagina } from '../../../api/types'
import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { AccessDenied } from '../../../components/feedback/Feedback'
import { listarRoles } from '../../roles/api'
import type { Rol } from '../../roles/types'
import { listarMembresias } from '../api'
import { CrearMembresiaForm } from '../components/CrearMembresiaForm'
import { ListaMembresias } from '../components/ListaMembresias'
import { conRoles, opcionesDeRoles } from '../seleccion'
import type { EstadoRoles } from '../seleccion'
import type { Membresia } from '../types'

const paginaVaciaMembresias: Pagina<Membresia> = { count: 0, next: null, previous: null, results: [] }
const paginaVaciaRoles: Pagina<Rol> = { count: 0, next: null, previous: null, results: [] }

export function MembresiasPage() {
  const { sesion, negocioId, store } = useSesion()
  const puedeListar = usePermiso('listar_membresias')
  const puedeCrear = usePermiso('crear_membresia')
  const puedeAsignar = usePermiso('asignar_rol')
  const puedeListarRoles = usePermiso('listar_roles')
  const [page, setPage] = useState(1)
  const [paginaRoles, setPaginaRoles] = useState(1)
  const [rolesPaginas, setRolesPaginas] = useState<Record<number, Rol>>({})
  const [mensaje, setMensaje] = useState('')

  // Sin permiso o sin negocio activo no se lanza ninguna consulta de contexto.
  const cargarMembresias = useCallback(({ signal }: ContextoConsulta) => {
    if (!puedeListar || negocioId === null) return Promise.resolve(paginaVaciaMembresias)
    return listarMembresias(negocioId, { page, signal })
  }, [puedeListar, negocioId, page])

  const cargarRoles = useCallback(({ signal }: ContextoConsulta) => {
    if (!puedeListarRoles || negocioId === null) return Promise.resolve(paginaVaciaRoles)
    return listarRoles(negocioId, { page: paginaRoles, signal })
  }, [puedeListarRoles, negocioId, paginaRoles])

  const consultaMembresias = useConsultaContexto(cargarMembresias)
  const consultaRoles = useConsultaContexto(cargarRoles)

  // Los roles de las páginas ya visitadas se conservan para resolver nombres
  // y mantener la selección al paginar. Un cambio de negocio remonta la página.
  function irAPaginaRoles(nueva: number) {
    const actuales = consultaRoles.data
    if (actuales) setRolesPaginas((actual) => conRoles(actual, actuales.results))
    setPaginaRoles(nueva)
  }

  const rolesPorId = useMemo(
    () => conRoles(rolesPaginas, consultaRoles.data?.results ?? []),
    [rolesPaginas, consultaRoles.data],
  )
  const opcionesRoles = useMemo(
    () => opcionesDeRoles(rolesPaginas, consultaRoles.data?.results ?? [], negocioId),
    [rolesPaginas, consultaRoles.data, negocioId],
  )

  const estadoRoles: EstadoRoles = {
    opciones: opcionesRoles,
    pagina: consultaRoles.data,
    paginaActual: paginaRoles,
    pendiente: consultaRoles.pending,
    error: consultaRoles.error,
    puedeListar: puedeListarRoles,
    onPagina: irAPaginaRoles,
    onReintentar: consultaRoles.reintentar,
  }

  function refrescar() {
    setPage(1)
    consultaMembresias.reintentar()
  }

  // Un cambio de rol propio cambia permisos y navegación. restaurar() vuelve a
  // evaluar la sesión; se restaura el negocio activo si la nueva sesión lo conserva.
  async function recargarSesion() {
    await store.restaurar()
    if (negocioId !== null) {
      try { store.cambiarNegocio(negocioId) } catch { /* El contexto ya no está autorizado. */ }
    }
  }

  function trasCambiarRol(actualizada: Membresia) {
    setMensaje('Rol de ' + actualizada.usuario.username + ' actualizado.')
    refrescar()
    if (actualizada.usuario.id === sesion?.usuario.id) void recargarSesion()
  }

  return <>
    {mensaje && <p role="status">{mensaje}</p>}
    {negocioId === null && <p className="feedback" role="note">Selecciona un negocio activo para ver sus membresías.</p>}
    {!puedeListar && <AccessDenied />}
    {puedeListar && <ListaMembresias
      page={page} pagina={consultaMembresias.data} pendiente={consultaMembresias.pending}
      error={consultaMembresias.error} rolesPorId={rolesPorId} estadoRoles={estadoRoles}
      negocioId={negocioId} puedeAsignar={puedeAsignar}
      onPagina={setPage} onReintentar={consultaMembresias.reintentar} onActualizado={trasCambiarRol} />}
    {puedeCrear && <CrearMembresiaForm negocioId={negocioId} estadoRoles={estadoRoles} onCreado={refrescar} />}
    {!puedeCrear && <p className="feedback" role="note">No tienes permiso para incorporar miembros.</p>}
    {!puedeAsignar && <p className="feedback" role="note">No tienes permiso para cambiar roles.</p>}
  </>
}

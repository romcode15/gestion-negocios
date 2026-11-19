import { useCallback, useMemo, useState } from 'react'
import type { Pagina } from '../../../api/types'
import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { AccessDenied } from '../../../components/feedback/Feedback'
import { cargarPaginasRoles, cargarPaginasRolesAsignables } from '../catalogo'
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
    if (!puedeListarRoles || negocioId === null) return Promise.resolve([paginaVaciaRoles])
    return cargarPaginasRoles(negocioId, signal)
  }, [puedeListarRoles, negocioId])

  const consultaMembresias = useConsultaContexto(cargarMembresias)
  const consultaRoles = useConsultaContexto(cargarRoles)
  const puedeConsultarAsignables = puedeCrear || puedeAsignar
  const cargarAsignables = useCallback(({ signal }: ContextoConsulta) => {
    if (!puedeConsultarAsignables || negocioId === null) return Promise.resolve([paginaVaciaRoles])
    return cargarPaginasRolesAsignables(negocioId, signal)
  }, [puedeConsultarAsignables, negocioId])
  const consultaAsignables = useConsultaContexto(cargarAsignables)

  // Los roles de las páginas ya visitadas se conservan para resolver nombres
  // y mantener la selección al paginar. Un cambio de negocio remonta la página.
  function irAPaginaRoles(nueva: number) {
    const actuales = consultaAsignables.data?.[paginaRoles - 1]
    if (actuales) setRolesPaginas((actual) => conRoles(actual, actuales.results))
    setPaginaRoles(nueva)
  }

  const rolesPorId = useMemo(
    () => conRoles({}, [...(consultaRoles.data?.flatMap((pagina) => pagina.results) ?? []),
      ...(consultaAsignables.data?.flatMap((pagina) => pagina.results) ?? [])]),
    [consultaRoles.data, consultaAsignables.data],
  )
  const catalogoAsignable = useMemo(() => consultaAsignables.data?.flatMap((pagina) => pagina.results) ?? [], [consultaAsignables.data])
  const opcionesRoles = useMemo(
    () => opcionesDeRoles(rolesPaginas, consultaAsignables.data?.[paginaRoles - 1]?.results ?? [], negocioId),
    [rolesPaginas, consultaAsignables.data, paginaRoles, negocioId],
  )

  const estadoRoles: EstadoRoles = {
    catalogo: catalogoAsignable,
    opciones: opcionesRoles,
    pagina: consultaAsignables.data?.[paginaRoles - 1] ?? null,
    paginaActual: paginaRoles,
    pendiente: consultaAsignables.pending,
    error: consultaAsignables.error,
    puedeListar: puedeConsultarAsignables,
    onPagina: irAPaginaRoles,
    onReintentar: consultaAsignables.reintentar,
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
    <h1>Membresías del negocio</h1>
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

import type { ApiException } from '../../api/errors'
import type { Pagina } from '../../api/types'
import type { Rol } from '../roles/types'

export function conRoles(actuales: Record<number, Rol>, roles: Rol[]): Record<number, Rol> {
  const siguientes = { ...actuales }
  for (const rol of roles) siguientes[rol.id] = rol
  return siguientes
}

export function opcionesDeRoles(
  porId: Record<number, Rol>,
  resultados: Rol[],
  negocioId: number | null,
  adicionales: Rol[] = [],
): Rol[] {
  const mapa = conRoles(porId, resultados)
  for (const rol of adicionales) mapa[rol.id] = rol
  return Object.values(mapa)
    .filter((rol) => negocioId !== null && rol.negocio_id === negocioId)
    .sort((a, b) => a.id - b.id)
}

// El contrato de Membresia no incorpora nombre_rol: el nombre se resuelve
// desde los roles consultados al negocio activo.
export function nombreRol(porId: Record<number, Rol>, rolId: number): string {
  return porId[rolId]?.nombre ?? 'Rol #' + rolId
}

export interface EstadoRoles {
  catalogo?: Rol[]
  opciones: Rol[]
  pagina: Pagina<Rol> | null
  paginaActual: number
  pendiente: boolean
  error: ApiException | null
  puedeListar: boolean
  onPagina: (page: number) => void
  onReintentar: () => void
}

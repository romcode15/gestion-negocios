import type { Usuario } from './types'

export function conUsuarios(actuales: Record<number, Usuario>, usuarios: Usuario[]): Record<number, Usuario> {
  const siguientes = { ...actuales }
  for (const usuario of usuarios) siguientes[usuario.id] = usuario
  return siguientes
}

export function opcionesDe(porId: Record<number, Usuario>, resultados: Usuario[], seleccionado: Usuario | null, adicionales: Usuario[] = []): Usuario[] {
  const mapa = conUsuarios(porId, resultados)
  for (const usuario of adicionales) mapa[usuario.id] = usuario
  if (seleccionado) mapa[seleccionado.id] = seleccionado
  return Object.values(mapa).sort((a, b) => a.id - b.id)
}

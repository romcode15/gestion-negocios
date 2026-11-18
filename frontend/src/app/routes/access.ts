import type { Sesion } from '../../features/auth/types'
import type { EntradaModulo } from './types'
export function puedeAcceder(entry: EntradaModulo, sesion: Sesion, negocioId: number | null): boolean {
  if (entry.id === 'auth') return true
  if (entry.ambito === 'plataforma') return (entry.permisosAlternativos ?? [entry.permiso]).some((codigo) => sesion.permisos_globales.includes(codigo))
  const negocio = sesion.negocios.find((item) => item.id === negocioId)
  return (entry.permisosAlternativos ?? [entry.permiso]).some((codigo) => negocio?.permisos.includes(codigo))
}

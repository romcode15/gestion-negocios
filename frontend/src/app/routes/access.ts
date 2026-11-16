import type { Sesion } from '../../features/auth/types'
import type { EntradaModulo } from './types'
export function puedeAcceder(entry: EntradaModulo, sesion: Sesion, negocioId: number | null): boolean {
  if (entry.id === 'auth') return true
  if (entry.ambito === 'plataforma') return sesion.permisos_globales.includes(entry.permiso)
  const negocio = sesion.negocios.find((item) => item.id === negocioId)
  return !!negocio?.permisos.includes(entry.permiso)
}

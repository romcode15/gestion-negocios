import { createContext, useContext } from 'react'
import type { SessionState, SessionStore } from './sessionStore'
export interface SessionValue extends SessionState { store: SessionStore }
export const SessionContext = createContext<SessionValue | null>(null)
export function useSesion(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSesion necesita SessionProvider.')
  return value
}
export function usePermiso(codigo: string, ambito: 'plataforma' | 'negocio' = 'negocio'): boolean {
  const { sesion, negocioId } = useSesion()
  const permisos = ambito === 'plataforma' ? sesion?.permisos_globales : sesion?.negocios.find((n) => n.id === negocioId)?.permisos
  return permisos?.includes(codigo) ?? false
}

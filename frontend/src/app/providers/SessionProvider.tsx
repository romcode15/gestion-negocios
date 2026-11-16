import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { crearSessionStore } from './sessionStore'
import { SessionContext } from './SessionContext'
import { suscribirErroresApi } from '../../api/events'
export function SessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => crearSessionStore())
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    const unsubscribe = suscribirErroresApi((error) => {
      if (error.code === 'not_authenticated') store.expirar()
    })
    void store.restaurar()
    return () => { unsubscribe(); store.cancelar() }
  }, [store])
  return <SessionContext.Provider value={{ ...state, store }}>{children}</SessionContext.Provider>
}

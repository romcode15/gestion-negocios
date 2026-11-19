import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { crearSessionStore } from './sessionStore'
import { SessionContext } from './SessionContext'
import { suscribirErroresApi } from '../../api/events'
import { useToast } from '../../components/feedback/ToastContext'
export function SessionProvider({ children }: { children: ReactNode }) {
  const { notify } = useToast()
  const [store] = useState(() => crearSessionStore())
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    const unsubscribe = suscribirErroresApi((error) => {
      if (error.code === 'not_authenticated' && store.getSnapshot().status === 'authenticated') {
        store.expirar()
        notify({ type: 'warning', title: 'Tu sesión terminó', message: 'Inicia sesión de nuevo para continuar.' })
      }
    })
    void store.restaurar()
    return () => { unsubscribe(); store.cancelar() }
  }, [store, notify])
  return <SessionContext.Provider value={{ ...state, store }}>{children}</SessionContext.Provider>
}

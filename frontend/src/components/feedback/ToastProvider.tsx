import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToastContext } from './ToastContext'
import type { ToastOptions } from './ToastContext'
import { Toast } from './Toast'
function ToastItem({ item, dismiss }: { item: ToastOptions & { id: number }; dismiss: (id: number) => void }) {
  const close = useCallback(() => dismiss(item.id), [dismiss, item.id])
  return <Toast {...item} onClose={close} />
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<(ToastOptions & { id: number })[]>([])
  const sequence = useRef(0)
  const notify = useCallback((options: ToastOptions) => {
    const id = ++sequence.current
    setItems((current) => [...current.slice(-3), { ...options, id }])
  }, [])
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), [])
  const api = useMemo(() => ({ notify }), [notify])
  return <ToastContext.Provider value={api}>{children}<div className="toast-stack" role="region" aria-label="Notificaciones">{items.map((item) => <ToastItem key={item.id} item={item} dismiss={dismiss} />)}</div></ToastContext.Provider>
}

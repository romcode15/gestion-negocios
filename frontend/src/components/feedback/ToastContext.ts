import { createContext, useContext } from 'react'
export type ToastType = 'success' | 'info' | 'warning' | 'error'
export interface ToastOptions { type: ToastType; title: string; message?: string; duration?: number }
export interface ToastApi { notify: (options: ToastOptions) => void }
export const ToastContext = createContext<ToastApi | null>(null)
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast necesita ToastProvider.')
  return context
}

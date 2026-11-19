import { useEffect, useState } from 'react'
import type { ToastOptions } from './ToastContext'
export function Toast({ type, title, message, duration = 7000, onClose }: ToastOptions & { onClose: () => void }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (duration <= 0 || paused) return
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [duration, paused, onClose])
  return <div className={'toast toast-' + type} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <svg className="toast-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />{type === 'success' ? <path d="m7 12 3 3 7-7" /> : type === 'error' ? <path d="m9 9 6 6m0-6-6 6" /> : <path d="M12 7v1m0 3v6" />}
    </svg>
    <div className="toast-content" role={type === 'error' || type === 'warning' ? 'alert' : 'status'}><strong>{title}</strong>{message && <p>{message}</p>}</div>
    <button type="button" className="toast-close" aria-label="Cerrar notificación" onClick={onClose}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
  </div>
}

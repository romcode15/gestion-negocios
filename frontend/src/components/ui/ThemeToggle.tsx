import { useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent } from 'react'
import { cambiarTemaConOnda, leerTema, suscribirTema } from '../../app/theme'
export function ThemeToggle() {
  const theme = useSyncExternalStore(suscribirTema, leerTema, () => 'light')
  const busy = useRef(false)
  const [animating, setAnimating] = useState(false)
  const label = theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'
  async function toggle(event: MouseEvent<HTMLButtonElement>) {
    if (busy.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    busy.current = true
    setAnimating(true)
    try { await cambiarTemaConOnda(theme === 'light' ? 'dark' : 'light', { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) }
    finally { busy.current = false; setAnimating(false) }
  }
  return <button type="button" className={'theme-toggle' + (animating ? ' is-switching' : '')} aria-label={label} title={label} disabled={animating} onClick={(event) => void toggle(event)}>
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme === 'light' ? <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>}
    </svg>
  </button>
}

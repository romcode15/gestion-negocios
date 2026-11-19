export type Theme = 'light' | 'dark'
const KEY = 'gestion-negocios:theme'
export function leerTema(): Theme {
  try {
    const current = document.documentElement.dataset.theme ?? window.localStorage.getItem(KEY)
    return current === 'dark' ? 'dark' : 'light'
  } catch { return 'light' }
}
export function aplicarTema(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  try { window.localStorage.setItem(KEY, theme) } catch { /* Mantener el tema aunque el almacenamiento esté bloqueado. */ }
  window.dispatchEvent(new Event('themechange'))
}
export function suscribirTema(listener: () => void) {
  window.addEventListener('themechange', listener)
  return () => { window.removeEventListener('themechange', listener) }
}
import { flushSync } from 'react-dom'
let changing = false
export async function cambiarTemaConOnda(theme: Theme, origin: { x: number; y: number }): Promise<void> {
  if (changing) return
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reducedMotion) { aplicarTema(theme); return }
  changing = true
  const radius = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y))
  const transition = document.startViewTransition(() => { flushSync(() => aplicarTema(theme)) })
  try {
    await transition.ready
    await document.documentElement.animate(
      { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${Math.ceil(radius)}px at ${origin.x}px ${origin.y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both', pseudoElement: '::view-transition-new(root)' },
    ).finished
  } catch {
    // Una transición omitida/interrumpida conserva el tema ya aplicado.
    transition.skipTransition()
  } finally {
    await transition.finished.catch(() => {})
    changing = false
  }
}

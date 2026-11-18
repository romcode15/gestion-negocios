import { useEffect, useState } from 'react'
export function navegar(path: string, replace = false) {
  if (window.location.pathname === path) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
export function useRuta() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const changed = () => setPath(window.location.pathname)
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  return path
}

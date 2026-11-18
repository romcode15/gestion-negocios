import type { ReactNode } from 'react'
export function Navbar({ children, label = 'Navegación principal' }: { children: ReactNode; label?: string }) {
  return <nav className="app-nav" aria-label={label}>{children}</nav>
}

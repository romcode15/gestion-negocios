import type { ReactNode } from 'react'
import { useSesion } from '../providers/SessionContext'
import { modules } from '../routes/modules'
import { puedeAcceder } from '../routes/access'
import { AppLink } from '../routes/AppLink'
import { Button } from '../../components/ui/Button'
export function AppShell({ children }: { children: ReactNode }) {
  const { sesion, negocioId, pending, store } = useSesion()
  if (!sesion) return null
  const available = modules.filter((entry) => entry.id !== 'auth' && puedeAcceder(entry, sesion, negocioId))
  return <div className="panel-layout">
    <header className="app-header"><AppLink href="/" className="brand">Gestión de negocios</AppLink>
      <span>{sesion.usuario.username}</span>
      <Button pending={pending} pendingLabel="Cerrando…" onClick={() => void store.logout()}>Cerrar sesión</Button>
    </header>
    <div className="context-selector">
      <label htmlFor="negocio-activo">Negocio activo</label>
      <select id="negocio-activo" disabled={pending || sesion.negocios.length === 0} value={negocioId ?? ''} onChange={(event) => store.cambiarNegocio(Number(event.target.value))}>
        {sesion.negocios.length === 0 && <option value="">Sin negocios disponibles</option>}
        {sesion.negocios.map((negocio) => <option key={negocio.id} value={negocio.id}>{negocio.nombre}</option>)}
      </select>
    </div>
    <nav aria-label="Navegación principal"><AppLink href="/" aria-current={window.location.pathname === '/' ? 'page' : undefined}>Inicio</AppLink>
      {available.map((entry) => <AppLink key={entry.id} href={entry.path} aria-current={window.location.pathname === entry.path ? 'page' : undefined}>{entry.label}</AppLink>)}
    </nav>
    <main id="contenido" className="card" tabIndex={-1}>{children}</main>
  </div>
}

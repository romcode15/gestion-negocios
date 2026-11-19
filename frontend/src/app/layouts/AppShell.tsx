import type { ReactNode } from 'react'
import { useSesion } from '../providers/SessionContext'
import { modules } from '../routes/modules'
import { puedeAcceder } from '../routes/access'
import { AppLink } from '../routes/AppLink'
import { Button } from '../../components/ui/Button'
import { Navbar } from '../../components/ui/Navbar'
import { Footer } from '../../components/ui/Footer'
import { ModuleIcon } from '../../components/ui/ModuleIcon'
import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { BrandSymbol } from '../../components/ui/BrandSymbol'
import { AssetIcon } from '../../components/ui/AssetIcon'
export function AppShell({ children }: { children: ReactNode }) {
  const { sesion, negocioId, pending, store } = useSesion()
  if (!sesion) return null
  const path = window.location.pathname
  const available = modules.filter((entry) => entry.id !== 'auth' && puedeAcceder(entry, sesion, negocioId))
  const current = modules.find((entry) => entry.path === path)
  const business = sesion.negocios.find((item) => item.id === negocioId)
  return <div className="app-workspace">
    <aside className="workspace-sidebar">
      <AppLink href="/" className="workspace-brand"><span className="workspace-brand-mark"><BrandSymbol /></span><span>Gestión de negocios<small>ESPACIO DE ADMINISTRACIÓN</small></span></AppLink>
      <div className="context-selector sidebar-context">
        <label htmlFor="negocio-activo">NEGOCIO ACTIVO</label>
        <select id="negocio-activo" disabled={pending || sesion.negocios.length === 0} value={negocioId ?? ''} onChange={(event) => store.cambiarNegocio(Number(event.target.value))}>
          {sesion.negocios.length === 0 && <option value="">Sin negocios disponibles</option>}
          {sesion.negocios.map((negocio) => <option key={negocio.id} value={negocio.id}>{negocio.nombre}</option>)}
        </select>
      </div>
      <p className="sidebar-label">ADMINISTRACIÓN</p>
      <Navbar><AppLink href="/" aria-current={path === '/' ? 'page' : undefined}><ModuleIcon name="home" />Inicio</AppLink>
        {available.map((entry) => <AppLink key={entry.id} href={entry.path} aria-current={path === entry.path ? 'page' : undefined}><ModuleIcon name={entry.id === 'auth' ? 'home' : entry.id} />{entry.label}</AppLink>)}
      </Navbar>
      <div className="sidebar-bottom"><span className="sidebar-session"><i /> Sesión iniciada</span><Footer /></div>
    </aside>
    <header className="workspace-topbar">
      <div className="workspace-breadcrumb"><span>Administración</span><span aria-hidden="true">/</span><strong>{path === '/' ? 'Inicio' : current?.label ?? 'Página no disponible'}</strong></div>
      <div className="workspace-account"><ThemeToggle /><span className="account-avatar" aria-hidden="true">{sesion.usuario.username.slice(0, 2).toUpperCase()}</span><div><strong>{sesion.usuario.username}</strong><small>Cuenta activa</small></div>
        <Button className="logout-button" aria-label={pending ? 'Cerrando sesión' : 'Cerrar sesión'} title="Cerrar sesión" pending={pending} pendingLabel={<AssetIcon name="logout" />} onClick={() => void store.logout()}><AssetIcon name="logout" /></Button>
      </div>
    </header>
    <main id="contenido" className="workspace-main" tabIndex={-1}>
      <div className="workspace-context"><div><span className="context-dot" /><span>CONTEXTO ACTIVO</span><strong>{current?.ambito === 'plataforma' ? 'Plataforma' : business?.nombre ?? 'Plataforma'}</strong>
        {current?.ambito !== 'plataforma' && business && <small>ID: {business.id}</small>}</div><span className="context-hint">Acceso según tus permisos</span></div>
      <div className="workspace-content">{children}</div>
    </main>
  </div>
}

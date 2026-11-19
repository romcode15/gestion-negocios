import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { BrandSymbol } from '../../components/ui/BrandSymbol'
import type { ReactNode } from 'react'
import { Navbar } from '../../components/ui/Navbar'
import { Footer } from '../../components/ui/Footer'
export function LoginLayout({ children }: { children: ReactNode }) {
  return <main id="contenido" className="login-layout">
    <div className="login-center">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-theme"><ThemeToggle /></div>
        <div className="login-card-heading">
          <span className="login-logo"><BrandSymbol /></span>
          <p className="login-product">Gestión de negocios</p>
          <h1 id="login-title">Acceso a la plataforma</h1>
          <p>Introduce tus credenciales para acceder a tus negocios y permisos autorizados.</p>
        </div>
        {children}
        <div className="login-card-note"><span aria-hidden="true">◇</span> Una cuenta, acceso a tus negocios según tus permisos.</div>
      </section>
      <footer className="login-caption">Tu equipo, tus negocios y tus accesos en un mismo lugar.</footer>
    </div>
  </main>
}

type PanelProps = { children: ReactNode; navigation?: ReactNode; title: string }
function PanelLayout({ children, navigation, title }: PanelProps) {
  return <div className="panel-layout"><header><strong>Gestión de negocios</strong></header>
    {navigation && <Navbar label={title}>{navigation}</Navbar>}
    <main id="contenido" className="card" tabIndex={-1}><h1>{title}</h1>{children}</main><Footer /></div>
}
export function PlataformaLayout(props: Omit<PanelProps, 'title'>) { return <PanelLayout {...props} title="Panel de plataforma" /> }
export function NegocioLayout(props: Omit<PanelProps, 'title'>) { return <PanelLayout {...props} title="Panel de negocio" /> }

import type { ReactNode } from 'react'
export function LoginLayout({ children }: { children: ReactNode }) {
  return <main id="contenido" className="login-layout"><section className="card"><p>Gestión de negocios</p><h1>Acceso a la plataforma</h1>{children}</section></main>
}
type PanelProps = { children: ReactNode; navigation?: ReactNode; title: string }
function PanelLayout({ children, navigation, title }: PanelProps) {
  return <div className="panel-layout"><header><strong>Gestión de negocios</strong></header>
    {navigation && <nav aria-label={title}>{navigation}</nav>}
    <main id="contenido" className="card" tabIndex={-1}><h1>{title}</h1>{children}</main></div>
}
export function PlataformaLayout(props: Omit<PanelProps, 'title'>) { return <PanelLayout {...props} title="Panel de plataforma" /> }
export function NegocioLayout(props: Omit<PanelProps, 'title'>) { return <PanelLayout {...props} title="Panel de negocio" /> }

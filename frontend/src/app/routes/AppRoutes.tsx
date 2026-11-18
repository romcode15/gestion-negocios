import { modules } from './modules'
import { EmptyState } from '../../components/feedback/Feedback'
export function AppRoutes() {
  const entry = modules.find((module) => module.path === window.location.pathname)
  return <><a className="skip-link" href="#contenido">Saltar al contenido</a>
    {entry ? <entry.Page /> : <main id="contenido" className="card"><EmptyState title="Página no disponible"><a href="/">Volver al inicio</a></EmptyState></main>}
  </>
}

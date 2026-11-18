import { useEffect, useRef } from 'react'
import { modules } from './modules'
import { AccessDenied, EmptyState, Loading } from '../../components/feedback/Feedback'
import { ApiFeedback } from '../../components/feedback/ApiFeedback'
import { useSesion } from '../providers/SessionContext'
import { AppShell } from '../layouts/AppShell'
import { LoginLayout } from '../layouts/Layouts'
import { puedeAcceder } from './access'
import { AppLink } from './AppLink'
import { navegar, useRuta } from './navigation'
import { AuthPage } from '../../features/auth/pages'
export function AppRoutes() {
  const path = useRuta()
  const { status, sesion, negocioId, revision, error, store } = useSesion()
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (status === 'anonymous' && path !== '/') navegar('/', true)
  }, [status, path])
  useEffect(() => { content.current?.focus() }, [path, status, revision])
  const entry = modules.find((module) => module.path === path)
  let page
  if (status === 'restoring') page = <LoginLayout><Loading>Verificando sesión…</Loading></LoginLayout>
  else if (status === 'restore_error') page = <LoginLayout>{error && <ApiFeedback error={error} onRetry={() => void store.restaurar()} />}</LoginLayout>
  else if (!sesion) page = <AuthPage />
  else {
    let section
    if (path === '/') section = <section><h1>Inicio</h1><p>Bienvenido, {sesion.usuario.username}.</p>
      {sesion.negocios.length === 0 ? <EmptyState title="Sin negocios disponibles"><p>Tu sesión no tiene negocios autorizados. Puedes usar las secciones de plataforma si dispones de sus permisos.</p></EmptyState>
        : <p>Negocio activo: <strong>{sesion.negocios.find((n) => n.id === negocioId)?.nombre}</strong>. Selecciona una sección disponible en la navegación.</p>}
    </section>
    else if (!entry) section = <EmptyState title="Página no disponible"><AppLink href="/">Volver al inicio</AppLink></EmptyState>
    else if (!puedeAcceder(entry, sesion, negocioId)) section = <><h1>Acceso denegado</h1><AccessDenied /></>
    else section = <entry.Page />
    // Remonta formularios y selecciones locales incluso al volver al mismo negocio.
    page = <AppShell><div key={path + ':' + revision}>{section}</div></AppShell>
  }
  return <><a className="skip-link" href="#contenido">Saltar al contenido</a><div ref={content} tabIndex={-1}>{page}</div></>
}

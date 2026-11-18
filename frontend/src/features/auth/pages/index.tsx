import { LoginLayout } from '../../../app/layouts/Layouts'
import { LoginForm } from '../components/LoginForm'
import { useSesion } from '../../../app/providers/SessionContext'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Button } from '../../../components/ui/Button'
export function AuthPage() {
  const { error, logoutUnconfirmed, store } = useSesion()
  return <LoginLayout>
    {error && <ApiFeedback error={error} />}
    {logoutUnconfirmed && <div className="feedback"><p>La sesión local se limpió, pero el servidor no confirmó el cierre. Reintenta cerrarla.</p><Button onClick={() => void store.logout()}>Reintentar cierre de sesión</Button></div>}
    <LoginForm />
  </LoginLayout>
}

import type { ApiError } from '../../api/types'
import { ErrorMessage } from './Feedback'
import { Button } from '../ui/Button'
export function ApiFeedback({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const message = error.code === 'permission_denied' ? 'No tienes permiso para realizar esta acción.' :
    error.code === 'not_found' ? 'El recurso ya no está disponible en este contexto.' :
    error.code === 'csrf_failed' ? 'Se renovó la protección del formulario. Puedes repetir el envío manualmente.' :
    error.code === 'network_error' ? 'No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.' : error.detail
  return <ErrorMessage><p>{message}</p>{onRetry && <Button onClick={onRetry}>Reintentar</Button>}</ErrorMessage>
}

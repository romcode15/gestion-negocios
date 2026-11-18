import { useEffect, useState } from 'react'
import { useSesion } from './SessionContext'
import { ApiException, isAbortError } from '../../api/errors'
export interface ContextoConsulta { negocioId: number | null; signal: AbortSignal }
export function useConsultaContexto<T>(cargar: (contexto: ContextoConsulta) => Promise<T>) {
  const { store, revision } = useSesion()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ revision: number; attempt: number; cargar: typeof cargar; data: T | null; error: ApiException | null } | null>(null)
  useEffect(() => {
    const local = new AbortController()
    void store.enContexto(({ negocioId, signal }) => cargar({ negocioId, signal: AbortSignal.any([local.signal, signal]) })).then(
      (data) => { if (!local.signal.aborted) setResult({ revision, attempt, cargar, data, error: null }) },
      (error: unknown) => {
        if (!local.signal.aborted && !isAbortError(error)) setResult({ revision, attempt, cargar, data: null, error: error instanceof ApiException ? error : new ApiException('unknown_error', 'No se pudo cargar la información.') })
      },
    )
    return () => local.abort()
  }, [cargar, store, revision, attempt])
  const current = result?.revision === revision && result.attempt === attempt && result.cargar === cargar
  return { data: current ? result.data : null, error: current ? result.error : null, pending: !current, reintentar: () => setAttempt((value) => value + 1) }
}

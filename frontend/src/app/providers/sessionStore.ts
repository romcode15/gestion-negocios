import type { LoginSolicitud, Sesion } from '../../features/auth/types'
import * as auth from '../../features/auth/api'
import { ApiException, isAbortError } from '../../api/errors'
type AuthApi = Pick<typeof auth, 'obtenerSesion' | 'iniciarSesion' | 'cerrarSesion'>
export interface SessionState {
  status: 'restoring' | 'authenticated' | 'anonymous' | 'restore_error'
  sesion: Sesion | null
  negocioId: number | null
  revision: number
  pending: boolean
  error: ApiException | null
  logoutUnconfirmed: boolean
}
function normalize(error: unknown) {
  return error instanceof ApiException ? error : new ApiException('unknown_error', 'No se pudo completar la operación.')
}
export function crearSessionStore(api: AuthApi = auth) {
  let state: SessionState = { status: 'restoring', sesion: null, negocioId: null, revision: 0, pending: false, error: null, logoutUnconfirmed: false }
  let authController = new AbortController()
  let contextController = new AbortController()
  let operation = 0
  const listeners = new Set<() => void>()
  function set(patch: Partial<SessionState>) { state = { ...state, ...patch }; for (const notify of listeners) notify() }
  function invalidateContext() { contextController.abort(); contextController = new AbortController(); return state.revision + 1 }
  function begin() { authController.abort(); authController = new AbortController(); operation++; return { ticket: operation, signal: authController.signal } }
  function anonymous(error: ApiException | null = null, logoutUnconfirmed = false) {
    const revision = invalidateContext()
    set({ status: 'anonymous', sesion: null, negocioId: null, revision, pending: false, error, logoutUnconfirmed })
  }
  function accept(sesion: Sesion) {
    const revision = invalidateContext()
    set({ status: 'authenticated', sesion, negocioId: sesion.negocios[0]?.id ?? null, revision, pending: false, error: null, logoutUnconfirmed: false })
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async restaurar() {
      const { ticket, signal } = begin()
      set({ status: 'restoring', sesion: null, negocioId: null, revision: invalidateContext(), pending: true, error: null })
      try {
        const sesion = await api.obtenerSesion({ signal })
        if (ticket === operation && !signal.aborted) accept(sesion)
      } catch (error) {
        if (ticket !== operation || signal.aborted || isAbortError(error)) return
        const normalized = normalize(error)
        if (normalized.code === 'not_authenticated') anonymous()
        else set({ status: 'restore_error', pending: false, error: normalized })
      }
    },
    async login(input: LoginSolicitud) {
      if (state.pending) return
      const { ticket, signal } = begin()
      set({ pending: true, error: null })
      try {
        const sesion = await api.iniciarSesion(input, { signal })
        signal.throwIfAborted()
        if (ticket === operation) accept(sesion)
      } catch (error) {
        if (ticket === operation && !signal.aborted) set({ pending: false })
        throw error
      }
    },
    async logout() {
      if (state.pending) return
      const { ticket, signal } = begin()
      set({ status: 'restoring', sesion: null, negocioId: null, revision: invalidateContext(), pending: true, error: null })
      try {
        await api.cerrarSesion({ signal })
        if (ticket === operation && !signal.aborted) anonymous()
      } catch (error) {
        if (ticket !== operation || signal.aborted || isAbortError(error)) return
        const normalized = normalize(error)
        anonymous(normalized, normalized.code !== 'not_authenticated')
      }
    },
    expirar() { begin(); anonymous(new ApiException('not_authenticated', 'Tu sesión terminó. Inicia sesión de nuevo.', {}, 403)) },
    cambiarNegocio(negocioId: number) {
      if (state.pending || state.negocioId === negocioId) return
      if (!state.sesion?.negocios.some((negocio) => negocio.id === negocioId)) throw new ApiException('permission_denied', 'El negocio no pertenece a tu sesión.', {}, 403)
      set({ negocioId, revision: invalidateContext(), error: null })
    },
    async enContexto<T>(task: (context: { negocioId: number | null; signal: AbortSignal }) => Promise<T>): Promise<T> {
      const signal = contextController.signal
      const revision = state.revision
      try {
        const result = await task({ negocioId: state.negocioId, signal })
        // También descarta transportes que ignoren AbortSignal.
        if (signal.aborted || revision !== state.revision) throw new DOMException('El contexto cambió.', 'AbortError')
        return result
      } catch (error) {
        if (signal.aborted || revision !== state.revision) throw new DOMException('El contexto cambió.', 'AbortError')
        throw error
      }
    },
    cancelar() { begin(); contextController.abort() },
  }
}
export type SessionStore = ReturnType<typeof crearSessionStore>

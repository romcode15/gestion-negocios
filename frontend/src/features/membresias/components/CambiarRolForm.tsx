import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Button } from '../../../components/ui/Button'
import { cambiarRolMembresia } from '../api'
import type { Membresia } from '../types'
import { aSolicitudCambioRol, validarRol } from '../validacion'
import type { EstadoRoles } from '../seleccion'
import { SelectorRoles } from './SelectorRoles'

type Props = {
  membresia: Membresia
  negocioId: number | null
  estadoRoles: EstadoRoles
  onActualizado: (membresia: Membresia) => void
}

export function CambiarRolForm({ membresia, negocioId, estadoRoles, onActualizado }: Props) {
  const [rolId, setRolId] = useState<number | null>(membresia.rol_id)
  const [errors, setErrors] = useState<string[]>([])
  const [error, setError] = useState<ApiException | null>(null)
  const [pending, setPending] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const enviando = useRef(false)
  const form = useRef<HTMLFormElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando.current || negocioId === null) return
    const locales = validarRol(rolId)
    setErrors(locales)
    setError(null)
    setMensaje('')
    if (locales.length) {
      form.current?.querySelector<HTMLElement>('[name="rol_id"]')?.focus()
      return
    }
    enviando.current = true
    setPending(true)
    try {
      const actualizada = await cambiarRolMembresia(negocioId, membresia.id, aSolicitudCambioRol(rolId))
      setRolId(actualizada.rol_id)
      setMensaje('Rol actualizado.')
      onActualizado(actualizada)
    } catch (cause) {
      if (isAbortError(cause)) return
      const apiError = cause instanceof ApiException ? cause : new ApiException('unknown_error', 'No se pudo cambiar el rol.')
      setError(apiError)
      setErrors(apiError.errors.rol_id ?? apiError.errors.membresia_id ?? [])
      if (apiError.errors.rol_id || apiError.errors.membresia_id) {
        requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[name="rol_id"]')?.focus())
      }
    } finally {
      enviando.current = false
      setPending(false)
    }
  }

  return <form ref={form} onSubmit={submit} noValidate aria-busy={pending}>
    {error && <ApiFeedback error={error} />}
    {mensaje && <p role="status">{mensaje}</p>}
    <fieldset disabled={pending}>
      <SelectorRoles estado={estadoRoles} value={rolId}
        onSeleccionar={(rol) => setRolId(rol?.id ?? null)} errors={errors} disabled={pending} />
      <Button type="submit" pending={pending} pendingLabel="Guardando…">Guardar rol</Button>
    </fieldset>
  </form>
}

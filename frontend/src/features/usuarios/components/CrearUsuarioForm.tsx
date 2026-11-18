import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/TextField'
import { crearUsuario } from '../api'
import { useSesion } from '../../../app/providers/SessionContext'
import type { Usuario } from '../types'
import { aSolicitudUsuario, validarUsuario } from '../validacion'

export function CrearUsuarioForm({ onCreado, disabled = false }: { onCreado: (usuario: Usuario) => void; disabled?: boolean }) {
  const { store } = useSesion()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [error, setError] = useState<ApiException | null>(null)
  const [pending, setPending] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const enviando = useRef(false)
  const form = useRef<HTMLFormElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando.current || disabled) return
    const locales = validarUsuario({ username, password })
    setErrors(locales)
    setError(null)
    setMensaje('')
    const primerCampo = ['username', 'password'].find((campo) => locales[campo as 'username' | 'password']?.length)
    if (primerCampo) {
      form.current?.querySelector<HTMLInputElement>('[name="' + primerCampo + '"]')?.focus()
      return
    }
    enviando.current = true
    setPending(true)
    try {
      const usuario = await store.enContexto(({ signal }) => crearUsuario(aSolicitudUsuario({ username, password }), { signal }))
      setUsername('')
      setPassword('')
      setErrors({})
      setMensaje('Cuenta ' + usuario.username + ' creada. Ya puedes seleccionarla como administrador.')
      onCreado(usuario)
    } catch (cause) {
      if (isAbortError(cause)) return
      const apiError = cause instanceof ApiException ? cause : new ApiException('unknown_error', 'No se pudo crear la cuenta.')
      setError(apiError)
      setErrors(apiError.errors)
      const campo = ['username', 'password'].find((key) => apiError.errors[key]?.length)
      if (campo) requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[name="' + campo + '"]')?.focus())
    } finally {
      enviando.current = false
      setPending(false)
    }
  }

  return <form ref={form} onSubmit={submit} noValidate aria-busy={pending}>
    {error && <ApiFeedback error={error} />}
    {mensaje && <p role="status">{mensaje}</p>}
    <fieldset disabled={pending || disabled}>
      <TextField name="username" label="Nombre de usuario" autoComplete="username" required
        value={username} errors={errors.username} onChange={(event) => setUsername(event.target.value)} />
      <TextField name="password" label="Contraseña" type="password" autoComplete="new-password" required
        value={password} errors={errors.password} onChange={(event) => setPassword(event.target.value)} />
      <Button type="submit" pending={pending} pendingLabel="Creando cuenta…">Crear cuenta</Button>
    </fieldset>
  </form>
}

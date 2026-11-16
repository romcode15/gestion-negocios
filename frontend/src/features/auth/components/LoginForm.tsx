import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSesion } from '../../../app/providers/SessionContext'
import { TextField } from '../../../components/ui/TextField'
import { Button } from '../../../components/ui/Button'
import { ErrorMessage } from '../../../components/feedback/Feedback'
import { ApiException, isAbortError } from '../../../api/errors'
export function LoginForm() {
  const { pending, store } = useSesion()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [message, setMessage] = useState('')
  const submitting = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || pending) return
    const validation: Record<string, string[]> = {}
    if (!username.trim()) validation.username = ['Escribe tu nombre de usuario.']
    if (!password) validation.password = ['Escribe tu contraseña.']
    setErrors(validation); setMessage('')
    if (Object.keys(validation).length) { form.current?.querySelector<HTMLInputElement>('[name="' + Object.keys(validation)[0] + '"]')?.focus(); return }
    submitting.current = true
    try { await store.login({ username, password }); setPassword('') } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof ApiException) {
        setErrors(error.errors)
        setMessage(error.code === 'invalid_credentials' ? 'Nombre de usuario o contraseña incorrectos.' :
          error.code === 'csrf_failed' ? 'Se renovó la protección del formulario. Vuelve a pulsar Ingresar.' : error.detail)
        const field = ['username', 'password'].find((key) => error.errors[key]?.length)
        if (field) requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[name="' + field + '"]')?.focus())
      } else setMessage('No se pudo iniciar sesión. Inténtalo de nuevo.')
    } finally { submitting.current = false }
  }
  return <form ref={form} onSubmit={submit} noValidate aria-busy={pending}>
    {message && <ErrorMessage>{message}</ErrorMessage>}
    <fieldset disabled={pending}>
      <TextField name="username" label="Nombre de usuario" autoComplete="username" required value={username} errors={errors.username} onChange={(e) => setUsername(e.target.value)} />
      <TextField name="password" label="Contraseña" type="password" autoComplete="current-password" required value={password} errors={errors.password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" pending={pending} pendingLabel="Ingresando…">Ingresar</Button>
    </fieldset>
  </form>
}

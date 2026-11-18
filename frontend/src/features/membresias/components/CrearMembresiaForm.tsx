import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/TextField'
import { crearMembresia } from '../api'
import type { EstadoRoles } from '../seleccion'
import type { Membresia } from '../types'
import { aSolicitudMembresia, validarMembresia } from '../validacion'
import type { ErroresMembresia, ModoCuenta } from '../validacion'
import { SelectorRoles } from './SelectorRoles'

type Props = {
  negocioId: number | null
  estadoRoles: EstadoRoles
  onCreado: (membresia: Membresia) => void
}

export function CrearMembresiaForm({ negocioId, estadoRoles, onCreado }: Props) {
  const [modo, setModo] = useState<ModoCuenta>('nueva')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rolId, setRolId] = useState<number | null>(null)
  const [errors, setErrors] = useState<ErroresMembresia>({})
  const [error, setError] = useState<ApiException | null>(null)
  const [pending, setPending] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const enviando = useRef(false)
  const form = useRef<HTMLFormElement>(null)

  // Al cambiar de modo se descarta la clave y cualquier error anterior.
  function cambiarModo(nuevo: ModoCuenta) {
    setModo(nuevo)
    setPassword('')
    setErrors({})
    setError(null)
    setMensaje('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando.current || negocioId === null) return
    const valores = { username, password, rol_id: rolId, modo }
    const locales = validarMembresia(valores)
    setErrors(locales)
    setError(null)
    setMensaje('')
    const primerCampo = ['username', 'password', 'rol_id'].find((campo) => locales[campo as keyof ErroresMembresia]?.length)
    if (primerCampo) {
      form.current?.querySelector<HTMLElement>('[name="' + primerCampo + '"]')?.focus()
      return
    }
    enviando.current = true
    setPending(true)
    try {
      const membresia = await crearMembresia(negocioId, aSolicitudMembresia(valores))
      setModo('nueva')
      setUsername('')
      setPassword('')
      setRolId(null)
      setErrors({})
      setMensaje('Miembro ' + membresia.usuario.username + ' incorporado.')
      onCreado(membresia)
    } catch (cause) {
      if (isAbortError(cause)) return
      const apiError = cause instanceof ApiException ? cause : new ApiException('unknown_error', 'No se pudo incorporar el miembro.')
      setError(apiError)
      setErrors(apiError.errors)
      const campo = ['username', 'password', 'rol_id'].find((clave) => apiError.errors[clave]?.length)
      if (campo) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[name="' + campo + '"]')?.focus())
    } finally {
      enviando.current = false
      setPending(false)
    }
  }

  return <form ref={form} onSubmit={submit} noValidate aria-busy={pending}>
    <h2>Incorporar miembro</h2>
    {error && <ApiFeedback error={error} />}
    {mensaje && <p role="status">{mensaje}</p>}
    <fieldset disabled={pending}>
      <fieldset>
        <legend>Cuenta del miembro</legend>
        <label>
          <input type="radio" name="modo" value="nueva" checked={modo === 'nueva'}
            onChange={() => cambiarModo('nueva')} /> Crear cuenta nueva
        </label>
        <label>
          <input type="radio" name="modo" value="existente" checked={modo === 'existente'}
            onChange={() => cambiarModo('existente')} /> Usar cuenta existente
        </label>
      </fieldset>
      <TextField name="username" label="Nombre de usuario" autoComplete="username" required
        value={username} errors={errors.username} onChange={(event) => setUsername(event.target.value)} />
      {modo === 'nueva' && <TextField name="password" label="Contraseña" type="password" autoComplete="new-password" required
        value={password} errors={errors.password} onChange={(event) => setPassword(event.target.value)} />}
      <SelectorRoles estado={estadoRoles} value={rolId}
        onSeleccionar={(rol) => setRolId(rol?.id ?? null)} errors={errors.rol_id} disabled={pending} />
      <Button type="submit" pending={pending} pendingLabel="Incorporando…">Incorporar miembro</Button>
    </fieldset>
  </form>
}

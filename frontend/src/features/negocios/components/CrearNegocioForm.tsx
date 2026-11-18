import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/TextField'
import { CrearUsuarioForm } from '../../usuarios/components/CrearUsuarioForm'
import { SelectorAdministrador } from '../../usuarios/components/SelectorAdministrador'
import type { Usuario } from '../../usuarios/types'
import { crearNegocio } from '../api'
import { aSolicitudNegocio, validarNegocio } from '../validacion'
import type { ErroresNegocio } from '../validacion'

export function CrearNegocioForm({ onCreado }: { onCreado: () => void }) {
  const { store } = useSesion()
  const puedeCrearUsuario = usePermiso('crear_usuario', 'plataforma')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('')
  const [administrador, setAdministrador] = useState<Usuario | null>(null)
  const [recargarToken, setRecargarToken] = useState(0)
  const [cuentasCreadas, setCuentasCreadas] = useState<Usuario[]>([])
  const [errors, setErrors] = useState<ErroresNegocio>({})
  const [error, setError] = useState<ApiException | null>(null)
  const [pending, setPending] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const enviando = useRef(false)
  const form = useRef<HTMLFormElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando.current) return
    const valores = { nombre, tipo, administrador }
    const locales = validarNegocio(valores)
    setErrors(locales)
    setError(null)
    setMensaje('')
    const primerCampo = ['nombre', 'tipo', 'administrador_id'].find((campo) => locales[campo as keyof ErroresNegocio]?.length)
    if (primerCampo) {
      form.current?.querySelector<HTMLElement>('[name="' + primerCampo + '"]')?.focus()
      return
    }
    enviando.current = true
    setPending(true)
    try {
      const negocio = await store.enContexto(({ signal }) => crearNegocio(aSolicitudNegocio(valores), { signal }))
      setNombre('')
      setTipo('')
      setAdministrador(null)
      setErrors({})
      setMensaje('Negocio ' + negocio.nombre + ' creado.')
      onCreado()
    } catch (cause) {
      if (isAbortError(cause)) return
      const apiError = cause instanceof ApiException ? cause : new ApiException('unknown_error', 'No se pudo crear el negocio.')
      setError(apiError)
      setErrors(apiError.errors)
      const campo = ['nombre', 'tipo', 'administrador_id'].find((key) => apiError.errors[key]?.length)
      if (campo) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[name="' + campo + '"]')?.focus())
    } finally {
      enviando.current = false
      setPending(false)
    }
  }

  function trasCrearCuenta(usuario: Usuario) {
    setCuentasCreadas((actuales) => [...actuales, usuario])
    setAdministrador(usuario)
    setRecargarToken((token) => token + 1)
  }

  return <>
    <form ref={form} onSubmit={submit} noValidate aria-busy={pending}>
      <h2>Crear negocio</h2>
      {error && <ApiFeedback error={error} />}
      {mensaje && <p role="status">{mensaje}</p>}
      <fieldset disabled={pending}>
        <TextField name="nombre" label="Nombre del negocio" autoComplete="organization" required
          value={nombre} errors={errors.nombre} onChange={(event) => setNombre(event.target.value)} />
        <TextField name="tipo" label="Tipo de negocio" required
          value={tipo} errors={errors.tipo} onChange={(event) => setTipo(event.target.value)} />
        <SelectorAdministrador value={administrador} onSeleccionar={setAdministrador} recargarToken={recargarToken}
          adicionales={cuentasCreadas} errors={errors.administrador_id} disabled={pending} />
        <Button type="submit" pending={pending} pendingLabel="Creando negocio…">Crear negocio</Button>
      </fieldset>
    </form>
    {puedeCrearUsuario && <section className="crear-cuenta">
      <h3>Crear cuenta nueva</h3>
      <CrearUsuarioForm onCreado={trasCrearCuenta} disabled={pending} />
    </section>}
  </>
}

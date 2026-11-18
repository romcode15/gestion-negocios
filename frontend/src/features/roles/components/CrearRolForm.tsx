import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { useSesion } from '../../../app/providers/SessionContext'
import { ErrorMessage } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/TextField'
import { crearRol } from '../api'
import { PermisosSelector } from './PermisosSelector'

export function CrearRolForm({ onCreado }: { onCreado: () => void }) {
  const { negocioId } = useSesion()
  const [nombre, setNombre] = useState('')
  const [permisoIds, setPermisoIds] = useState<number[]>([])
  const [errores, setErrores] = useState<Record<string, string[]>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const controller = useRef<AbortController | null>(null)

  // Al salir de la pantalla o cambiar de negocio se cancela lo pendiente.
  useEffect(() => () => controller.current?.abort(), [])

  // Enfoca el primer campo con error.
  useEffect(() => {
    if (Object.keys(errores).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
  }, [errores])

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (pending || negocioId === null) return
    setExito(null)
    setErrorGeneral(null)

    const limpio = nombre.trim()
    if (limpio === '') {
      setErrores({ nombre: ['El nombre es obligatorio.'] })
      return
    }
    setErrores({})

    controller.current?.abort()
    const actual = new AbortController()
    controller.current = actual
    setPending(true)
    try {
      const rol = await crearRol(negocioId, { nombre: limpio, permiso_ids: permisoIds }, { signal: actual.signal })
      if (actual.signal.aborted) return
      setNombre('')
      setPermisoIds([])
      setExito(`Rol «${rol.nombre}» creado correctamente.`)
      onCreado()
    } catch (error) {
      if (actual.signal.aborted || isAbortError(error)) return
      if (error instanceof ApiException) {
        setErrores(error.errors ?? {})
        setErrorGeneral(error.detail)
      } else {
        setErrorGeneral('No se pudo crear el rol.')
      }
    } finally {
      if (!actual.signal.aborted) setPending(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={(e) => void enviar(e)} noValidate>
      <h2>Crear rol</h2>
      <TextField
        label="Nombre del rol"
        name="nombre"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        errors={errores.nombre ?? []}
        disabled={pending}
        required
        autoComplete="off"
      />
      <PermisosSelector
        seleccionados={permisoIds}
        onChange={setPermisoIds}
        disabled={pending}
        errors={errores.permiso_ids ?? []}
      />
      {errorGeneral && <ErrorMessage>{errorGeneral}</ErrorMessage>}
      {exito && <p role="status">{exito}</p>}
      <Button type="submit" pending={pending} pendingLabel="Guardando…">Crear rol</Button>
    </form>
  )
}
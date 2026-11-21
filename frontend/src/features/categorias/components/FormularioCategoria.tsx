import { useEffect, useRef, useState } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { useSesion } from '../../../app/providers/SessionContext'
import { ErrorMessage } from '../../../components/feedback/Feedback'
import { FormModal } from '../../../components/ui/FormModal'
import { TextField } from '../../../components/ui/TextField'
import { actualizarCategoria, crearCategoria } from '../api'
import type { ActualizarCategoriaSolicitud, Categoria } from '../types'

interface Props {
  inicial: Categoria | null
  onClose: () => void
  onGuardado: (categoria: Categoria) => void
}

function validar(nombre: string, descripcion: string): Record<string, string[]> {
  const errores: Record<string, string[]> = {}
  if (nombre === '') errores.nombre = ['El nombre es obligatorio.']
  else if (nombre.length > 150) errores.nombre = ['El nombre no puede superar 150 caracteres.']
  if (descripcion.length > 500) errores.descripcion = ['La descripción no puede superar 500 caracteres.']
  return errores
}

export function FormularioCategoria({ inicial, onClose, onGuardado }: Props) {
  const { negocioId } = useSesion()
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '')
  const [activo, setActivo] = useState(inicial?.activo ?? true)
  const [errores, setErrores] = useState<Record<string, string[]>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const enviando = useRef(false) // bloqueo síncrono contra doble envío
  const controller = useRef<AbortController | null>(null)
  const contenedor = useRef<HTMLDivElement>(null)

  // Si el modal se cierra o cambia el negocio, se cancela lo pendiente.
  useEffect(() => () => controller.current?.abort(), [])

  // Foco en el primer campo con error.
  useEffect(() => {
    if (Object.keys(errores).length > 0) {
      contenedor.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
  }, [errores])

  async function enviar() {
    if (enviando.current || negocioId === null) return
    setErrorGeneral(null)
    const n = nombre.trim()
    const d = descripcion.trim()
    const invalidos = validar(n, d)
    if (Object.keys(invalidos).length > 0) {
      setErrores(invalidos)
      return
    }
    setErrores({})

    let cambios: ActualizarCategoriaSolicitud | null = null
    if (inicial) {
      cambios = {}
      if (n !== inicial.nombre) cambios.nombre = n
      if (d !== inicial.descripcion) cambios.descripcion = d
      if (activo !== inicial.activo) cambios.activo = activo
      if (Object.keys(cambios).length === 0) {
        onClose() // el contrato rechaza un PATCH vacío
        return
      }
    }

    enviando.current = true
    controller.current?.abort()
    const actual = new AbortController()
    controller.current = actual
    setPending(true)
    try {
      const guardada = inicial && cambios
        ? await actualizarCategoria(negocioId, inicial.id, cambios, { signal: actual.signal })
        : await crearCategoria(negocioId, { nombre: n, descripcion: d }, { signal: actual.signal })
      if (actual.signal.aborted) return
      onGuardado(guardada)
    } catch (error) {
      if (actual.signal.aborted || isAbortError(error)) return
      if (error instanceof ApiException) {
        setErrores(error.errors ?? {}) // se conservan los datos escritos
        setErrorGeneral(error.detail)
      } else {
        setErrorGeneral('No se pudo guardar la categoría.')
      }
    } finally {
      enviando.current = false
      if (!actual.signal.aborted) setPending(false)
    }
  }

  return (
    <FormModal
      open
      title={inicial ? 'Editar categoría' : 'Crear categoría'}
      onClose={onClose}
      onSubmit={() => void enviar()}
      pending={pending}
      actionText={inicial ? 'Guardar cambios' : 'Crear categoría'}
    >
      <div ref={contenedor}>
        <TextField
          label="Nombre"
          name="nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          errors={errores.nombre ?? []}
          required
          autoComplete="off"
        />
        <TextField
          label="Descripción"
          name="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          errors={errores.descripcion ?? []}
          autoComplete="off"
        />
        {inicial && (
          <div className="field">
            <label>
              <input
                type="checkbox"
                name="activo"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                aria-invalid={(errores.activo ?? []).length > 0}
              />{' '}
              Categoría activa
            </label>
            {(errores.activo ?? []).map((mensaje) => <p key={mensaje} role="alert">{mensaje}</p>)}
          </div>
        )}
        {errorGeneral && <ErrorMessage>{errorGeneral}</ErrorMessage>}
      </div>
    </FormModal>
  )
}
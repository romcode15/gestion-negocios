import { Loading, EmptyState, ErrorMessage } from '../../../components/feedback/Feedback'
import { usePermisosDelegables } from './usePermisosDelegables'

interface Props {
  seleccionados: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
  errors?: string[]
}

export function PermisosSelector({ seleccionados, onChange, disabled = false, errors = [] }: Props) {
  const { data, error, pending, reintentar } = usePermisosDelegables()

  if (pending) return <Loading>Cargando permisos…</Loading>

  if (error) {
    return (
      <>
        <ErrorMessage>{error.detail}</ErrorMessage>
        <button type="button" onClick={reintentar}>Reintentar</button>
      </>
    )
  }

  if (!data || data.length === 0) return <EmptyState title="No hay permisos delegables" />

  function alternar(id: number) {
    const nuevos = seleccionados.includes(id)
      ? seleccionados.filter((actual) => actual !== id)
      : [...seleccionados, id]
    onChange([...new Set(nuevos)].sort((a, b) => a - b))
  }

  return (
    <fieldset disabled={disabled} aria-invalid={errors.length > 0}>
      <legend>Permisos del rol</legend>
      {data.map((permiso) => (
        <div key={permiso.id}>
          <label>
            <input
              type="checkbox"
              checked={seleccionados.includes(permiso.id)}
              onChange={() => alternar(permiso.id)}
            />{' '}
            {permiso.codigo}
          </label>
        </div>
      ))}
      {errors.map((mensaje) => (
        <p key={mensaje} role="alert">{mensaje}</p>
      ))}
    </fieldset>
  )
}
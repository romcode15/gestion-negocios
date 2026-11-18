import { useId } from 'react'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import type { Rol } from '../../roles/types'
import type { EstadoRoles } from '../seleccion'

type Props = {
  estado: EstadoRoles
  value: number | null
  onSeleccionar: (rol: Rol | null) => void
  errors?: string[]
  disabled?: boolean
}

export function SelectorRoles({ estado, value, onSeleccionar, errors = [], disabled = false }: Props) {
  const fieldId = useId()
  const { opciones, pagina, paginaActual, pendiente, error, puedeListar, onPagina, onReintentar } = estado
  const describedBy = [errors.length ? fieldId + '-errors' : ''].filter(Boolean).join(' ') || undefined

  return <div className="selector-roles">
    {!puedeListar && <p className="feedback" role="note">
      No tienes permiso para listar los roles del negocio. No se lanza la consulta y no se puede seleccionar
      ni resolver el nombre del rol. Coordina con Henry y Romel si el flujo necesita otra decisión de contrato.
    </p>}
    {puedeListar && <>
      {pendiente && <Loading>Cargando roles…</Loading>}
      {!pendiente && error && <ApiFeedback error={error} onRetry={onReintentar} />}
      {!pendiente && !error && pagina?.count === 0 && <EmptyState title="No hay roles">
        <p>Crea un rol en este negocio para poder asignarlo.</p>
      </EmptyState>}
      {opciones.length > 0 && <div className="field">
        <label htmlFor={fieldId}>Rol del negocio</label>
        <select id={fieldId} name="rol_id" required disabled={disabled}
          value={value ?? ''} aria-invalid={errors.length ? true : undefined} aria-describedby={describedBy}
          onChange={(event) => {
            const id = Number(event.target.value)
            onSeleccionar(opciones.find((rol) => rol.id === id) ?? null)
          }}>
          <option value="">Selecciona un rol</option>
          {opciones.map((rol) => <option key={rol.id} value={rol.id}>{rol.nombre}</option>)}
        </select>
        {errors.length > 0 && <ul className="field-errors" id={fieldId + '-errors'}>
          {errors.map((mensaje, indice) => <li key={indice}>{mensaje}</li>)}
        </ul>}
      </div>}
      {pagina && <div className="paginacion">
        <span aria-live="polite">Página {paginaActual} · {pagina.count} role(s)</span>
        <Button disabled={pendiente || paginaActual === 1 || !pagina.previous} onClick={() => onPagina(Math.max(1, paginaActual - 1))}>Anterior</Button>
        <Button disabled={pendiente || !pagina.next} onClick={() => onPagina(paginaActual + 1)}>Siguiente</Button>
      </div>}
    </>}
  </div>
}

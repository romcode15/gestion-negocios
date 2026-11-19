import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { SelectField } from '../../../components/ui/SelectField'
import { Pagination } from '../../../components/ui/Pagination'
import type { Rol } from '../../roles/types'
import type { EstadoRoles } from '../seleccion'
type Props = { estado: EstadoRoles; value: number | null; onSeleccionar: (rol: Rol | null) => void; errors?: string[]; disabled?: boolean }
export function SelectorRoles({ estado, value, onSeleccionar, errors = [], disabled = false }: Props) {
  const { opciones, pagina, paginaActual, pendiente, error, puedeListar, onPagina, onReintentar } = estado
  const seleccionado = estado.catalogo?.find((rol) => rol.id === value)
  const disponibles = seleccionado && !opciones.some((rol) => rol.id === value) ? [...opciones, seleccionado] : opciones
  return <div className="selector-roles">
    {!puedeListar && <p className="feedback" role="note">No tienes permiso para consultar los roles asignables.</p>}
    {puedeListar && <>{pendiente && <Loading>Cargando roles…</Loading>}
      {!pendiente && error && <ApiFeedback error={error} onRetry={onReintentar} />}
      {!pendiente && !error && pagina?.count === 0 && <EmptyState title="No hay roles" />}</>}
    <SelectField name="rol_id" label="Rol del negocio" required disabled={disabled || !puedeListar} errors={errors} value={value ?? ''}
      onChange={(event) => onSeleccionar(disponibles.find((rol) => rol.id === Number(event.target.value)) ?? null)}>
      <option value="">Selecciona un rol</option>{disponibles.map((rol) => <option key={rol.id} value={rol.id}>{rol.nombre}</option>)}
    </SelectField>
    {puedeListar && pagina && <Pagination page={paginaActual} count={pagina.count} next={pagina.next} previous={pagina.previous} pending={pendiente}
      disabled={disabled} onPage={onPagina} label="roles" />}
  </div>
}

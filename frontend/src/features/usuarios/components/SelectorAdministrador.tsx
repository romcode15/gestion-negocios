import { useCallback, useId, useMemo, useState } from 'react'
import type { Pagina } from '../../../api/types'
import { usePermiso } from '../../../app/providers/SessionContext'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import { listarUsuarios } from '../api'
import { conUsuarios, opcionesDe } from '../seleccion'
import type { Usuario } from '../types'

const paginaVacia: Pagina<Usuario> = { count: 0, next: null, previous: null, results: [] }

type Props = {
  value: Usuario | null
  onSeleccionar: (usuario: Usuario | null) => void
  recargarToken?: number
  adicionales?: Usuario[]
  errors?: string[]
  disabled?: boolean
}

export function SelectorAdministrador({ value, onSeleccionar, recargarToken = 0, adicionales = [], errors = [], disabled = false }: Props) {
  const puedeListar = usePermiso('listar_usuarios', 'plataforma')
  const puedeCrear = usePermiso('crear_usuario', 'plataforma')
  const [page, setPage] = useState(1)
  const [porId, setPorId] = useState<Record<number, Usuario>>({})
  const fieldId = useId()

  // Sin permiso no se lanza la consulta: se devuelve una página vacía local.
  // recargarToken solo cambia la identidad de la consulta tras crear una cuenta.
  const cargar = useCallback(({ signal }: ContextoConsulta) => {
    if (!puedeListar) return Promise.resolve(paginaVacia)
    void recargarToken
    return listarUsuarios({ page, signal })
  }, [puedeListar, page, recargarToken])
  const { data, error, pending, reintentar } = useConsultaContexto(cargar)

  // Al salir de una página se conservan sus cuentas en el acumulado; la carga
  // del contexto se reinicia con el montaje de la pantalla al cambiar de sesión.
  function irAPagina(nueva: number) {
    if (data) setPorId((actual) => conUsuarios(actual, data.results))
    setPage(nueva)
  }

  const opciones = useMemo(() => opcionesDe(porId, data?.results ?? [], value, adicionales), [porId, data, value, adicionales])
  const describedBy = [errors.length ? fieldId + '-errors' : ''].filter(Boolean).join(' ') || undefined

  return <section className="selector-administrador">
    <h3>Administrador inicial</h3>
    {!puedeListar && <p className="feedback" role="note">
      {puedeCrear
        ? 'No tienes permiso para listar cuentas. Crea una cuenta nueva y se seleccionará automáticamente como administradora.'
        : 'No tienes permiso para listar ni crear cuentas. Necesitas una cuenta activa para completar el alta del negocio.'}
    </p>}
    {puedeListar && <>
      {pending && <Loading>Cargando cuentas…</Loading>}
      {!pending && error && <ApiFeedback error={error} onRetry={reintentar} />}
      {!pending && !error && data?.count === 0 && <EmptyState title="No hay cuentas">
        <p>Crea una cuenta para poder asignarla como administradora.</p>
      </EmptyState>}
      {opciones.length > 0 && <div className="field">
        <label htmlFor={fieldId}>Cuenta administradora</label>
        <select id={fieldId} name="administrador_id" required disabled={disabled}
          value={value?.id ?? ''} aria-invalid={errors.length ? true : undefined} aria-describedby={describedBy}
          onChange={(event) => {
            const id = Number(event.target.value)
            onSeleccionar(opciones.find((usuario) => usuario.id === id) ?? null)
          }}>
          <option value="">Selecciona una cuenta activa</option>
          {opciones.map((usuario) => <option key={usuario.id} value={usuario.id} disabled={!usuario.is_active}>
            {usuario.username}{usuario.is_active ? '' : ' (inactiva)'}
          </option>)}
        </select>
        {errors.length > 0 && <ul className="field-errors" id={fieldId + '-errors'}>
          {errors.map((mensaje, indice) => <li key={indice}>{mensaje}</li>)}
        </ul>}
      </div>}
      {data && <div className="paginacion">
        <span aria-live="polite">Página {page} · {data.count} cuenta(s)</span>
        <Button disabled={pending || page === 1 || !data.previous} onClick={() => irAPagina(Math.max(1, page - 1))}>Anterior</Button>
        <Button disabled={pending || !data.next} onClick={() => irAPagina(page + 1)}>Siguiente</Button>
      </div>}
    </>}
  </section>
}

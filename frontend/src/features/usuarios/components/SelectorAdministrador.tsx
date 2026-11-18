import { useCallback, useMemo, useState } from 'react'
import type { Pagina } from '../../../api/types'
import { usePermiso } from '../../../app/providers/SessionContext'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { EmptyState, Loading } from '../../../components/feedback/Feedback'
import { Pagination } from '../../../components/ui/Pagination'
import { SelectField } from '../../../components/ui/SelectField'
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
    </>}
        <SelectField label="Cuenta administradora" name="administrador_id" required disabled={disabled}
          value={value?.id ?? ''} errors={errors}
          onChange={(event) => {
            const id = Number(event.target.value)
            onSeleccionar(opciones.find((usuario) => usuario.id === id) ?? null)
          }}>
          <option value="">Selecciona una cuenta activa</option>
          {opciones.map((usuario) => <option key={usuario.id} value={usuario.id} disabled={!usuario.is_active}>
            {usuario.username}{usuario.is_active ? '' : ' (inactiva)'}
          </option>)}
        </SelectField>
      {puedeListar && data && <Pagination page={page} count={data.count} next={data.next} previous={data.previous}
        pending={pending} disabled={disabled} onPage={irAPagina} label="cuentas" />}
  </section>
}

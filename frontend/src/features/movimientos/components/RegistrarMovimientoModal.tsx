import { useCallback, useMemo, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { crearOperacionInventario } from '../../../api/operacionInventario'
import { useSesion } from '../../../app/providers/SessionContext'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Loading } from '../../../components/feedback/Feedback'
import { FormModal } from '../../../components/ui/FormModal'
import { SelectField } from '../../../components/ui/SelectField'
import { TextField } from '../../../components/ui/TextField'
import { aEnteroEscalado, normalizarDecimal } from '../../../lib/decimales'
import { listarProductosOpciones } from '../../productos/api'
import type { ProductoOpcion } from '../../productos/types'
import { registrarMovimiento } from '../api'
import type { Movimiento, RegistrarMovimientoSolicitud } from '../types'

type TipoRegistro = 'entrada' | 'salida'
type Campos = { producto_id: string; cantidad: string; motivo: string }
type Errores = Record<string, string[]>
type EntradaOperacion = Omit<RegistrarMovimientoSolicitud, 'clave_operacion'>

interface Props {
  tipo: TipoRegistro
  negocioId: number | null
  onRegistrado: (movimiento: Movimiento) => void
  onClose: () => void
}

const CAMPOS: (keyof Campos)[] = ['producto_id', 'cantidad', 'motivo']
const OPCIONES = { escala: 3, precision: 14, campo: 'cantidad' } as const
const REINTENTABLES = ['network_error', 'csrf_failed', 'conflict']

// La opción es paginada en el servidor; se acumula por página sin seguir URLs `next`.
async function cargarOpciones(negocioId: number | null, signal: AbortSignal): Promise<ProductoOpcion[]> {
  if (negocioId === null) return []
  const opciones: ProductoOpcion[] = []
  for (let page = 1; page <= 100; page++) {
    signal.throwIfAborted()
    const respuesta = await listarProductosOpciones(negocioId, { page, signal })
    opciones.push(...respuesta.results)
    if (!respuesta.next) return opciones
  }
  throw new ApiException('unknown_error', 'No se pudieron cargar todas las opciones de producto.', {}, 0)
}

export function RegistrarMovimientoModal({ tipo, negocioId, onRegistrado, onClose }: Props) {
  const { store } = useSesion()
  const [campos, setCampos] = useState<Campos>({ producto_id: '', cantidad: '', motivo: '' })
  const [errores, setErrores] = useState<Errores>({})
  const [error, setError] = useState<ApiException | null>(null)
  const [reintentable, setReintentable] = useState(false)
  const [pending, setPending] = useState(false)
  const [solicitud, setSolicitud] = useState<RegistrarMovimientoSolicitud | null>(null)
  const enviando = useRef(false)
  const operacion = useRef(crearOperacionInventario<EntradaOperacion>())
  // Los controles compartidos no exponen `ref` en sus tipos; se localizan por id.
  const productoRef = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() { return document.getElementById('producto_id') },
  }), [])

  const cargar = useCallback(({ signal }: ContextoConsulta) => cargarOpciones(negocioId, signal), [negocioId])
  const consulta = useConsultaContexto(cargar)
  const opciones = useMemo(
    () => (consulta.data ?? []).filter((opcion) => opcion.negocio_id === negocioId),
    [consulta.data, negocioId],
  )
  const producto = opciones.find((opcion) => String(opcion.id) === campos.producto_id)

  function enfocar(campo?: keyof Campos) {
    if (campo) document.getElementById(campo)?.focus()
  }

  function validar(): { solicitud?: RegistrarMovimientoSolicitud; errores: Errores; campo?: keyof Campos } {
    const locales: Errores = {}
    if (!producto || producto.negocio_id !== negocioId) {
      locales.producto_id = ['Selecciona un producto activo del negocio activo.']
    }
    let cantidad = ''
    const texto = campos.cantidad.trim()
    if (!texto) locales.cantidad = ['La cantidad es requerida.']
    else {
      try {
        cantidad = normalizarDecimal(texto, { ...OPCIONES, unidad: producto?.unidad })
        if (aEnteroEscalado(cantidad, { ...OPCIONES, unidad: producto?.unidad }) <= 0n) {
          locales.cantidad = ['La cantidad debe ser mayor que cero.']
        }
      } catch (cause) {
        locales.cantidad = cause instanceof ApiException ? cause.errors.cantidad ?? [cause.detail] : ['La cantidad no es válida.']
      }
    }
    const motivo = campos.motivo.trim()
    if (!motivo) locales.motivo = ['El motivo es requerido.']
    else if (motivo.length > 255) locales.motivo = ['El motivo no puede superar 255 caracteres.']
    const campo = CAMPOS.find((nombre) => locales[nombre]?.length)
    if (campo) return { errores: locales, campo }
    return {
      errores: {},
      solicitud: operacion.current.preparar({
        producto_id: producto!.id, tipo, cantidad, motivo,
      }),
    }
  }

  async function enviar(payload: RegistrarMovimientoSolicitud) {
    if (enviando.current || negocioId === null) return
    setSolicitud(payload)
    enviando.current = true
    setPending(true)
    try {
      const movimiento = await store.enContexto(({ signal }) => registrarMovimiento(negocioId, payload, { signal }))
      onRegistrado(movimiento)
    } catch (cause) {
      if (isAbortError(cause)) return
      const apiError = cause instanceof ApiException ? cause : new ApiException('unknown_error', 'No se pudo registrar el movimiento.')
      setError(apiError)
      setErrores(apiError.errors)
      setReintentable(REINTENTABLES.includes(apiError.code))
      const campo = CAMPOS.find((nombre) => apiError.errors[nombre]?.length)
      if (campo) requestAnimationFrame(() => enfocar(campo))
    } finally {
      enviando.current = false
      setPending(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando.current) return
    const resultado = validar()
    setErrores(resultado.errores)
    setError(null)
    setReintentable(false)
    if (!resultado.solicitud) {
      enfocar(resultado.campo)
      return
    }
    await enviar(resultado.solicitud)
  }

  function reintentar() {
    if (solicitud) void enviar(solicitud)
  }

  return <FormModal
    open
    title={tipo === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}
    description="El tipo de movimiento se fija con la acción elegida; la cantidad es positiva."
    pending={pending}
    actionText="Registrar"
    pendingText="Registrando…"
    onSubmit={submit}
    onClose={() => { if (!pending) onClose() }}
    initialFocusRef={productoRef}
  >
    {consulta.pending && <Loading>Cargando productos activos…</Loading>}
    {consulta.error && <ApiFeedback error={consulta.error} onRetry={consulta.reintentar} />}
    <SelectField id="producto_id" name="producto_id" label="Producto" value={campos.producto_id}
      errors={errores.producto_id} onChange={(event) => setCampos({ ...campos, producto_id: event.target.value })}>
      <option value="">Selecciona un producto</option>
      {opciones.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.sku} — {opcion.nombre}</option>)}
    </SelectField>
    <TextField id="cantidad" name="cantidad" label="Cantidad" inputMode="decimal" value={campos.cantidad}
      hint={producto ? `Unidad: ${producto.unidad}` : 'Selecciona un producto para ver su unidad.'}
      errors={errores.cantidad} onChange={(event) => setCampos({ ...campos, cantidad: event.target.value })} />
    <TextField id="motivo" name="motivo" label="Motivo" value={campos.motivo}
      errors={errores.motivo} onChange={(event) => setCampos({ ...campos, motivo: event.target.value })} />
    {error && <>
      <ApiFeedback error={error} onRetry={reintentable ? reintentar : undefined} />
      {error.code === 'conflict' && <p role="note">Revisa si la operación ya se registró antes de volver a enviarla.</p>}
      {reintentable && <p role="note">La clave y los datos se conservan; el reenvío es manual.</p>}
    </>}
  </FormModal>
}

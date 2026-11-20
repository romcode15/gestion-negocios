import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { crearOperacionInventario } from '../../../api/operacionInventario'
import { useSesion } from '../../../app/providers/SessionContext'
import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { ApiFeedback } from '../../../components/feedback/ApiFeedback'
import { Loading } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import { FormModal } from '../../../components/ui/FormModal'
import { SelectField } from '../../../components/ui/SelectField'
import { TextField } from '../../../components/ui/TextField'
import { aEnteroEscalado, normalizarDecimal } from '../../../lib/decimales'
import { obtenerExistencia } from '../../existencias/api'
import type { Existencia } from '../../existencias/types'
import { listarProductosOpciones } from '../../productos/api'
import type { ProductoOpcion } from '../../productos/types'
import { registrarAjuste } from '../api'
import type { Movimiento, RegistrarAjusteSolicitud } from '../types'

type Campos = { producto_id: string; stock_objetivo: string; motivo: string }
type Errores = Record<string, string[]>
type EntradaAjuste = Omit<RegistrarAjusteSolicitud, 'clave_operacion'>

interface Props {
  negocioId: number | null
  onAjustado: (movimiento: Movimiento) => void
  onClose: () => void
}

const CAMPOS: (keyof Campos)[] = ['producto_id', 'stock_objetivo', 'motivo']
const OPCIONES = { escala: 3, precision: 14, campo: 'stock_objetivo' } as const
const REINTENTABLES = ['network_error', 'csrf_failed']

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

export function AjusteInventarioModal({ negocioId, onAjustado, onClose }: Props) {
  const { store, revision } = useSesion()
  const [campos, setCampos] = useState<Campos>({ producto_id: '', stock_objetivo: '', motivo: '' })
  const [errores, setErrores] = useState<Errores>({})
  const [error, setError] = useState<ApiException | null>(null)
  const [reintentable, setReintentable] = useState(false)
  const [conflicto, setConflicto] = useState(false)
  const [pending, setPending] = useState(false)
  const [solicitud, setSolicitud] = useState<RegistrarAjusteSolicitud | null>(null)
  const enviando = useRef(false)
  const operacion = useRef(crearOperacionInventario<EntradaAjuste>())
  const contexto = useRef<string | null>(null)
  // Los controles compartidos no exponen `ref` en sus tipos; se localizan por id.
  const productoRef = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() { return document.getElementById('producto_id') },
  }), [])

  // Un cambio de negocio o revisión descarta la operación y cualquier versión anterior.
  useEffect(() => {
    const actual = negocioId === null ? 'sin-negocio:' + revision : negocioId + ':' + revision
    if (contexto.current === actual) return
    if (contexto.current === null) { contexto.current = actual; return }
    contexto.current = actual
    operacion.current.nueva()
    setCampos((valor) => ({ ...valor, producto_id: '', stock_objetivo: '' }))
    setSolicitud(null)
    setError(null)
    setErrores({})
    setReintentable(false)
    setConflicto(false)
  }, [negocioId, revision])

  const cargar = useCallback(({ signal }: ContextoConsulta) => cargarOpciones(negocioId, signal), [negocioId])
  const consulta = useConsultaContexto(cargar)
  const opciones = useMemo(
    () => (consulta.data ?? []).filter((opcion) => opcion.negocio_id === negocioId),
    [consulta.data, negocioId],
  )
  const producto = opciones.find((opcion) => String(opcion.id) === campos.producto_id)
  const productoId = producto?.id ?? null

  // La identidad de `cargarSaldo` cambia con el producto: el hook cancela la consulta anterior.
  const cargarSaldo = useCallback(({ signal }: ContextoConsulta) => {
    if (negocioId === null || productoId === null) return Promise.resolve(null)
    return obtenerExistencia(negocioId, productoId, { signal })
  }, [negocioId, productoId])
  const consultaSaldo = useConsultaContexto(cargarSaldo)
  const saldo: Existencia | null =
    consultaSaldo.data && consultaSaldo.data.negocio_id === negocioId && consultaSaldo.data.producto.id === productoId
      ? consultaSaldo.data : null

  function enfocar(campo?: keyof Campos) {
    if (campo) document.getElementById(campo)?.focus()
  }

  function cambiarProducto(valor: string) {
    if (valor === campos.producto_id) return
    operacion.current.nueva()
    setCampos((anterior) => ({ ...anterior, producto_id: valor, stock_objetivo: '' }))
    setSolicitud(null)
    setError(null)
    setErrores({})
    setReintentable(false)
    setConflicto(false)
  }

  function validar(): { solicitud?: RegistrarAjusteSolicitud; errores: Errores; campo?: keyof Campos } {
    const locales: Errores = {}
    if (!producto || producto.negocio_id !== negocioId) {
      locales.producto_id = ['Selecciona un producto activo del negocio activo.']
    } else if (!saldo) {
      locales.producto_id = ['Carga el saldo del producto antes de ajustar.']
    }
    const opcionesDecimal = { ...OPCIONES, unidad: producto?.unidad }
    let stockObjetivo = ''
    const texto = campos.stock_objetivo.trim()
    if (!texto) locales.stock_objetivo = ['El stock objetivo es requerido.']
    else {
      try {
        stockObjetivo = normalizarDecimal(texto, opcionesDecimal)
        const objetivo = aEnteroEscalado(stockObjetivo, opcionesDecimal)
        if (objetivo < 0n) locales.stock_objetivo = ['El stock objetivo no puede ser negativo.']
        else if (saldo && aEnteroEscalado(saldo.cantidad, opcionesDecimal) === objetivo) {
          locales.stock_objetivo = ['El objetivo debe cambiar el saldo.']
        }
      } catch (cause) {
        locales.stock_objetivo = cause instanceof ApiException ? cause.errors.stock_objetivo ?? [cause.detail] : ['El stock objetivo no es válido.']
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
        producto_id: producto!.id,
        stock_objetivo: stockObjetivo,
        version_esperada: saldo!.version,
        motivo,
      }),
    }
  }

  async function enviar(payload: RegistrarAjusteSolicitud) {
    if (enviando.current || negocioId === null) return
    setSolicitud(payload)
    enviando.current = true
    setPending(true)
    try {
      const movimiento = await store.enContexto(({ signal }) => registrarAjuste(negocioId, payload, { signal }))
      onAjustado(movimiento)
    } catch (cause) {
      if (isAbortError(cause)) return
      const apiError = cause instanceof ApiException ? cause : new ApiException('unknown_error', 'No se pudo registrar el ajuste.')
      setError(apiError)
      setErrores(apiError.errors)
      setReintentable(REINTENTABLES.includes(apiError.code))
      setConflicto(apiError.code === 'conflict')
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
    setConflicto(false)
    if (!resultado.solicitud) {
      enfocar(resultado.campo)
      return
    }
    await enviar(resultado.solicitud)
  }

  function reintentar() {
    if (solicitud) void enviar(solicitud)
  }

  function actualizarSaldo() {
    setError(null)
    setErrores({})
    setConflicto(false)
    setReintentable(false)
    consultaSaldo.reintentar()
  }

  return <FormModal
    open
    title="Ajustar inventario"
    description="Define el stock objetivo final; el servidor calcula el delta con el saldo bloqueado."
    pending={pending}
    actionText="Registrar ajuste"
    pendingText="Registrando…"
    onSubmit={submit}
    onClose={() => { if (!pending) onClose() }}
    initialFocusRef={productoRef}
  >
    {consulta.pending && <Loading>Cargando productos activos…</Loading>}
    {consulta.error && <ApiFeedback error={consulta.error} onRetry={consulta.reintentar} />}
    <SelectField id="producto_id" name="producto_id" label="Producto" value={campos.producto_id}
      errors={errores.producto_id} onChange={(event) => cambiarProducto(event.target.value)}>
      <option value="">Selecciona un producto</option>
      {opciones.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.sku} — {opcion.nombre}</option>)}
    </SelectField>
    {producto && <>
      {consultaSaldo.pending && <Loading>Cargando saldo actual…</Loading>}
      {consultaSaldo.error && <ApiFeedback error={consultaSaldo.error} onRetry={consultaSaldo.reintentar} />}
      {saldo && <p className="feedback" role="note">
        Saldo actual: {saldo.cantidad} {saldo.producto.unidad}. Versión: {saldo.version}.
      </p>}
    </>}
    <TextField id="stock_objetivo" name="stock_objetivo" label="Stock objetivo" inputMode="decimal"
      value={campos.stock_objetivo}
      hint={producto ? `Unidad: ${producto.unidad}. Es el saldo final, no la cantidad a sumar o restar.` : 'Selecciona un producto para ver su unidad.'}
      errors={errores.stock_objetivo} onChange={(event) => setCampos({ ...campos, stock_objetivo: event.target.value })} />
    <TextField id="motivo" name="motivo" label="Motivo" value={campos.motivo}
      errors={errores.motivo} onChange={(event) => setCampos({ ...campos, motivo: event.target.value })} />
    {error && <>
      <ApiFeedback error={error} onRetry={reintentable ? reintentar : undefined} />
      {conflicto && <p role="note">El saldo o la versión cambiaron. Actualiza el saldo y vuelve a enviar; se generará una nueva clave.</p>}
      {reintentable && <p role="note">La clave y los datos se conservan; el reenvío es manual.</p>}
    </>}
    {conflicto && <Button type="button" onClick={actualizarSaldo} pending={consultaSaldo.pending}
      pendingLabel="Actualizando…">Actualizar saldo</Button>}
  </FormModal>
}

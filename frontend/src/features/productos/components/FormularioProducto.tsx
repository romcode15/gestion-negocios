import { useEffect, useRef, useState } from 'react'
import { ApiException, isAbortError } from '../../../api/errors'
import { useSesion } from '../../../app/providers/SessionContext'
import { ErrorMessage } from '../../../components/feedback/Feedback'
import { FormModal } from '../../../components/ui/FormModal'
import { SelectField } from '../../../components/ui/SelectField'
import { TextField } from '../../../components/ui/TextField'
import { actualizarProducto, crearProducto } from '../api'
import type { ActualizarProductoSolicitud, Producto, Unidad } from '../types'
import { normalizarSku, validarProducto } from '../validacion'
import { SelectorCategoria } from './SelectorCategoria'

interface Props {
  inicial: Producto | null
  onClose: () => void
  onGuardado: (producto: Producto) => void
}

export function FormularioProducto({ inicial, onClose, onGuardado }: Props) {
  const { negocioId } = useSesion()
  const [categoriaId, setCategoriaId] = useState<number | null>(inicial?.categoria_id ?? null)
  const [sku, setSku] = useState(inicial?.sku ?? '')
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '')
  const [unidad, setUnidad] = useState<Unidad>(inicial?.unidad ?? 'unidad')
  const [precio, setPrecio] = useState(inicial?.precio_venta ?? '')
  const [minimo, setMinimo] = useState(inicial?.stock_minimo ?? '0.000')
  const [activo, setActivo] = useState(inicial?.activo ?? true)
  const [errores, setErrores] = useState<Record<string, string[]>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const enviando = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const contenedor = useRef<HTMLDivElement>(null)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (Object.keys(errores).length > 0) {
      contenedor.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
  }, [errores])

  async function enviar() {
    if (enviando.current || negocioId === null) return
    setErrorGeneral(null)
    const invalidos = validarProducto({
      categoria_id: categoriaId, sku, nombre, descripcion, unidad, precio_venta: precio, stock_minimo: minimo,
    })
    if (Object.keys(invalidos).length > 0) { setErrores(invalidos); return }
    setErrores({})

    const datos = {
      categoria_id: categoriaId as number,
      sku: normalizarSku(sku),
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      unidad,
      precio_venta: precio.trim(),
      stock_minimo: minimo.trim() || '0',
    }

    let cambios: ActualizarProductoSolicitud | null = null
    if (inicial) {
      cambios = {}
      if (datos.categoria_id !== inicial.categoria_id) cambios.categoria_id = datos.categoria_id
      if (datos.sku !== inicial.sku) cambios.sku = datos.sku
      if (datos.nombre !== inicial.nombre) cambios.nombre = datos.nombre
      if (datos.descripcion !== inicial.descripcion) cambios.descripcion = datos.descripcion
      if (datos.unidad !== inicial.unidad) cambios.unidad = datos.unidad
      if (datos.precio_venta !== inicial.precio_venta) cambios.precio_venta = datos.precio_venta
      if (datos.stock_minimo !== inicial.stock_minimo) cambios.stock_minimo = datos.stock_minimo
      if (activo !== inicial.activo) cambios.activo = activo
      if (Object.keys(cambios).length === 0) { onClose(); return }
    }

    enviando.current = true
    controller.current?.abort()
    const actual = new AbortController()
    controller.current = actual
    setPending(true)
    try {
      const guardado = inicial && cambios
        ? await actualizarProducto(negocioId, inicial.id, cambios, { signal: actual.signal })
        : await crearProducto(negocioId, datos, { signal: actual.signal })
      if (actual.signal.aborted) return
      onGuardado(guardado)
    } catch (error) {
      if (actual.signal.aborted || isAbortError(error)) return
      if (error instanceof ApiException) {
        setErrores(error.errors ?? {})
        setErrorGeneral(error.detail)
      } else {
        setErrorGeneral('No se pudo guardar el producto.')
      }
    } finally {
      enviando.current = false
      if (!actual.signal.aborted) setPending(false)
    }
  }

  return (
    <FormModal
      open
      title={inicial ? 'Editar producto' : 'Crear producto'}
      onClose={onClose}
      onSubmit={() => void enviar()}
      pending={pending}
      actionText={inicial ? 'Guardar cambios' : 'Crear producto'}
    >
      <div ref={contenedor}>
        <TextField label="SKU" name="sku" value={sku} onChange={(e) => setSku(e.target.value)}
          errors={errores.sku ?? []} required autoComplete="off" hint="Se guarda en mayúsculas." />
        <TextField label="Nombre" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
          errors={errores.nombre ?? []} required autoComplete="off" />
        <TextField label="Descripción" name="descripcion" value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)} errors={errores.descripcion ?? []} autoComplete="off" />
        <SelectorCategoria value={categoriaId} nombreActual={inicial?.categoria_nombre}
          onChange={setCategoriaId} errors={errores.categoria_id} />
        <SelectField label="Unidad" name="unidad" value={unidad} errors={errores.unidad}
          onChange={(e) => setUnidad(e.target.value as Unidad)}>
          <option value="unidad">Unidad</option>
          <option value="kg">Kilogramo (kg)</option>
          <option value="litro">Litro</option>
        </SelectField>
        <TextField label="Precio de venta" name="precio_venta" inputMode="decimal" value={precio}
          onChange={(e) => setPrecio(e.target.value)} errors={errores.precio_venta ?? []} required
          hint="Hasta 2 decimales, con punto." autoComplete="off" />
        <TextField label="Stock mínimo" name="stock_minimo" inputMode="decimal" value={minimo}
          onChange={(e) => setMinimo(e.target.value)} errors={errores.stock_minimo ?? []}
          hint="Hasta 3 decimales; entero si la unidad es «unidad»." autoComplete="off" />
        {inicial && (
          <div className="field">
            <label>
              <input type="checkbox" name="activo" checked={activo} onChange={(e) => setActivo(e.target.checked)}
                aria-invalid={(errores.activo ?? []).length > 0} />{' '}Producto activo
            </label>
            {(errores.activo ?? []).map((m) => <p key={m} role="alert">{m}</p>)}
          </div>
        )}
        {errorGeneral && <ErrorMessage>{errorGeneral}</ErrorMessage>}
      </div>
    </FormModal>
  )
}
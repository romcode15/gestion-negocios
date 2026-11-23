import { useState } from 'react'
import type { FormEvent } from 'react'
import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import { AccessDenied, EmptyState } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/TextField'
import { ListaProductos } from '../components/ListaProductos'
import { ProductoModal } from '../components/ProductoModal'
import type { ModoModal } from '../components/ProductoModal'

export function ProductosPage() {
  const { negocioId } = useSesion()
  return (
    <section>
      <h1>Productos</h1>
      {negocioId === null
        ? <EmptyState title="Sin negocio activo">Selecciona un negocio para ver sus productos.</EmptyState>
        : <ProductosNegocio key={negocioId} />}
    </section>
  )
}

function ProductosNegocio() {
  const puedeListar = usePermiso('listar_productos')
  const puedeCrear = usePermiso('crear_producto')
  const puedeEditar = usePermiso('editar_producto')
  const [modal, setModal] = useState<ModoModal | null>(null)
  const [refresco, setRefresco] = useState(0)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [idTexto, setIdTexto] = useState('')
  const [errorId, setErrorId] = useState<string[]>([])

  if (!puedeListar && !puedeCrear && !puedeEditar) return <AccessDenied />

  function abrirPorId(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const id = Number(idTexto)
    if (!Number.isInteger(id) || id <= 0) { setErrorId(['Escribe un ID numérico mayor que cero.']); return }
    setErrorId([])
    setMensaje(null)
    setModal({ modo: 'editar', id })
  }

  return (
    <>
      {puedeCrear && (
        <p><Button type="button" onClick={() => { setMensaje(null); setModal({ modo: 'crear' }) }}>Crear producto</Button></p>
      )}
      {mensaje && <p role="status">{mensaje}</p>}

      {puedeListar
        ? <ListaProductos refresco={refresco}
            onEditar={puedeEditar ? (p) => { setMensaje(null); setModal({ modo: 'editar', id: p.id }) } : null} />
        : puedeEditar && (
          <form onSubmit={abrirPorId}>
            <p>No tienes permiso para listar productos. Puedes editar uno si conoces su ID.</p>
            <TextField label="ID del producto" name="producto_id" inputMode="numeric"
              value={idTexto} onChange={(e) => setIdTexto(e.target.value)} errors={errorId} autoComplete="off" />
            <Button type="submit">Abrir producto</Button>
          </form>
        )}

      {modal && (
        <ProductoModal
          estado={modal}
          onClose={() => setModal(null)}
          onGuardado={(producto) => {
            setModal(null)
            setMensaje(`Producto «${producto.nombre}» guardado correctamente.`)
            setRefresco((n) => n + 1)
          }}
        />
      )}
    </>
  )
}

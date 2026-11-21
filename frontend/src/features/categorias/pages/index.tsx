import { useState } from 'react'
import { usePermiso, useSesion } from '../../../app/providers/SessionContext'
import { AccessDenied, EmptyState } from '../../../components/feedback/Feedback'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/TextField'
import { CategoriaModal } from '../components/CategoriaModal'
import type { ModoModal } from '../components/CategoriaModal'
import { ListaCategorias } from '../components/ListaCategorias'

export function CategoriasPage() {
  const { negocioId } = useSesion()
  return (
    <section>
      <h1>Categorías</h1>
      {negocioId === null
        ? <EmptyState title="Sin negocio activo">Selecciona un negocio para ver sus categorías.</EmptyState>
        // key: al cambiar de negocio se reinician modal, filtros, páginas y mensajes.
        : <CategoriasNegocio key={negocioId} />}
    </section>
  )
}

function CategoriasNegocio() {
  const puedeListar = usePermiso('listar_categorias')
  const puedeCrear = usePermiso('crear_categoria')
  const puedeEditar = usePermiso('editar_categoria')
  const [modal, setModal] = useState<ModoModal | null>(null)
  const [refresco, setRefresco] = useState(0)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [idTexto, setIdTexto] = useState('')
  const [errorId, setErrorId] = useState<string[]>([])

  if (!puedeListar && !puedeCrear && !puedeEditar) return <AccessDenied />

  function abrirPorId(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const id = Number(idTexto)
    if (!Number.isInteger(id) || id <= 0) {
      setErrorId(['Escribe un ID numérico mayor que cero.'])
      return
    }
    setErrorId([])
    setMensaje(null)
    setModal({ modo: 'editar', id })
  }

  return (
    <>
      {puedeCrear && (
        <p>
          <Button type="button" onClick={() => { setMensaje(null); setModal({ modo: 'crear' }) }}>Crear categoría</Button>
        </p>
      )}
      {mensaje && <p role="status">{mensaje}</p>}

      {puedeListar
        ? <ListaCategorias key={refresco}
            onEditar={puedeEditar ? (c) => { setMensaje(null); setModal({ modo: 'editar', id: c.id }) } : null} />
        : puedeEditar && (
          <form onSubmit={abrirPorId}>
            <p>No tienes permiso para listar categorías. Puedes editar una categoría si conoces su ID.</p>
            <TextField label="ID de la categoría" name="categoria_id" inputMode="numeric"
              value={idTexto} onChange={(e) => setIdTexto(e.target.value)} errors={errorId} autoComplete="off" />
            <Button type="submit">Abrir categoría</Button>
          </form>
        )}

      {modal && (
        <CategoriaModal
          estado={modal}
          onClose={() => setModal(null)}
          onGuardado={(categoria) => {
            setModal(null)
            setMensaje(`Categoría «${categoria.nombre}» guardada correctamente.`)
            setRefresco((n) => n + 1) // vuelve a pedir la lista al servidor
          }}
        />
      )}
    </>
  )
}
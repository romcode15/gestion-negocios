import { useConsultaContexto } from '../../../app/providers/useConsultaContexto'
import type { ContextoConsulta } from '../../../app/providers/useConsultaContexto'
import { listarPermisos } from '../api'
import type { Permiso } from '../types'

const MAX_PAGINAS = 100

// Está fuera del componente para que su referencia sea estable.
async function cargarTodos({ negocioId, signal }: ContextoConsulta): Promise<Permiso[]> {
  if (negocioId === null) return []
  const porId = new Map<number, Permiso>()
  let page = 1
  let hayMas = true
  while (hayMas && page <= MAX_PAGINAS) {
    const pagina = await listarPermisos(negocioId, { page, signal })
    for (const permiso of pagina.results) porId.set(permiso.id, permiso)
    hayMas = pagina.next !== null
    page++
  }
  return [...porId.values()].filter((permiso) => permiso.ambito === 'negocio')
}

export function usePermisosDelegables() {
  return useConsultaContexto(cargarTodos)
}
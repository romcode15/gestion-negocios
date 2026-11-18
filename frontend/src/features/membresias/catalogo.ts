import { listarRoles } from '../roles/api'
import type { Pagina } from '../../api/types'
import type { Rol } from '../roles/types'
export async function cargarPaginasRoles(negocioId: number, signal?: AbortSignal): Promise<Pagina<Rol>[]> {
  const paginas: Pagina<Rol>[] = []
  for (let page = 1; ; page++) {
    signal?.throwIfAborted()
    const resultado = await listarRoles(negocioId, { page, signal })
    paginas.push({ ...resultado, results: resultado.results.filter((rol) => rol.negocio_id === negocioId) })
    if (!resultado.next) return paginas
  }
}

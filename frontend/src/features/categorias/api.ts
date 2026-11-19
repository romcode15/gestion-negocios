import { request, contextoNegocio } from '../../api/client'
import { rutaConsulta, idRuta } from '../../api/query'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { Categoria, CategoriaOpcion, FiltrosCategorias, CrearCategoriaSolicitud, ActualizarCategoriaSolicitud } from './types'
export function listarCategorias(negocioId: number, { signal, page = 1, ...filters }: ListOptions & FiltrosCategorias = {}): Promise<Pagina<Categoria>> {
  return request({ method: 'GET', path: rutaConsulta(contextoNegocio(negocioId) + '/categorias/', { page, ...filters }), signal })
}
export function obtenerCategoria(negocioId: number, id: number, options: RequestOptions = {}): Promise<Categoria> {
  return request({ method: 'GET', path: contextoNegocio(negocioId) + '/categorias/' + idRuta(id) + '/', ...options })
}
export function crearCategoria(negocioId: number, input: CrearCategoriaSolicitud, options: RequestOptions = {}): Promise<Categoria> {
  return request({ method: 'POST', path: contextoNegocio(negocioId) + '/categorias/', body: input, ...options })
}
export function actualizarCategoria(negocioId: number, id: number, input: ActualizarCategoriaSolicitud, options: RequestOptions = {}): Promise<Categoria> {
  return request({ method: 'PATCH', path: contextoNegocio(negocioId) + '/categorias/' + idRuta(id) + '/', body: input, ...options })
}
export function listarCategoriasOpciones(negocioId: number, { signal, page = 1, ...filters }: ListOptions & { search?: string } = {}): Promise<Pagina<CategoriaOpcion>> {
  return request({ method: 'GET', path: rutaConsulta(contextoNegocio(negocioId) + '/categorias/opciones/', { page, ...filters }), signal })
}

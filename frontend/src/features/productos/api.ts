import { request, contextoNegocio } from '../../api/client'
import { rutaConsulta, idRuta } from '../../api/query'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { Producto, ProductoOpcion, FiltrosProductos, CrearProductoSolicitud, ActualizarProductoSolicitud } from './types'
export function listarProductos(negocioId: number, { signal, page = 1, ...filters }: ListOptions & FiltrosProductos = {}): Promise<Pagina<Producto>> {
  return request({ method: 'GET', path: rutaConsulta(contextoNegocio(negocioId) + '/productos/', { page, ...filters }), signal })
}
export function obtenerProducto(negocioId: number, id: number, options: RequestOptions = {}): Promise<Producto> {
  return request({ method: 'GET', path: contextoNegocio(negocioId) + '/productos/' + idRuta(id) + '/', ...options })
}
export function crearProducto(negocioId: number, input: CrearProductoSolicitud, options: RequestOptions = {}): Promise<Producto> {
  return request({ method: 'POST', path: contextoNegocio(negocioId) + '/productos/', body: input, ...options })
}
export function actualizarProducto(negocioId: number, id: number, input: ActualizarProductoSolicitud, options: RequestOptions = {}): Promise<Producto> {
  return request({ method: 'PATCH', path: contextoNegocio(negocioId) + '/productos/' + idRuta(id) + '/', body: input, ...options })
}
export function listarProductosOpciones(negocioId: number, { signal, page = 1, ...filters }: ListOptions & { search?: string } = {}): Promise<Pagina<ProductoOpcion>> {
  return request({ method: 'GET', path: rutaConsulta(contextoNegocio(negocioId) + '/productos/opciones/', { page, ...filters }), signal })
}

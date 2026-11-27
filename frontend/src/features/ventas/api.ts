import { request, contextoNegocio } from '../../api/client'
import { rutaConsulta, idRuta } from '../../api/query'
import type { ListOptions, RequestOptions } from '../../api/contracts'
import type { Pagina } from '../../api/types'
import type { AnularVentaSolicitud, FiltrosProductosVenta, FiltrosVentas, MovimientoVenta, RegistrarVentaSolicitud, VentaDetalle, VentaProductoOpcion, VentaResumen } from './types'

function base(negocioId: number) { return contextoNegocio(idRuta(negocioId)) + '/ventas/' }
export function listarProductosVentaOpciones(negocioId: number, { signal, page = 1, ...filters }: ListOptions & FiltrosProductosVenta = {}): Promise<Pagina<VentaProductoOpcion>> {
  return request({ method: 'GET', path: rutaConsulta(base(negocioId) + 'productos/opciones/', { page, ...filters }), signal })
}
export function obtenerProductoVenta(negocioId: number, productoId: number, options: RequestOptions = {}): Promise<VentaProductoOpcion> {
  return request({ method: 'GET', path: base(negocioId) + 'productos/' + idRuta(productoId) + '/', ...options })
}
export function registrarVenta(negocioId: number, input: RegistrarVentaSolicitud, options: RequestOptions = {}): Promise<VentaDetalle> {
  return request({ method: 'POST', path: base(negocioId), body: input, ...options })
}
export function listarVentas(negocioId: number, { signal, page = 1, ...filters }: ListOptions & FiltrosVentas = {}): Promise<Pagina<VentaResumen>> {
  return request({ method: 'GET', path: rutaConsulta(base(negocioId), { page, ...filters }), signal })
}
export function obtenerVenta(negocioId: number, ventaId: number, options: RequestOptions = {}): Promise<VentaDetalle> {
  return request({ method: 'GET', path: base(negocioId) + idRuta(ventaId) + '/', ...options })
}
export function anularVenta(negocioId: number, ventaId: number, input: AnularVentaSolicitud, options: RequestOptions = {}): Promise<VentaDetalle> {
  return request({ method: 'POST', path: base(negocioId) + idRuta(ventaId) + '/anulacion/', body: input, ...options })
}
export function listarMovimientosVenta(negocioId: number, ventaId: number, { page = 1, signal }: ListOptions = {}): Promise<Pagina<MovimientoVenta>> {
  return request({ method: 'GET', path: rutaConsulta(base(negocioId) + idRuta(ventaId) + '/movimientos/', { page }), signal })
}

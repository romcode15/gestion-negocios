import type { Categoria } from '../../features/categorias/types'
import type { Producto, Unidad } from '../../features/productos/types'
import type { TipoMovimiento } from '../../features/movimientos/types'
export const permisosFase2 = ['listar_categorias', 'crear_categoria', 'editar_categoria', 'listar_productos', 'crear_producto', 'editar_producto', 'consultar_existencias', 'registrar_entrada', 'registrar_salida', 'ajustar_inventario', 'listar_movimientos']
export interface SaldoMock { id: number; negocio_id: number; producto_id: number; cantidad: string; version: number }
export interface MovimientoMock { id: number; negocio_id: number; producto_id: number; usuario_id: number; tipo: TipoMovimiento; cantidad: string; saldo_anterior: string; saldo_posterior: string; motivo: string; clave_operacion: string; creado_en: string }
export interface EstadoFase2 { categorias: Categoria[]; productos: Omit<Producto, 'categoria_nombre'>[]; saldos: SaldoMock[]; movimientos: MovimientoMock[]; operaciones: Record<string, { huella: string; movimiento_id: number }> }
export function crearDatosFase2(): EstadoFase2 {
  const categorias: Categoria[] = [
    { id: 1, negocio_id: 1, nombre: 'General', descripcion: '', activo: true },
    { id: 2, negocio_id: 1, nombre: 'Archivo', descripcion: 'Categoría inactiva', activo: false },
    { id: 3, negocio_id: 2, nombre: 'General', descripcion: '', activo: true },
    { id: 4, negocio_id: 1, nombre: 'Alimentos', descripcion: '', activo: true },
  ]
  const definitions: [number, number, number, string, string, Unidad, string, string, boolean][] = [
    [1, 1, 1, 'COMUN-01', 'Artículo común', 'unidad', '12.50', '2.000', true],
    [2, 1, 4, 'PESO-01', 'Producto por peso', 'kg', '3.25', '1.500', true],
    [3, 1, 2, 'LIQ-01', 'Producto archivado', 'litro', '4.00', '0.000', false],
    [4, 2, 3, 'COMUN-01', 'Artículo común', 'kg', '8.00', '5.000', true],
  ]
  const productos = definitions.map(([id, negocio_id, categoria_id, sku, nombre, unidad, precio_venta, stock_minimo, activo]) => ({ id, negocio_id, categoria_id, sku, nombre, descripcion: '', unidad, precio_venta, stock_minimo, activo }))
  const saldos = productos.map((p) => ({ id: p.id, negocio_id: p.negocio_id, producto_id: p.id, cantidad: p.id === 1 ? '5.000' : p.id === 3 ? '2.000' : p.id === 4 ? '3.500' : '0.000', version: p.id === 2 ? 0 : 1 }))
  const movimientos: MovimientoMock[] = saldos.filter((s) => s.version > 0).map((s, index) => ({
    id: index + 1, negocio_id: s.negocio_id, producto_id: s.producto_id, usuario_id: s.negocio_id === 1 ? 2 : 3, tipo: 'entrada',
    cantidad: s.cantidad, saldo_anterior: '0.000', saldo_posterior: s.cantidad, motivo: 'Carga inicial de demostración',
    clave_operacion: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), creado_en: '2026-01-01T10:00:00.000Z',
  }))
  const operaciones: EstadoFase2['operaciones'] = {}
  for (const m of movimientos) operaciones[m.negocio_id + ':' + m.clave_operacion] = {
    movimiento_id: m.id,
    huella: JSON.stringify({ actor: m.usuario_id, producto_id: m.producto_id, tipo: 'entrada', cantidad: m.cantidad, motivo: m.motivo }),
  }
  return { categorias, productos, saldos, movimientos, operaciones }
}

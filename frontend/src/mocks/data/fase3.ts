import type { EstadoFase2 } from './fase2'
import type { AnulacionVenta, DetalleVenta, EstadoVenta } from '../../features/ventas/types'
export const permisosFase3 = ['registrar_venta', 'listar_ventas', 'anular_venta']
export interface VentaMock { id: number; negocio_id: number; estado: EstadoVenta; total: string; vendedor_id: number; creado_en: string; clave_operacion: string; observaciones: string; detalles: DetalleVenta[]; anulacion: (Omit<AnulacionVenta, 'usuario'> & { usuario_id: number }) | null }
export interface VinculoVentaMock { venta_id: number; detalle_id: number; operacion: 'venta' | 'anulacion'; movimiento_id: number }
export interface EstadoVentasMock { ventas: VentaMock[]; vinculos: VinculoVentaMock[]; registros: Record<string, { huella: string; venta_id: number }>; anulaciones: Record<string, { huella: string; venta_id: number }> }
const uuid = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0')
export function crearDatosFase3(inventario: EstadoFase2): EstadoVentasMock {
  // Ferretería: antecedentes coherentes sin cambiar el saldo actual de fase 2.
  // Tienda sigue sin ventas y conserva íntegra su semilla anterior.
  const producto = inventario.productos.find((p) => p.id === 4)!
  const ventas: VentaMock[] = [1, 2].map((id) => ({ id, negocio_id: 2, estado: id === 1 ? 'confirmada' : 'anulada', total: id === 1 ? '2.00' : '4.00', vendedor_id: 3,
    creado_en: `2025-12-31T${id === 1 ? '11' : '12'}:00:00.000Z`, clave_operacion: uuid(id), observaciones: 'Venta de demostración ' + id,
    detalles: [{ id, producto_id: 4, sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad,
      cantidad: id === 1 ? '0.250' : '0.500', precio_unitario: '8.00', subtotal: id === 1 ? '2.00' : '4.00' }],
    anulacion: id === 1 ? null : { id: 1, usuario_id: 3, motivo: 'Anulación de demostración', clave_operacion: uuid(3), creado_en: '2025-12-31T13:00:00.000Z' },
  }))
  const historical = [
    { id: 4, tipo: 'entrada' as const, cantidad: '0.750', saldo_anterior: '0.000', saldo_posterior: '0.750', hora: '10' },
    { id: 5, tipo: 'salida' as const, cantidad: '-0.250', saldo_anterior: '0.750', saldo_posterior: '0.500', hora: '11' },
    { id: 6, tipo: 'salida' as const, cantidad: '-0.500', saldo_anterior: '0.500', saldo_posterior: '0.000', hora: '12' },
    { id: 7, tipo: 'entrada' as const, cantidad: '0.500', saldo_anterior: '0.000', saldo_posterior: '0.500', hora: '13' },
  ]
  inventario.movimientos.push(...historical.map(({ hora, ...m }) => ({ ...m, negocio_id: 2, producto_id: 4, usuario_id: 3,
    motivo: 'Antecedente de venta de demostración', clave_operacion: uuid(10 + m.id), creado_en: `2025-12-31T${hora}:00:00.000Z` })))
  for (const m of inventario.movimientos.filter((m) => m.id >= 4)) {
    inventario.operaciones['2:' + m.clave_operacion] = { movimiento_id: m.id,
      huella: JSON.stringify({ actor: m.usuario_id, producto_id: m.producto_id, tipo: m.tipo,
        cantidad: m.cantidad.startsWith('-') ? m.cantidad.slice(1) : m.cantidad, motivo: m.motivo }) }
  }
  const initial = inventario.movimientos.find((m) => m.id === 3)!
  initial.cantidad = '3.000'; initial.saldo_anterior = '0.500'
  inventario.operaciones['2:' + initial.clave_operacion].huella = JSON.stringify({ actor: 3, producto_id: 4, tipo: 'entrada', cantidad: initial.cantidad, motivo: initial.motivo })
  inventario.saldos.find((s) => s.producto_id === 4)!.version = 5
  const registros: EstadoVentasMock['registros'] = {}
  for (const venta of ventas) registros['2:' + venta.clave_operacion] = { venta_id: venta.id, huella: JSON.stringify({ actor: 3, observaciones: venta.observaciones,
    detalles: venta.detalles.map((d) => ({ producto_id: d.producto_id, cantidad: d.cantidad, precio_unitario_esperado: d.precio_unitario })) }) }
  return { ventas, registros, anulaciones: { ['2:' + uuid(3)]: { venta_id: 2, huella: JSON.stringify({ actor: 3, venta_id: 2, motivo: ventas[1].anulacion!.motivo }) } },
    vinculos: [{ venta_id: 1, detalle_id: 1, operacion: 'venta', movimiento_id: 5 }, { venta_id: 2, detalle_id: 2, operacion: 'venta', movimiento_id: 6 }, { venta_id: 2, detalle_id: 2, operacion: 'anulacion', movimiento_id: 7 }] }
}

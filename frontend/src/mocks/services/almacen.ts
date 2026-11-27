import { crearDatosFase2 } from '../data/fase2'
import { crearDatosFase3 } from '../data/fase3'
function inicial() {
  const inventario = crearDatosFase2()
  return { inventario, ventas: crearDatosFase3(inventario) }
}
export type AlmacenMock = ReturnType<typeof inicial>
let state = inicial()
export function reiniciarAlmacen() { state = inicial() }
// Un único punto de publicación síncrono para catálogo/inventario y ventas.
// Ningún callback asíncrono: si falla, se descarta toda la copia.
export function transaccionMock<T>(escritura: boolean, run: (draft: AlmacenMock) => T): T {
  const draft = structuredClone(state)
  const result = run(draft)
  if (result instanceof Promise) throw new Error('La transacción mock debe ser síncrona.')
  if (escritura) state = draft
  return result
}

export function generarClaveOperacion(): string { return crypto.randomUUID() }
// Conservar la instancia por formulario. Un reintento idéntico conserva clave y payload.
export function crearOperacionInventario<T extends object>() {
  let fingerprint: string | null = null
  let payload: T | null = null
  let key: string | null = null
  return {
    preparar(input: T): T & { clave_operacion: string } {
      const next = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))
      if (next !== fingerprint) { fingerprint = next; payload = structuredClone(input); key = generarClaveOperacion() }
      return { ...structuredClone(payload!), clave_operacion: key! }
    },
    nueva() { fingerprint = null; payload = null; key = null },
  }
}

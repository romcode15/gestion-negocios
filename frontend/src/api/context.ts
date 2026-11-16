// Crear una instancia por consumidor/contexto; cambiar() invalida las solicitudes anteriores.
export function crearContextoSolicitudes() {
  let controller = new AbortController()
  return {
    get signal() { return controller.signal },
    cambiar() { controller.abort(); controller = new AbortController() },
    cancelar() { controller.abort() },
  }
}

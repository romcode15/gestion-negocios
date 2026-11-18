## Completar panel de plataforma y membresías

Refs #14 y #15.

Se recupera la base de sesión retirada por el revert y se conectan las pantallas de plataforma y membresías con la API tipada existente.

### Cambios

- Panel de cuentas/negocios con selección paginada de administrador, altas, errores por campo y permisos por acción.
- Listado de miembros, incorporación de cuenta nueva/existente y cambio de rol usando membresia.id.
- Selector de roles paginado, nombres resueltos desde el catálogo del negocio activo y bloqueo sin listar_roles.
- Limpieza de contraseña al cambiar de modo, control de envío único y conservación de entradas tras errores.
- Cancelación/descarte de respuestas al cambiar de negocio o sesión.
- Restauración de sesión y reevaluación de acceso al cambiar el rol propio.
- Componentes compartidos para tablas, estados de listado, paginación, selectores, navbar y footer; estilos centralizados.
- Documentación y pruebas automatizadas de servicios, renderizado y eventos DOM.

### Verificación

- [x] npm.cmd test
- [x] npm.cmd run lint
- [x] npm.cmd run build
- [ ] Revisión visual a 320px y navegación con teclado en navegador real.
- [ ] Integración con Django/PostgreSQL.

Las pruebas verifican payloads, errores, permisos independientes, paginación, altas, duplicados, cuentas inactivas/inexistentes, roles ajenos, envío único, cambio de modo, rol propio, expiración y cambio rápido de contexto.

No se modificó backend ni se incorporaron operaciones fuera del alcance. Las pruebas HTTP sustituyen fetch; los resultados de mocks no demuestran integración real.

### Revisión

Destino: dev. Solicitar revisión a Henry y comprobar el cierre de #14/#15 tras integrar. Evidencia en PANEL_VERIFICACION.md, MEMBRESIAS_VERIFICACION.md y COMPONENTES.md.

Nota de mantenimiento: npm audit mantiene alertas en dependencias de desarrollo de Vite/picomatch; requieren coordinación de una actualización de herramientas.

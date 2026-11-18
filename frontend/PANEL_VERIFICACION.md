# Verificación del panel de plataforma (#14)

Evidencia con **simulación (`VITE_API_MODE=mock`)**. No demuestra integración con Django ni PostgreSQL.

## Preparación

Desde `frontend/`: `npm.cmd ci`, `npm.cmd run dev` y abrir `http://localhost:5173`.
Login: `plataforma` / `Demo-12345!` (cuenta ficticia del mock, documentada en `API.md`).
Entrar a `/plataforma`. Para reiniciar los datos simulados, recargar la página.

## Resultados automáticos

| Comando | Resultado |
|---|---|
| `npm.cmd run lint` | Correcto, sin advertencias. |
| `npm.cmd run build` | Correcto, TypeScript y Vite compilan. |
| `npm.cmd run test:api` | Correcto: mocks, HTTP con fetch sustituido, contrato y paginación. |
| `node verificar-panel.mjs` | Correcto: validaciones, acumulación de cuentas entre páginas, estados del listado y permisos por acción. |

`verificar-panel.mjs` comprueba además que el alta de negocio y el alta de cuenta renderizan dos
`<form>` hermanos, nunca anidados.

## Escenarios manuales ejecutados con mocks

1. **Carga**: al entrar aparecen `Cargando negocios…` y `Cargando cuentas…`; después se muestran 2 negocios
   (`Tienda Central`, `Ferretería Norte`) con nombre, tipo y estado, y 5 cuentas paginadas de 2 en 2.
2. **Cuenta duplicada**: crear `plataforma` → error `El nombre de usuario ya existe.` junto a *Nombre de usuario*;
   los valores escritos se conservan y `aria-invalid="true"` queda en el campo.
3. **Contraseña inválida**: crear `corta_prueba` con contraseña corta → error junto a *Contraseña*; no se crea la cuenta.
4. **Cuenta creada y seleccionada**: crear `admin_prueba` con contraseña válida → mensaje de éxito, la cuenta queda
   seleccionada como administradora (`value=6`), el listado de cuentas pasa a 6 y los campos de la cuenta se limpian.
   Al vaciar y volver a elegir el administrador, `admin_prueba` sigue disponible.
5. **Negocio sin tipo / sin administrador**: enviar con el tipo vacío y después sin administrador → errores
   `Escribe el tipo de negocio.` y `Selecciona una cuenta activa existente.`; el foco va al primer campo inválido (`nombre`).
6. **Alta correcta y paginación**: crear `Negocio Prueba` de tipo `tienda` con `administrador_id=6` → mensaje de éxito,
   el contador pasa a 3 negocios. En la página 2 aparece la fila `Negocio Prueba / tienda / Activo`.
7. **Permiso denegado en listado**: forzar `permission_denied` y paginar → `No tienes permiso para realizar esta acción.`
   con *Reintentar*; al reintentar se recupera el listado.
8. **Lista vacía**: forzar `empty` y volver a la página 1 → `No hay negocios`.
9. **Fallo de envío**: forzar `validation_error` al crear un negocio → error general visible y se conservan nombre,
   tipo y administrador seleccionado.
10. **Falta de permiso de Pantalla**: iniciar sesión como `compartido` y abrir `/plataforma` → `Acceso denegado`.
    Sin `listar_usuarios`, el selector no se monta ni se lanza esa consulta (comprobado también en `verificar-panel.mjs`).

No se ejecutaron capturas porque la ventana del navegador integrado no estuvo visible durante la verificación.
La comprobación visual a 320 px sigue pendiente de revisión manual; el maquetado usa `clamp`, `flex-wrap`
y contenedor con desplazamiento horizontal para la tabla.

## Endpoints pendientes de comprobación real con Django/PostgreSQL

- `GET /api/v1/plataforma/negocios/`
- `GET /api/v1/plataforma/usuarios/`
- `POST /api/v1/plataforma/usuarios/`
- `POST /api/v1/plataforma/negocios/`

Quedan por validar contra el servidor: CSRF y rotación de token, códigos HTTP, paginación real, validadores de
contraseña de Django, errores por campo y la transacción atómica de negocio + rol + membresía que ocurre en backend.
La interfaz solo envía los campos del contrato; no simula esa transacción.

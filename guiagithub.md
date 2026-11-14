# Guía de GitHub para el equipo de Gestión de Negocios

Cada issue se trabaja en una rama propia creada desde `dev` actualizada. Los cambios se revisan mediante un **pull request (PR) hacia `dev`**. Cuando el incremento esté probado, los líderes coordinan su integración en `main`.

| Rama | Uso |
|---|---|
| `main` | Versión estable y aprobada del proyecto. |
| `dev` | Integra los cambios del equipo para probarlos juntos. |
| `feat/14-panel-plataforma` | Ejemplo de rama para resolver el issue #14. |

**Rutina:** revisar issue y dependencias → actualizar `dev` → crear rama → desarrollar y probar → commit → push → PR hacia `dev` → revisión e integración.

## 1. Prepara tu equipo y clona el repositorio

Acepta la invitación al repositorio privado y comprueba que puedes ver el código en GitHub. Instala Git y abre PowerShell en la carpeta donde guardas tus proyectos.

Configura la identidad de tus commits una vez por equipo. Sustituye estos valores por tu nombre y un correo asociado a tu cuenta de GitHub; puedes usar el correo privado `noreply` que GitHub muestra en sus ajustes de correo.

```powershell
git config --global user.name "Tu nombre"
git config --global user.email "tu-correo-asociado-a-github"
```

Clona el repositorio **una sola vez**:

```powershell
git clone https://github.com/romcode15/gestion-negocios.git
cd gestion-negocios
git switch dev
```

Si Git abre el navegador, inicia sesión con la cuenta que aceptó la invitación. La identidad del commit y el inicio de sesión son configuraciones distintas.

Si ya clonaste el proyecto, abre la terminal dentro de `gestion-negocios`. No necesitas volver a clonarlo. Para instalar y ejecutar Django y React, sigue el [README](README.md).

## 2. Revisa el issue y sus dependencias

Antes de escribir código:

1. Lee el objetivo, el alcance, los archivos indicados y los criterios de aceptación del issue asignado.
2. Consulta las guías de [backend](backend/Fase1.md) o [frontend](frontend/fase1.md) y su estructura: [backend](backend/ESTRUCTURA.md) o [frontend](frontend/ESTRUCTURA.md).
3. Comprueba sus dependencias. Si necesita otro issue, espera a que sus cambios estén revisados, integrados en `dev` y verificados.
4. Si falta una decisión o necesitas modificar archivos compartidos, coordina con Romel en backend o Henry en frontend.

Los issues bloqueados permanecen en **Pendiente**. Una vez habilitados pasan a **Listo**; cuando comiences el trabajo, muévelos a **En progreso**.

## 3. Actualiza dev y crea tu rama

El siguiente ejemplo corresponde al issue **#14, panel de plataforma**. Sustituye el número y la descripción por los de tu tarea.

```powershell
git status
git switch dev
git pull --ff-only origin dev
git switch -c feat/14-panel-plataforma
```

- Revisa `git status` antes de cambiar de rama. Si tienes cambios de otra tarea, guárdalos y haz el commit correspondiente en su rama primero. No los mezcles con el nuevo issue.
- Ejecuta el `pull` cada vez que comiences un issue. Hazlo estando en `dev`.
- Si un comando falla, detente y revisa el mensaje antes de continuar. Si el `pull` no puede avanzar, coordina con tu líder para revisar la diferencia entre ramas.
- Si retomas un issue cuya rama ya existe, cambia a esa rama con `git switch nombre-rama`; no intentes crearla otra vez con `-c`.

### Cómo nombrar la rama

Usa **`tipo/numero-descripcion-corta`**: minúsculas, sin tildes, sin espacios y con guiones. El número del issue se escribe sin `#`.

| Tipo | Cuándo usarlo | Ejemplo |
|---|---|---|
| `feat` | Agregar una funcionalidad. | `feat/14-panel-plataforma` |
| `fix` | Corregir un error. | `fix/21-validar-rol` |
| `docs` | Crear o actualizar documentación. | `docs/22-guia-instalacion` |
| `chore` | Configurar herramientas o mantener el repositorio. | `chore/23-configurar-entorno` |
| `refactor` | Reorganizar código conservando su comportamiento. | `refactor/24-centralizar-permisos` |
| `test` | Agregar o modificar pruebas como tarea principal. | `test/25-verificar-aislamiento` |

Los números 21 a 25 son ejemplos ilustrativos. Usa siempre el número real de tu issue.

El prefijo describe **el tipo de cambio**. Las etiquetas del issue, como `backend`, `frontend` o `integracion`, describen **el área de trabajo**. Conectar un formulario por primera vez puede usar una rama `feat` y la etiqueta `integracion`.

Si la funcionalidad incluye pruebas, desarrolla todo en la misma rama `feat`. Usa `test` cuando las pruebas tengan su propio issue.

## 4. Desarrolla, prueba y registra los cambios

Trabaja únicamente en el alcance del issue. Respeta los tipos, campos, rutas y reglas de fase 1; coordina los cambios al contrato con los líderes.

Antes del commit, ejecuta las verificaciones de tu issue. En frontend se requieren `npm.cmd run lint` y `npm.cmd run build`. En backend se requieren las comprobaciones y pruebas indicadas en el issue, con PostgreSQL cuando corresponda.

Desde la raíz del repositorio, revisa y prepara los archivos de tu tarea:

```powershell
git status
git diff
git add frontend/src/features/negocios/pages/PlataformaPage.tsx
git diff --staged
git commit -m "feat: agregar panel de plataforma (#14)"
git push -u origin feat/14-panel-plataforma
```

La ruta del ejemplo debe sustituirse por la de un archivo real de tu entrega. Repite `git add` para los demás archivos necesarios. `git diff` no muestra el contenido de archivos nuevos sin seguimiento: revísalos también en el editor.

No incluyas `.env`, contraseñas, tokens, dependencias instaladas, compilaciones ni cambios de otro issue. Revisa el contenido antes de confirmar.

**Guardar, commit y push son pasos distintos:** el editor guarda el archivo; el commit registra los cambios preparados en tu historial local; el push envía los commits a GitHub.

Puedes hacer varios commits en la misma rama. Si modificas un archivo después de `git add`, vuelve a agregarlo para incluir su versión actual. Después del primer `push -u`, los siguientes envíos se hacen con `git push`.

## 5. Abre el PR hacia dev

En GitHub, entra a **Pull requests → New pull request**:

| Campo | Selección |
|---|---|
| **base**: rama que recibe los cambios | `dev` |
| **compare**: rama que contiene tu trabajo | Tu rama, por ejemplo `feat/14-panel-plataforma` |

Revisa **Files changed**. Deben aparecer únicamente los archivos y cambios de tu tarea. Si todavía no está listo para revisión, crea el PR como **Draft** y explica qué falta. Cuando esté listo, solicita revisión y mueve el issue a **En revisión**.

### Título del PR

Usa **`tipo: descripcion breve (#numero)`**. En el título y el mensaje del commit sí puedes usar tildes; la restricción sin tildes corresponde al nombre de la rama.

Ejemplo: `feat: agregar el panel de plataforma (#14)`.

Evita títulos como «Cambios», «Actualización» o «Terminado». El título debe describir el resultado concreto.

### Plantilla de descripción

Copia y completa esta plantilla. Sustituye las indicaciones por lo que realmente hiciste y marca solo las verificaciones realizadas.

```markdown
## Issue relacionado
Relacionado con #NUMERO.

## Objetivo
Qué necesidad del issue resuelve este PR.

## Cambios realizados
- Primer cambio concreto.
- Segundo cambio concreto.
- Validaciones o comportamientos relevantes.

## Cómo comprobarlo
### Preparación
- Configuración y datos de prueba necesarios.
- En frontend: modo simulado o conexión real con Django.
- En backend: preparación de la base de pruebas, si corresponde.

### Pasos y resultados esperados
1. Acción que debe ejecutar el revisor y resultado esperado.
2. Siguiente acción y resultado esperado.
3. Caso de error o falta de permiso y resultado esperado.

## Verificaciones realizadas
- Comando o comprobación: resultado obtenido.
- Comando o comprobación: resultado obtenido.

## Evidencia
Capturas para cambios visuales o peticiones/respuestas para API.
No incluir credenciales ni información sensible.

## Pendientes o limitaciones
Qué falta validar o queda fuera del alcance. Si no hay, escribir Ninguno.

## Lista de revisión
- [ ] El PR apunta a dev y está relacionado con mi issue.
- [ ] Revisé Files changed; no hay archivos ajenos a la tarea.
- [ ] Seguí los documentos de fase 1.
- [ ] Verifiqué los criterios de aceptación del issue.
- [ ] Registré los comandos, comprobaciones y resultados.
- [ ] No incluí credenciales, .env ni dependencias instaladas.
- [ ] Solicité revisión al líder de mi área.
```

### Ejemplo de descripción completada

Este ejemplo es ilustrativo: no afirma que el #14 esté implementado. Sustituye los resultados por los que obtengas en tu entrega.

```markdown
## Issue relacionado
Relacionado con #14.

## Objetivo
Permitir consultar negocios y crear uno con una cuenta activa
como administrador inicial.

## Cambios realizados
- Agregué el listado paginado de negocios.
- Implementé formularios de cuenta y negocio con errores por campo.
- Mostré las acciones según los permisos de la sesión.

## Cómo comprobarlo
### Preparación
Iniciar frontend en modo simulado siguiendo su documentación.
Usar el escenario ficticio de administrador de plataforma.

### Pasos y resultados esperados
1. Entrar al panel: aparece el listado de negocios.
2. Crear una cuenta: queda disponible en el selector de administrador.
3. Crear un negocio con esa cuenta: aparece en el listado.
4. Repetir el username: aparece un error junto al campo correspondiente.
5. Usar un escenario sin crear_negocio: la acción no está disponible.

## Verificaciones realizadas
- npm.cmd run lint: sin errores.
- npm.cmd run build: compilación correcta.
- Alta, listado y errores: comprobados manualmente con simulación.

## Evidencia
Adjunto capturas del listado, formulario y error por username duplicado.

## Pendientes o limitaciones
Falta comprobar estos flujos con Django y PostgreSQL.
Las pruebas con simulación no validan la integración real.
```

En backend se usa la misma plantilla. Como evidencia, indica método, ruta, cuerpo y respuesta de la API, junto con las pruebas de permisos, aislamiento y transacciones que correspondan. No adjuntes cookies de sesión, tokens CSRF ni contraseñas reales.

## 6. Atiende la revisión y cierra la tarea

**Romel revisa backend y Henry revisa frontend.** El líder coordina la revisión de sus propias entregas con otro integrante; los líderes realizan o autorizan la integración a `dev`.

Si te solicitan correcciones, trabaja en **la misma rama**, verifica de nuevo, crea otro commit y ejecuta `git push`. El PR se actualiza automáticamente; no abras otro para las mismas correcciones.

Cuando el PR esté integrado y el cambio verificado en `dev`, cierra el issue y pásalo a **Terminado**. Mientras `main` sea la rama predeterminada, no dependas de `Closes #N` para cerrar issues en PR hacia `dev`; verifica el cierre manualmente. Puedes referenciar el issue con `Relacionado con #N` y usar la sección **Development** para vincularlo cuando esté disponible.

## 7. Empieza el siguiente issue

Volver a `dev` significa cambiar de rama; no integra por sí mismo tu trabajo. La integración se realiza mediante el PR aprobado.

- Si el siguiente issue es independiente, puedes comenzarlo mientras revisan el anterior, siempre que tus cambios estén guardados en su rama.
- Si depende del anterior, espera su integración en `dev`. Un PR abierto o un issue cerrado sin cambios integrados no habilita la dependencia.
- Vuelve a ejecutar `git status`, `git switch dev`, `git pull --ff-only origin dev` y crea la rama del nuevo issue.

Si necesitas incorporar cambios nuevos de `dev` a un issue que ya empezaste, coordina con el líder la actualización de tu rama.

## 8. Qué hacer si algo falla

| Situación | Qué revisar o hacer |
|---|---|
| Git no reconoce tu identidad al hacer commit | Configura user.name y user.email como indica el paso 1. |
| Repository not found o Authentication failed | Revisa la URL, la invitación aceptada y la cuenta usada para autenticarte. Consulta el README. |
| La rama ya existe | Usa git switch con su nombre si estás retomando ese issue. |
| Hay cambios pendientes al cambiar de rama | Guarda y registra los cambios de la tarea actual en su rama antes de continuar. |
| Pull o push rechazado | Conserva el mensaje y consulta al líder para revisar las ramas antes de reintentar. |
| Git muestra un conflicto | Comunícalo al líder. Revisen los archivos afectados y la combinación correcta; no elijas todos los cambios de un lado sin revisarlos. |

No uses `push --force`, `reset --hard` o comandos de limpieza para intentar resolver un rechazo sin entender sus efectos y coordinar con el líder. Para pedir ayuda, comparte el comando, el mensaje de error y tu rama actual, sin credenciales.

## 9. Diccionario de comandos

| Comando | Significado |
|---|---|
| `git clone URL` | Descarga el repositorio y prepara una copia local. |
| `git config --global user.name "Nombre"` | Configura el nombre de autor de tus commits en el equipo. |
| `git config --global user.email "Correo"` | Configura el correo de autor de tus commits. |
| `git status` | Muestra la rama y el estado de los archivos. |
| `git branch --show-current` | Muestra el nombre de tu rama actual. |
| `git switch dev` | Cambia a la rama local dev. |
| `git pull --ff-only origin dev` | Descarga e incorpora dev remota si puede hacerlo sin crear un merge; aquí se ejecuta estando en dev. |
| `git switch -c nombre-rama` | Crea una rama desde tu posición actual y cambia a ella. |
| `git diff` | Muestra cambios de archivos versionados todavía no preparados para commit. |
| `git add ruta/archivo` | Prepara el contenido actual de un archivo para el próximo commit. |
| `git diff --staged` | Muestra los cambios preparados para el próximo commit. |
| `git commit -m "mensaje"` | Registra los cambios preparados en el historial local. |
| `git push -u origin nombre-rama` | Sube la rama y configura su seguimiento remoto para próximos envíos. |
| `git push` | Envía los nuevos commits de una rama con seguimiento configurado. |

## 10. Diccionario de palabras

| Palabra | Significado |
|---|---|
| Git | Herramienta que registra el historial del código. |
| GitHub | Plataforma donde compartimos el repositorio y organizamos revisiones y tareas. |
| Repositorio | Archivos del proyecto junto con su historial. |
| Local | Lo que está en tu computadora. |
| Remoto | Repositorio alojado en otro lugar, como GitHub. |
| Origin | Nombre habitual del remoto desde el que clonaste el proyecto. |
| Rama / branch | Línea de trabajo para desarrollar cambios. |
| Commit | Registro de un conjunto de cambios con autor y mensaje. |
| Staged | Cambios preparados mediante git add para el próximo commit. |
| Issue | Tarea o problema con alcance y criterios de aceptación. |
| Dependencia / bloqueo | Trabajo previo que debe integrarse y verificarse antes de comenzar otro. |
| Pull request / PR | Solicitud para revisar e integrar cambios entre ramas. |
| Draft | PR en borrador: todavía no está listo para aprobación. |
| Base | Rama que recibirá los cambios del PR. |
| Compare | Rama que contiene el trabajo propuesto. |
| Review | Revisión de los cambios y de su comprobación. |
| Merge / integrar | Incorporar los cambios de una rama en otra. |
| Conflicto | Situación en la que Git necesita una decisión para combinar cambios. |
| Milestone | Agrupación de issues de una fase. |
| Etiqueta / label | Clasificación del issue, como backend o frontend. |
| Tablero / Kanban | Vista del avance: Pendiente → Listo → En progreso → En revisión → Terminado. |
| Mock / simulación | Implementación ficticia para desarrollar y probar sin depender del servidor real. |

## Referencias

- [GitHub: vincular PR e issues y condiciones de cierre automático](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).
- [Git: actualizar una rama con git pull y la opción ff-only](https://git-scm.com/docs/git-pull).
- [Git: revisar cambios con git diff y staged](https://git-scm.com/docs/git-diff).

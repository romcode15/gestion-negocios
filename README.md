## Roles del equipo

| Integrante | Rol | Responsabilidad general |
|---|---|---|
| Romel | Jefe del proyecto y líder de backend | Planifica las fases, coordina al equipo y organiza los milestones e issues en GitHub. Define la arquitectura del backend y revisa los cambios de su área. |
| Diego y Sebastián | Desarrolladores backend | Implementan y prueban la API, la lógica de negocio y los cambios en la base de datos. |
| Henry | Líder de frontend | Define la estructura del frontend y los criterios para los componentes compartidos. Coordina al equipo de frontend y revisa los cambios de su área. |
| Kelvin y Diana | Desarrolladores frontend | Implementan y prueban las interfaces, los componentes y la integración con la API. |

Los líderes de frontend y backend acuerdan qué datos intercambiará la API para que ambos equipos puedan avanzar en paralelo. Las tareas concretas y sus responsables se registran en los issues de cada fase.

## Metodología de desarrollo

El proyecto sigue un **desarrollo iterativo e incremental**, con un **tablero Kanban en GitHub Projects** para organizar el trabajo. Cada fase entrega un conjunto de funcionalidades que el equipo puede integrar y probar. Al cierre, se revisa el resultado y se registran los ajustes para los siguientes incrementos.

| Herramienta | Uso |
|---|---|
| Milestones | Agrupan los issues de una fase y permiten seguir su avance. |
| Issues | Describen una tarea, su responsable y el criterio para darla por terminada. |
| Tablero Kanban | Muestra el estado de cada issue mediante las columnas Pendiente, Listo, En progreso, En revisión y Terminado. |
| Pull requests | Vinculan los cambios de código con su issue y permiten revisarlos antes de integrarlos en `main`. |

### Flujo de trabajo

1. Se define el objetivo de la fase y se crea su milestone.
2. Se crean y asignan los issues. Las etiquetas `backend` y `frontend` identifican el área de cada tarea.
3. Cada integrante crea una rama a partir de `main` actualizada y desarrolla su tarea.
4. Cuando el cambio está listo, abre un pull request hacia `main` y lo vincula con el issue correspondiente.
5. Después de la revisión y la integración, la tarea pasa a **Terminado**. Al cerrar la fase, el equipo prueba el flujo completo.

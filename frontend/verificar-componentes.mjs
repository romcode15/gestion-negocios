import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { Button } = await server.ssrLoadModule('/src/components/ui/Button.tsx')
  const { TextField } = await server.ssrLoadModule('/src/components/ui/TextField.tsx')
  const feedback = await server.ssrLoadModule('/src/components/feedback/Feedback.tsx')
  const render = (component, props) => renderToStaticMarkup(createElement(component, props))
  assert.match(render(Button, { children: 'Guardar' }), /type="button"/)
  const pending = render(Button, { pending: true })
  for (const pattern of [/disabled=""/, /aria-busy="true"/, /Guardando/]) assert.match(pending, pattern)
  const field = render(TextField, { id: 'nombre', label: 'Nombre', errors: ['Campo requerido.'] })
  for (const pattern of [/for="nombre"/, /aria-invalid="true"/, /aria-describedby="nombre-errors"/, /id="nombre-errors"/]) assert.match(field, pattern)
  assert.match(render(feedback.Loading), /role="status"/)
  assert.match(render(feedback.EmptyState), /No hay resultados/)
  assert.match(render(feedback.ErrorMessage, { children: 'Error general' }), /role="alert"/)
  assert.match(render(feedback.AccessDenied), /No tienes permiso/)
  console.log('OK: normal, carga, validación, vacío, error general y sin acceso (render SSR).')
} finally { await server.close() }

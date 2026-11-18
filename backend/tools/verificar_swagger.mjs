// Comprobación del interceptor real de la plantilla, sin instalar dependencias Node.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

let config
const SwaggerUIBundle = options => { config = options; return {} }
SwaggerUIBundle.presets = { apis: {} }
const document = { baseURI: 'http://localhost:8000/api/docs/', cookie: 'csrftoken=primero' }
const source = readFileSync(new URL('../templates/api/swagger_ui.js', import.meta.url), 'utf8')
  .replace('{{ csrf_cookie_name|escapejs }}', 'csrftoken')
  .replace('{{ csrf_header_name|escapejs }}', 'X-CSRFTOKEN')
  .replace('{{ schema_url|escapejs }}', '/api/schema/')
  .replace('{{ settings|safe }}', '{}')
vm.runInNewContext(source, { SwaggerUIBundle, document, URL, window: { location: { origin: 'http://localhost:8000' } } })
const request = method => config.requestInterceptor({ method, url: '/api/v1/auth/logout/', headers: {} })
assert.equal(request('POST').headers['X-CSRFTOKEN'], 'primero')
document.cookie = 'otra=valor; csrftoken=rotado'
assert.equal(request('PATCH').headers['X-CSRFTOKEN'], 'rotado')
assert.equal(request('GET').headers['X-CSRFTOKEN'], undefined)
assert.equal(request('POST').credentials, 'same-origin')
const external = config.requestInterceptor({ method: 'POST', url: 'https://otro.example/api/', headers: {} })
assert.equal(external.headers['X-CSRFTOKEN'], undefined)
document.cookie = ''
assert.equal(request('POST').headers['X-CSRFTOKEN'], '')
console.log('OK Swagger: cookie actual en cada escritura, token rotado, mismo origen y sin credenciales persistidas.')

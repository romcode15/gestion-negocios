"use strict";

// Leer la cookie antes de CADA escritura: Django rota CSRF al iniciar sesión.
const csrfCookieName = "{{ csrf_cookie_name|escapejs }}";
const csrfHeaderName = "{{ csrf_header_name|escapejs }}";

function prepararPeticion(request) {
  const destino = new URL(request.url, document.baseURI);
  request.credentials = "same-origin";
  if (destino.origin === window.location.origin &&
      !["GET", "HEAD", "OPTIONS"].includes((request.method || "GET").toUpperCase())) {
    const cookie = document.cookie.split(";").map(part => part.trim())
      .find(part => part.startsWith(csrfCookieName + "="));
    request.headers = request.headers || {};
    request.headers[csrfHeaderName] = cookie ? decodeURIComponent(cookie.slice(csrfCookieName.length + 1)) : "";
  }
  return request;
}

const ui = SwaggerUIBundle({
  url: "{{ schema_url|escapejs }}",
  dom_id: "#swagger-ui",
  presets: [SwaggerUIBundle.presets.apis],
  layout: "BaseLayout",
  ...{{ settings|safe }},
  requestInterceptor: prepararPeticion,
});

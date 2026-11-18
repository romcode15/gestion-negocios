from django.http import JsonResponse


class ApiNotFoundMiddleware:
    """Normaliza las URLs API inexistentes, también cuando DEBUG=True."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (request.path.startswith("/api/v1/") and response.status_code == 404
                and not hasattr(response, "data")):
            return JsonResponse({
                "code": "not_found",
                "detail": "El recurso solicitado no está disponible en este contexto.",
                "errors": {},
            }, status=404)
        return response

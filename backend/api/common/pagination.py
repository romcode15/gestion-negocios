from rest_framework.pagination import PageNumberPagination


class PaginacionPagina(PageNumberPagination):
    # Mismo tamaño inicial que la simulación de frontend; no es configurable por cliente.
    page_size = 2
    page_size_query_param = None
    # El contrato público solo admite páginas numéricas, no el alias interno de DRF.
    last_page_strings = ()

    def paginate_queryset(self, queryset, request, view=None):
        if hasattr(queryset, "order_by"):
            queryset = queryset.order_by("id")
        return super().paginate_queryset(queryset, request, view)

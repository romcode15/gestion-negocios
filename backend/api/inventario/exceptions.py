from rest_framework.exceptions import APIException


class ConflictoInventario(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "La operación o el saldo cambió. Revisa los datos antes de volver a enviar."

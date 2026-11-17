from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from accesos.models import Membresia
from accesos.services import preparar_administrador_negocio
from negocios.models import Negocio


def crear_usuario(username, password):
    modelo = get_user_model()
    candidato = modelo(username=username)
    # Incluye normalización de username, unicidad y validadores del modelo.
    candidato.full_clean(exclude=["password"])
    try:
        validate_password(password, user=candidato)
    except ValidationError as error:
        raise ValidationError({"password": error.messages}) from error
    try:
        with transaction.atomic():
            return modelo.objects.create_user(username=candidato.username, password=password)
    except IntegrityError as error:
        # La unicidad de PostgreSQL resuelve también dos altas concurrentes.
        # Consultar después de salir del savepoint para no usar una transacción rota.
        if modelo.objects.filter(username=candidato.username).exists():
            raise ValidationError({"username": ["Ya existe una cuenta con ese nombre de usuario."]}) from error
        raise


@transaction.atomic
def crear_negocio(nombre, tipo, administrador_id):
    administrador = get_user_model().objects.select_for_update().filter(
        pk=administrador_id, is_active=True,
    ).first()
    if administrador is None:
        raise ValidationError({"administrador_id": ["Selecciona una cuenta activa existente."]})
    negocio = Negocio.objects.create(nombre=nombre, tipo=tipo)
    rol = preparar_administrador_negocio(negocio)
    Membresia.objects.create(usuario=administrador, negocio=negocio, rol=rol)
    return negocio

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accesos.services import asignar_superadministrador, preparar_catalogo


class Command(BaseCommand):
    help = "Prepara el catálogo de fase 1 y, opcionalmente, asigna su rol global a una cuenta activa."

    def add_arguments(self, parser):
        parser.add_argument("--username", help="Cuenta activa existente que recibirá el rol Superadministrador.")

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            username = options.get("username")
            if username is not None:
                usuario = get_user_model().objects.filter(username=username, is_active=True).first()
                if usuario is None:
                    raise CommandError("No existe una cuenta activa con ese username.")
                asignar_superadministrador(usuario)
            else:
                preparar_catalogo()
        except ValidationError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS("Catálogo preparado sin duplicados."))
        if username is not None:
            self.stdout.write(self.style.SUCCESS("Rol global asignado a la cuenta indicada."))

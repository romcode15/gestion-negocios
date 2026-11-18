from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class ModeloValidado(models.Model):
    """Las escrituras individuales validan antes de guardar, también desde el ORM."""

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class Permiso(ModeloValidado):
    class Ambito(models.TextChoices):
        PLATAFORMA = "plataforma", "Plataforma"
        NEGOCIO = "negocio", "Negocio"

    codigo = models.CharField(max_length=100, unique=True)
    ambito = models.CharField(max_length=10, choices=Ambito.choices)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(ambito__in=["plataforma", "negocio"]),
                name="permiso_ambito_valido",
            ),
        ]

    def clean(self):
        super().clean()
        if self.pk and not self._state.adding:
            anterior = type(self).objects.filter(pk=self.pk).values_list("ambito", flat=True).first()
            if anterior is not None and anterior != self.ambito:
                raise ValidationError({"ambito": "El ámbito de un permiso existente no se puede cambiar."})

    def __str__(self):
        return self.codigo


class Rol(ModeloValidado):
    nombre = models.CharField(max_length=150)
    negocio = models.ForeignKey(
        "negocios.Negocio", null=True, blank=True,
        on_delete=models.PROTECT, related_name="roles",
    )
    predefinido = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["negocio", "nombre"], condition=Q(negocio__isnull=False),
                name="rol_nombre_unico_por_negocio",
            ),
            models.UniqueConstraint(
                fields=["nombre"], condition=Q(negocio__isnull=True),
                name="rol_nombre_global_unico",
            ),
        ]

    def clean(self):
        super().clean()
        if self.pk and not self._state.adding:
            anterior = type(self).objects.filter(pk=self.pk).values("negocio_id").first()
            if anterior is not None and anterior["negocio_id"] != self.negocio_id:
                raise ValidationError({"negocio": "El ámbito de un rol existente no se puede cambiar."})

    def __str__(self):
        return self.nombre


class RolPermiso(ModeloValidado):
    rol = models.ForeignKey(Rol, on_delete=models.CASCADE, related_name="permisos_asignados")
    permiso = models.ForeignKey(Permiso, on_delete=models.PROTECT, related_name="roles_asignados")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["rol", "permiso"], name="rol_permiso_unico"),
        ]

    def clean(self):
        super().clean()
        rol = Rol.objects.filter(pk=self.rol_id).first()
        permiso = Permiso.objects.filter(pk=self.permiso_id).first()
        if rol is not None and permiso is not None:
            ambito = Permiso.Ambito.PLATAFORMA if rol.negocio_id is None else Permiso.Ambito.NEGOCIO
            if permiso.ambito != ambito:
                raise ValidationError({"permiso": "El permiso no pertenece al ámbito del rol."})


class UsuarioRolGlobal(ModeloValidado):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="roles_globales",
    )
    rol = models.ForeignKey(Rol, on_delete=models.PROTECT, related_name="usuarios_globales")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["usuario", "rol"], name="usuario_rol_global_unico"),
        ]

    def clean(self):
        super().clean()
        rol = Rol.objects.filter(pk=self.rol_id).first()
        if rol is not None and rol.negocio_id is not None:
            raise ValidationError({"rol": "La asignación global requiere un rol de plataforma."})


class Membresia(ModeloValidado):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="membresias",
    )
    negocio = models.ForeignKey(
        "negocios.Negocio", on_delete=models.PROTECT, related_name="membresias",
    )
    rol = models.ForeignKey(Rol, on_delete=models.PROTECT, related_name="membresias")
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["usuario", "negocio"], name="membresia_usuario_negocio_unico"),
        ]

    def clean(self):
        super().clean()
        rol = Rol.objects.filter(pk=self.rol_id).first()
        if rol is not None and (rol.negocio_id is None or rol.negocio_id != self.negocio_id):
            raise ValidationError({"rol": "El rol debe pertenecer al mismo negocio que la membresía."})

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accesos.models import Membresia, Rol
from tests.support.api import crear_rol
from tests.support.factories import crear_dos_negocios

class MembresiasTests(TestCase):
    def setUp(self):
        self.tienda, self.ferreteria = crear_dos_negocios()

        self.rol = crear_rol(
            self.tienda.negocio,
            "Cajero",
        )

        self.url = (
            f"/api/v1/negocios/{self.tienda.negocio.pk}/membresias/"
        )

        # Activa la comprobación real de CSRF.
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.tienda.administrador)

        self.client.get("/api/v1/auth/csrf/")
        self.csrf = self.client.cookies["csrftoken"].value

    def enviar_alta(self, datos):
        return self.client.post(
            self.url,
            datos,
            format="json",
            HTTP_X_CSRFTOKEN=self.csrf,
        )

    def test_listado_paginado_aislado_por_negocio(self):
        modelo = get_user_model()

        for numero in range(2):
            usuario = modelo.objects.create_user(
                username=f"miembro_{numero}",
            )
            Membresia.objects.create(
                usuario=usuario,
                negocio=self.tienda.negocio,
                rol=self.rol,
                activo=(numero == 0),
            )

        respuesta = self.client.get(self.url)

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.data["count"], 3)
        self.assertEqual(len(respuesta.data["results"]), 2)
        self.assertIsNotNone(respuesta.data["next"])

        pagina_dos = self.client.get(self.url, {"page": 2})

        self.assertEqual(pagina_dos.status_code, 200)
        self.assertEqual(len(pagina_dos.data["results"]), 1)

        registros = (
            respuesta.data["results"]
            + pagina_dos.data["results"]
        )

        self.assertTrue(all(
            registro["negocio_id"] == self.tienda.negocio.pk
            for registro in registros
        ))
        self.assertEqual(
            [registro["id"] for registro in registros],
            sorted(registro["id"] for registro in registros),
        )
        self.assertTrue(any(
            not registro["activo"] for registro in registros
        ))

    def test_alta_con_cuenta_nueva(self):
        password = "Prueba!Membresias-7294"

        respuesta = self.enviar_alta({
            "username": "cuenta_nueva",
            "password": password,
            "rol_id": self.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 201)

        usuario = get_user_model().objects.get(
            username="cuenta_nueva",
        )

        self.assertTrue(usuario.check_password(password))
        self.assertEqual(
            set(respuesta.data),
            {"id", "usuario", "negocio_id", "rol_id", "activo"},
        )
        self.assertEqual(
            set(respuesta.data["usuario"]),
            {"id", "username", "is_active"},
        )
        self.assertTrue(Membresia.objects.filter(
            usuario=usuario,
            negocio=self.tienda.negocio,
            rol=self.rol,
            activo=True,
        ).exists())

    def test_alta_con_cuenta_existente_conserva_password(self):
        usuario = get_user_model().objects.create_user(
            username="cuenta_existente",
            password="Original!Cuenta-8362",
        )
        hash_anterior = usuario.password

        respuesta = self.enviar_alta({
            "username": usuario.username,
            "rol_id": self.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 201)

        usuario.refresh_from_db()

        self.assertEqual(usuario.password, hash_anterior)
        self.assertTrue(
            usuario.check_password("Original!Cuenta-8362")
        )
        self.assertEqual(
            respuesta.data["usuario"]["id"],
            usuario.pk,
        )

    def test_rechaza_membresia_duplicada_inactiva(self):
        usuario = get_user_model().objects.create_user(
            username="miembro_inactivo",
        )
        membresia = Membresia.objects.create(
            usuario=usuario,
            negocio=self.tienda.negocio,
            rol=self.rol,
            activo=False,
        )

        respuesta = self.enviar_alta({
            "username": usuario.username,
            "rol_id": self.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(
            respuesta.data["code"],
            "validation_error",
        )
        self.assertIn("username", respuesta.data["errors"])

        membresia.refresh_from_db()

        self.assertFalse(membresia.activo)
        self.assertEqual(
            Membresia.objects.filter(
                usuario=usuario,
                negocio=self.tienda.negocio,
            ).count(),
            1,
        )

    def test_password_vacio_no_usa_cuenta_existente(self):
        usuario = get_user_model().objects.create_user(
            username="sin_membresia",
        )

        respuesta = self.enviar_alta({
            "username": usuario.username,
            "password": "",
            "rol_id": self.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("password", respuesta.data["errors"])
        self.assertFalse(Membresia.objects.filter(
            usuario=usuario,
            negocio=self.tienda.negocio,
        ).exists())

    def test_listado_requiere_sesion(self):
        cliente = APIClient(enforce_csrf_checks=True)

        respuesta = cliente.get(self.url)

        self.assertEqual(respuesta.status_code, 403)
        self.assertEqual(
            respuesta.data["code"],
            "not_authenticated",
        )

    def test_alta_requiere_csrf(self):
        respuesta = self.client.post(
            self.url,
            {
                "username": "sin_csrf",
                "password": "Prueba!SinCsrf-8362",
                "rol_id": self.rol.pk,
            },
            format="json",
        )

        self.assertEqual(respuesta.status_code, 403)
        self.assertEqual(respuesta.data["code"], "csrf_failed")
        self.assertFalse(get_user_model().objects.filter(
            username="sin_csrf",
        ).exists())
    def test_rechaza_username_invalido_o_inexistente(self):
       for username in ("nombre con espacios", "no_existe"):
            with self.subTest(username=username):
                respuesta = self.enviar_alta({
                    "username": username,
                    "rol_id": self.rol.pk,
                })

                self.assertEqual(respuesta.status_code, 400)
                self.assertEqual(
                    respuesta.data["code"],
                    "validation_error",
                )
                self.assertIn(
                    "username",
                    respuesta.data["errors"],
                )
                self.assertFalse(
                    get_user_model().objects.filter(
                        username=username,
                    ).exists()
                )
    def test_rechaza_cuenta_existente_inactiva(self):
        usuario = get_user_model().objects.create_user(
            username="cuenta_inactiva",
            password="Original!Inactiva-8362",
            is_active=False,
        )
        hash_anterior = usuario.password

        respuesta = self.enviar_alta({
            "username": usuario.username,
            "rol_id": self.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("username", respuesta.data["errors"])

        usuario.refresh_from_db()

        self.assertFalse(usuario.is_active)
        self.assertEqual(usuario.password, hash_anterior)
        self.assertFalse(Membresia.objects.filter(
            usuario=usuario,
            negocio=self.tienda.negocio,
        ).exists())

    def test_password_presente_rechaza_username_existente(self):
        usuario = get_user_model().objects.create_user(
            username="ya_registrado",
            password="Original!Registrado-8362",
        )
        hash_anterior = usuario.password

        respuesta = self.enviar_alta({
            "username": usuario.username,
            "password": "Otra!Credencial-9274",
            "rol_id": self.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("username", respuesta.data["errors"])

        usuario.refresh_from_db()

        self.assertEqual(usuario.password, hash_anterior)
        self.assertFalse(Membresia.objects.filter(
            usuario=usuario,
            negocio=self.tienda.negocio,
        ).exists())

    def test_password_invalido_no_crea_cuenta(self):
        for password in ("", "123"):
            with self.subTest(password=password):
                respuesta = self.enviar_alta({
                    "username": "password_invalido",
                    "password": password,
                    "rol_id": self.rol.pk,
                })

                self.assertEqual(respuesta.status_code, 400)
                self.assertIn(
                    "password",
                    respuesta.data["errors"],
                )
                self.assertFalse(
                    get_user_model().objects.filter(
                        username="password_invalido",
                    ).exists()
                )

    def test_rechaza_roles_invalidos_sin_crear_datos(self):
        rol_global = Rol.objects.create(
            nombre="Rol global de prueba",
        )
        id_inexistente = (
            Rol.objects.order_by("-id").first().pk + 1
        )
        cantidad_inicial = Membresia.objects.count()

        casos = {
            "global": rol_global.pk,
            "otro_negocio": self.ferreteria.rol.pk,
            "inexistente": id_inexistente,
        }

        for caso, rol_id in casos.items():
            with self.subTest(caso=caso):
                respuesta = self.enviar_alta({
                    "username": "rol_rechazado",
                    "password": "Prueba!RolRechazado-7294",
                    "rol_id": rol_id,
                })

                self.assertEqual(respuesta.status_code, 400)
                self.assertEqual(
                    respuesta.data["code"],
                    "validation_error",
                )
                self.assertIn(
                    "rol_id",
                    respuesta.data["errors"],
                )
                self.assertFalse(
                    get_user_model().objects.filter(
                        username="rol_rechazado",
                    ).exists()
                )
                self.assertEqual(
                    Membresia.objects.count(),
                    cantidad_inicial,
                )

    def test_fallo_en_membresia_revierte_cuenta_nueva(self):
        cantidad_inicial = Membresia.objects.count()

        def fallar_al_crear_membresia(*args, **kwargs):
            # Confirma que la cuenta se creó antes del fallo.
            self.assertTrue(
                get_user_model().objects.filter(
                    username="cuenta_rollback",
                ).exists()
            )
            raise RuntimeError("Fallo simulado de membresía")

        with patch(
            "api.membresias.services.Membresia.objects.create",
            side_effect=fallar_al_crear_membresia,
        ) as crear:
            with self.assertRaisesMessage(
                RuntimeError,
                "Fallo simulado de membresía",
            ):
                self.enviar_alta({
                    "username": "cuenta_rollback",
                    "password": "Prueba!Rollback-7294",
                    "rol_id": self.rol.pk,
                })

            crear.assert_called_once()

        self.assertFalse(
            get_user_model().objects.filter(
                username="cuenta_rollback",
            ).exists()
        )
        self.assertEqual(
            Membresia.objects.count(),
            cantidad_inicial,
        )
    def test_solo_listar_no_permite_crear(self):
        rol_lector = crear_rol(
            self.tienda.negocio,
            "Solo lectura",
            codigos=["listar_membresias"],
        )
        self.tienda.membresia.rol = rol_lector
        self.tienda.membresia.save()

        listado = self.client.get(self.url)
        self.assertEqual(listado.status_code, 200)

        alta = self.enviar_alta({
            "username": "alta_denegada",
            "password": "Prueba!Denegada-7294",
            "rol_id": self.rol.pk,
        })

        self.assertEqual(alta.status_code, 403)
        self.assertEqual(
            alta.data["code"],
            "permission_denied",
        )
        self.assertFalse(get_user_model().objects.filter(
            username="alta_denegada",
        ).exists())

    def test_solo_crear_permite_alta_sin_permiso_global(self):
        rol_creador = crear_rol(
            self.tienda.negocio,
            "Solo incorporacion",
            codigos=["crear_membresia"],
        )
        self.tienda.membresia.rol = rol_creador
        self.tienda.membresia.save()

        # El actor no tiene asignaciones globales.
        self.assertFalse(
            self.tienda.administrador.roles_globales.exists()
        )

        listado = self.client.get(self.url)
        self.assertEqual(listado.status_code, 403)

        alta = self.enviar_alta({
            "username": "creado_desde_negocio",
            "password": "Prueba!Incorporacion-7294",
            "rol_id": self.rol.pk,
        })

        # El rol Cajero de la prueba no tiene permisos:
        # puede asignarlo sin superar sus propios permisos.
        self.assertEqual(alta.status_code, 201)
        self.assertTrue(Membresia.objects.filter(
            usuario__username="creado_desde_negocio",
            negocio=self.tienda.negocio,
            rol=self.rol,
        ).exists())

    def test_no_permite_asignar_permisos_superiores(self):
        rol_creador = crear_rol(
            self.tienda.negocio,
            "Incorporacion limitada",
            codigos=["crear_membresia"],
        )
        self.tienda.membresia.rol = rol_creador
        self.tienda.membresia.save()

        cantidad_inicial = Membresia.objects.count()

        respuesta = self.enviar_alta({
            "username": "escalada_rechazada",
            "password": "Prueba!Escalada-7294",
            # El rol administrador conserva más permisos.
            "rol_id": self.tienda.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(
            respuesta.data["code"],
            "validation_error",
        )
        self.assertIn("rol_id", respuesta.data["errors"])
        self.assertFalse(get_user_model().objects.filter(
            username="escalada_rechazada",
        ).exists())
        self.assertEqual(
            Membresia.objects.count(),
            cantidad_inicial,
        )

    def test_misma_cuenta_con_roles_distintos_en_dos_negocios(self):
        # Esta cuenta ya administra la ferretería.
        usuario = self.ferreteria.administrador
        hash_anterior = usuario.password

        respuesta = self.enviar_alta({
            "username": usuario.username,
            "rol_id": self.rol.pk,
        })

        self.assertEqual(respuesta.status_code, 201)

        membresia_tienda = Membresia.objects.get(
            usuario=usuario,
            negocio=self.tienda.negocio,
        )
        membresia_ferreteria = Membresia.objects.get(
            usuario=usuario,
            negocio=self.ferreteria.negocio,
        )

        self.assertEqual(membresia_tienda.rol_id, self.rol.pk)
        self.assertEqual(
            membresia_ferreteria.rol_id,
            self.ferreteria.rol.pk,
        )
        self.assertNotEqual(
            membresia_tienda.pk,
            membresia_ferreteria.pk,
        )

        usuario.refresh_from_db()
        self.assertEqual(usuario.password, hash_anterior)

        listado = self.client.get(self.url)
        ids = {
            registro["id"]
            for registro in listado.data["results"]
        }

        self.assertIn(membresia_tienda.pk, ids)
        self.assertNotIn(membresia_ferreteria.pk, ids)


    def test_contexto_inactivo_rechaza_listado_y_alta(self):
        casos = (
            (self.tienda.negocio, "activo", "permission_denied"),
            (self.tienda.membresia, "activo", "permission_denied"),
            (
                self.tienda.administrador,
                "is_active",
                "not_authenticated",
            ),
        )

        for objeto, campo, codigo in casos:
            with self.subTest(modelo=type(objeto).__name__):
                setattr(objeto, campo, False)
                objeto.save()

                try:
                    listado = self.client.get(self.url)
                    alta = self.enviar_alta({
                        "username": "contexto_rechazado",
                        "password": "Prueba!Contexto-7294",
                        "rol_id": self.rol.pk,
                    })

                    for respuesta in (listado, alta):
                        self.assertEqual(respuesta.status_code, 403)
                        self.assertEqual(
                            respuesta.data["code"],
                            codigo,
                        )

                    self.assertFalse(
                        get_user_model().objects.filter(
                            username="contexto_rechazado",
                        ).exists()
                    )
                finally:
                    setattr(objeto, campo, True)
                    objeto.save()

                    # Restablece sesión y token para el siguiente caso.
                    self.client.force_login(
                        self.tienda.administrador
                    )
                    self.client.get("/api/v1/auth/csrf/")
                    self.csrf = (
                        self.client.cookies["csrftoken"].value
                    )

    def test_no_permite_operar_en_negocio_ajeno(self):
        url_ajena = (
            "/api/v1/negocios/"
            f"{self.ferreteria.negocio.pk}/membresias/"
        )
        cantidad_inicial = Membresia.objects.count()

        listado = self.client.get(url_ajena)
        alta = self.client.post(
            url_ajena,
            {
                "username": "intruso",
                "password": "Prueba!Intruso-7294",
                "rol_id": self.ferreteria.rol.pk,
            },
            format="json",
            HTTP_X_CSRFTOKEN=self.csrf,
        )

        for respuesta in (listado, alta):
            self.assertEqual(respuesta.status_code, 403)
            self.assertEqual(
                respuesta.data["code"],
                "permission_denied",
            )

        self.assertFalse(get_user_model().objects.filter(
            username="intruso",
        ).exists())
        self.assertEqual(
            Membresia.objects.count(),
            cantidad_inicial,
        )

    def test_alta_sin_sesion_no_crea_datos(self):
        cliente = APIClient(enforce_csrf_checks=True)
        cliente.get("/api/v1/auth/csrf/")
        csrf = cliente.cookies["csrftoken"].value

        respuesta = cliente.post(
            self.url,
            {
                "username": "anonimo",
                "password": "Prueba!Anonimo-7294",
                "rol_id": self.rol.pk,
            },
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )

        self.assertEqual(respuesta.status_code, 403)
        self.assertEqual(
            respuesta.data["code"],
            "not_authenticated",
        )
        self.assertFalse(get_user_model().objects.filter(
            username="anonimo",
        ).exists())

    def test_campos_extra_no_controlan_negocio_usuario_o_estado(self):
        respuesta = self.enviar_alta({
            "username": "campos_extra",
            "password": "Prueba!CamposExtra-7294",
            "rol_id": self.rol.pk,
            "negocio_id": self.ferreteria.negocio.pk,
            "usuario_id": self.ferreteria.administrador.pk,
            "activo": False,
            "is_active": False,
            "is_staff": True,
            "is_superuser": True,
        })

        self.assertEqual(respuesta.status_code, 201)

        usuario = get_user_model().objects.get(
            username="campos_extra",
        )
        membresia = Membresia.objects.get(
            pk=respuesta.data["id"],
        )

        self.assertEqual(membresia.usuario_id, usuario.pk)
        self.assertEqual(
            membresia.negocio_id,
            self.tienda.negocio.pk,
        )
        self.assertTrue(membresia.activo)
        self.assertTrue(usuario.is_active)
        self.assertFalse(usuario.is_staff)
        self.assertFalse(usuario.is_superuser)
        self.assertFalse(usuario.roles_globales.exists())

    def test_cuenta_existente_se_busca_por_coincidencia_exacta(self):
        usuario = get_user_model().objects.create_user(
            username="CuentaExacta",
        )

        for username in ("cuentaexacta", " CuentaExacta "):
            with self.subTest(username=username):
                respuesta = self.enviar_alta({
                    "username": username,
                    "rol_id": self.rol.pk,
                })

                self.assertEqual(respuesta.status_code, 400)
                self.assertIn(
                    "username",
                    respuesta.data["errors"],
                )

        self.assertFalse(Membresia.objects.filter(
            usuario=usuario,
            negocio=self.tienda.negocio,
        ).exists())
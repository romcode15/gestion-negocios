"""Verifica migraciones y tests en PostgreSQL temporal, sin usar la BD del .env."""

import argparse
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pg-bin", type=Path, help="Directorio de initdb, pg_ctl y psql.")
    options = parser.parse_args()
    suffix = ".exe" if os.name == "nt" else ""
    executable = shutil.which("initdb")
    pg_bin = options.pg_bin or (Path(executable).parent if executable else Path("C:/Program Files/PostgreSQL/18/bin"))
    for name in ("initdb", "pg_ctl", "psql"):
        if not (pg_bin / (name + suffix)).is_file():
            parser.error(f"No se encontró {name}. Indica --pg-bin con el directorio de PostgreSQL.")

    backend = Path(__file__).resolve().parents[1]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    # Solo se elimina el directorio temporal creado por esta ejecución.
    with tempfile.TemporaryDirectory(prefix="gestion-pruebas-postgres-") as temporary:
        folder = Path(temporary)
        data = folder / "data"
        logfile = folder / "postgres.log"
        password = secrets.token_urlsafe(32)
        password_file = folder / "password"
        password_file.write_text(password, encoding="utf-8")
        env = os.environ.copy()
        env.update({
            "DJANGO_SECRET_KEY": secrets.token_urlsafe(48),
            "DB_NAME": "verificacion_fase1",
            "DB_USER": "pruebas_locales",
            "DB_PASSWORD": password,
            "DB_HOST": "127.0.0.1",
            "DB_PORT": str(port),
            "PGPASSWORD": password,
        })

        def pg(name, *args):
            return subprocess.run([str(pg_bin / (name + suffix)), *map(str, args)], env=env, check=True)

        def django(*args):
            subprocess.run([sys.executable, "manage.py", *args], cwd=backend, env=env, check=True)

        started = False
        try:
            pg("initdb", "-D", data, "-U", env["DB_USER"], "--auth=scram-sha-256",
               "--pwfile", password_file, "--encoding=UTF8", "--locale=C")
            password_file.unlink()
            pg("pg_ctl", "-D", data, "-l", logfile, "-o", f"-h 127.0.0.1 -p {port}", "-w", "start")
            started = True
            pg("psql", "-h", env["DB_HOST"], "-p", port, "-U", env["DB_USER"],
               "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE verificacion_fase1")
            django("check")
            django("migrate", "--noinput")
            django("makemigrations", "--check", "--dry-run")
            django("test", "--noinput", "--verbosity", "2")
        finally:
            # Si start falla después de arrancar, detener también ese proceso.
            if started or (data / "postmaster.pid").exists():
                pg("pg_ctl", "-D", data, "-m", "fast", "-w", "stop")


if __name__ == "__main__":
    main()

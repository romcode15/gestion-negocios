"""Huella canónica compartida por servicios futuros y fixtures de B1."""
import json
from hashlib import sha256


def _huella(datos):
    return sha256(json.dumps(datos, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def huella_venta(vendedor_id, detalles, observaciones=""):
    """Recibe líneas ya validadas con cantidad/precio esperado Decimal."""
    return _huella({
        "actor": vendedor_id,
        "observaciones": observaciones.strip(),
        "detalles": [{
            "producto_id": linea["producto_id"], "cantidad": format(linea["cantidad"], ".3f"),
            "precio_unitario_esperado": format(linea["precio_unitario_esperado"], ".2f"),
        } for linea in sorted(detalles, key=lambda fila: fila["producto_id"])],
    })


def huella_anulacion(usuario_id, venta_id, motivo):
    return _huella({"actor": usuario_id, "venta_id": venta_id, "motivo": motivo.strip()})

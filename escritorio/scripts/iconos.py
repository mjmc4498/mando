#!/usr/bin/env python3
"""Genera los íconos de Presentazo para escritorio: los mismos de la extensión.

    python3 escritorio/scripts/iconos.py

Usa los SVG de design/ con la misma regla que la extensión (scripts/render.py):
logo-small.svg en 16 y 32 px, y logo.svg desde 48 px. Crea recursos/icon.icns (Mac),
recursos/icon.ico (Windows), recursos/icon.png y los íconos de la barra de menú
(Mac) y de la bandeja del sistema (Windows).
"""

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from render import render_svg  # noqa: E402

DESIGN = ROOT / "design"
OUT = ROOT / "escritorio" / "recursos"
TRAY = OUT / "bandeja"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    TRAY.mkdir(parents=True, exist_ok=True)
    for old in TRAY.glob("bandejaTemplate*.png"):
        old.unlink()
    big = render_svg(DESIGN / "logo.svg", 1024)
    small = render_svg(DESIGN / "logo-small.svg", 1024)

    def icon(size: int) -> Image.Image:
        return (small if size <= 32 else big).resize((size, size), Image.LANCZOS)

    # Mac: .icns con todos los tamaños del iconset.
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            icon(size).save(iconset / f"icon_{size}x{size}.png")
            icon(size * 2).save(iconset / f"icon_{size}x{size}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "icon.icns")], check=True)
    icon(512).save(OUT / "icon.png", optimize=True)

    # Windows: .ico con cada tamaño dibujado como en la extensión.
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [icon(s) for s in sizes]
    images[-1].save(OUT / "icon.ico", sizes=[(s, s) for s in sizes], append_images=images[:-1])
    tray = [icon(s) for s in (16, 24, 32)]
    tray[-1].save(TRAY / "bandeja-windows.ico", sizes=[(16, 16), (24, 24), (32, 32)], append_images=tray[:-1])
    icon(256).save(TRAY / "icono-windows.png", optimize=True)

    # Mac: barra de menú (16 pt), el mismo ícono a color.
    icon(16).save(TRAY / "bandeja.png")
    icon(32).save(TRAY / "bandeja@2x.png")

    for p in sorted(OUT.rglob("*.*")):
        print("  ", p.relative_to(ROOT))


if __name__ == "__main__":
    main()

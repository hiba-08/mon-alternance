#!/usr/bin/env python3
"""Génère les icônes PNG de l'app à partir de icons/icon.svg (PyMuPDF requis).

- icon-192.png, icon-512.png : icône arrondie (navigateurs, onglet).
- apple-touch-icon.png (180 px) et maskable-512.png : fond plein bord à bord,
  dessin réduit au centre, car iOS et Android découpent eux-mêmes les coins.
"""
import pathlib

import fitz  # PyMuPDF

DOSSIER = pathlib.Path(__file__).resolve().parent.parent / "icons"
SOURCE = (DOSSIER / "icon.svg").read_text(encoding="utf-8")
FOND_ARRONDI = '<rect width="512" height="512" rx="112" fill="url(#fond)"/>'
# MuPDF ne gère pas les dégradés SVG : couleur médiane du dégradé pour les PNG.
COULEUR_FOND = "#6340e9"


def plein_bord(svg, echelle=0.82):
    # Fond carré sans coins arrondis + dessin réduit et centré (zone sûre des icônes « maskable »).
    debut, dessin = svg.split("</defs>", 1)
    dessin = dessin.replace(FOND_ARRONDI, "", 1).replace("</svg>", "")
    decalage = 256 * (1 - echelle)
    return (f'{debut}</defs><rect width="512" height="512" fill="url(#fond)"/>'
            f'<g transform="translate({decalage:.1f} {decalage:.1f}) scale({echelle})">{dessin}</g></svg>')


def rendre(svg, taille, sortie):
    svg = svg.replace("url(#fond)", COULEUR_FOND)
    doc = fitz.open(stream=svg.encode("utf-8"), filetype="svg")
    page = doc[0]
    zoom = taille / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
    pix.save(DOSSIER / sortie)
    print(f"{sortie} : {pix.width}×{pix.height}")


assert FOND_ARRONDI in SOURCE, "icon.svg a changé : mettre à jour FOND_ARRONDI"
rendre(SOURCE, 192, "icon-192.png")
rendre(SOURCE, 512, "icon-512.png")
rendre(plein_bord(SOURCE), 180, "apple-touch-icon.png")
rendre(plein_bord(SOURCE), 512, "maskable-512.png")

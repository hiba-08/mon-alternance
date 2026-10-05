#!/usr/bin/env python3
"""Extrait le calendrier de l'alternance depuis le PDF de l'école.

Le PDF (export Excel) n'indique les périodes que par la couleur de fond des
cellules. Ce script lit ces couleurs directement dans le fichier (vecteurs
PDF, pas une capture d'écran) et produit data/calendrier-gi3b-2026-2027.json.

Contrôles effectués (le script s'arrête si l'un échoue) :
- 365 jours trouvés (1er sept. 2026 → 31 août 2027) ;
- la lettre de chaque jour (L, M, J, V, S, D) correspond à la vraie date ;
- toutes les cellules grises tombent un week-end, et tous les week-ends sont gris.

Usage : python3 tools/extraire_calendrier.py [chemin/du/pdf]
Dépendance : PyMuPDF (module « fitz »).
"""
import datetime
import json
import pathlib
import statistics
import sys

import fitz  # PyMuPDF

PDF_PAR_DEFAUT = pathlib.Path.home() / "Documents/Alternance/Calendrier_GI_2026.pdf"
SORTIE = pathlib.Path(__file__).resolve().parent.parent / "data/calendrier-gi3b-2026-2027.json"

# Couleurs de remplissage (RVB 0–1, arrondies) → signification d'après la légende du PDF.
STATUT_PAR_COULEUR = {
    (0.8, 1.0, 0.8): "ecole",                  # vert : « Période Académique »
    (0.753, 0.753, 0.753): "weekend",          # gris : non légendé (samedis et dimanches)
    (0.0, 0.0, 0.0): "fermeture",              # noir : « jours fériés fermeture CFAI et ISAE-Supméca »
    (0.6, 0.6, 1.0): "session2",               # violet : « épreuves session 2 S5 »
    (1.0, 0.753, 0.0): "rentree-admin",        # jaune : « Rentrée administrative… »
    (0.969, 0.588, 0.275): "rentree-peda",     # orange : « Rentrée pédagogique… »
}
SEMESTRE_PAR_COULEUR = {
    (1.0, 0.8, 1.0): 1,                        # rose : « Semestre n°1 »
    (0.584, 0.89, 0.961): 2,                   # bleu : « Semestre n° 2 »
}
MOIS = ["septembre", "octobre", "novembre", "décembre", "janvier", "février",
        "mars", "avril", "mai", "juin", "juillet", "août"]
NUM_MOIS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]
LETTRES = "LMMJVSD"  # lundi → dimanche


def couleur(c):
    return tuple(round(x, 3) for x in c)


def main():
    chemin = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else PDF_PAR_DEFAUT
    doc = fitz.open(chemin)
    page = doc[0]
    mots = page.get_text("words")

    # Rectangles colorés (on ignore les traits fins des bordures).
    rects = []
    for d in page.get_drawings():
        if d.get("fill") is None:
            continue
        r = d["rect"]
        if r.width < 3 or r.height < 3:
            continue
        rects.append((r, couleur(d["fill"])))

    def remplissage(x, y):
        touches = [(r.width * r.height, c) for r, c in rects
                   if r.x0 <= x <= r.x1 and r.y0 <= y <= r.y1]
        return min(touches)[1] if touches else None  # le plus petit rectangle = la cellule

    # En-têtes de mois → centre horizontal de chaque colonne.
    centres = {}
    for m in mots:
        if m[4] in MOIS:
            centres[m[4]] = (m[0] + m[2]) / 2
    centres = [centres[m] for m in MOIS]

    # Étiquettes de jour : une lettre suivie d'un nombre à deux chiffres sur la même ligne.
    etiquettes = []
    for w in mots:
        if w[4] not in "LMJVSD" or len(w[4]) != 1:
            continue
        for v in mots:
            if v[4].isdigit() and len(v[4]) == 2 and abs(v[1] - w[1]) < 0.6 and 0 < v[0] - w[2] < 4:
                cx, cy = (w[0] + v[2]) / 2, (w[1] + w[3]) / 2
                mi = min(range(12), key=lambda k: abs(centres[k] - cx))
                etiquettes.append({"mois": mi, "lettre": w[4], "jour": int(v[4]), "cx": cx, "cy": cy})
    assert len(etiquettes) == 365, f"{len(etiquettes)} jours trouvés au lieu de 365"

    # Géométrie : chaque mois = une cellule « jour » puis une cellule « statut ».
    bords = []
    for e in etiquettes:
        for r, _ in rects:
            if r.x0 <= e["cx"] <= r.x1 and r.y0 <= e["cy"] <= r.y1 and r.width < 40:
                bords.append((e["mois"], r.x0, r.x1))
    largeur_mois = statistics.median(centres[k + 1] - centres[k] for k in range(11))
    x0_sept = statistics.median(b[1] - b[0] * largeur_mois for b in bords)
    x1_sept = statistics.median(b[2] - b[0] * largeur_mois for b in bords)

    jours = {}
    for e in sorted(etiquettes, key=lambda e: (e["mois"], e["jour"])):
        decalage = e["mois"] * largeur_mois
        mois = NUM_MOIS[e["mois"]]
        date = datetime.date(2026 if mois >= 9 else 2027, mois, e["jour"])
        assert LETTRES[date.weekday()] == e["lettre"], f"{date} : lettre {e['lettre']} incohérente"

        fin_cellule_statut = x0_sept + largeur_mois + decalage
        fond_statut = remplissage(fin_cellule_statut - 3, e["cy"])
        statut = STATUT_PAR_COULEUR.get(fond_statut, "entreprise" if fond_statut is None else None)
        assert statut is not None, f"{date} : couleur inconnue {fond_statut}"
        semestre = SEMESTRE_PAR_COULEUR.get(remplissage(x0_sept + decalage + 2, e["cy"]))

        # Texte éventuel dans la cellule de statut (hors numéros de semaine « (S 36) »).
        texte = " ".join(
            m[4] for m in mots
            if x1_sept + decalage < (m[0] + m[2]) / 2 < fin_cellule_statut
            and abs((m[1] + m[3]) / 2 - e["cy"]) < 4
        )
        if texte.startswith("(S"):
            texte = ""

        est_weekend = date.weekday() >= 5
        assert (statut == "weekend") == est_weekend, f"{date} : gris/week-end incohérent"

        jour = {"statut": statut, "semestre": semestre}
        if texte:
            jour["texte"] = texte
        jours[date.isoformat()] = jour

    meta = doc.metadata or {}
    cree = meta.get("creationDate", "")[2:10]
    resultat = {
        "source": {
            "fichier": chemin.name,
            "titre": 'FORMATION PAR APPRENTISSAGE — Spécialité "GÉNIE INDUSTRIEL" P19 - GI3B (26-27)',
            "version": "V1.0",
            "creeLe": f"{cree[:4]}-{cree[4:6]}-{cree[6:8]}" if cree else None,
            "extraitLe": datetime.date.today().isoformat(),
            "methode": "Couleurs de fond des cellules lues dans le PDF ; lettres des jours vérifiées contre le calendrier réel.",
            "legende": {
                "ecole": "Période Académique",
                "entreprise": "Période entreprise",
                "session2": "épreuves session 2 S5",
                "fermeture": "jours fériés fermeture CFAI et ISAE-Supméca",
                "rentree-admin": "Rentrée administrative le jeudi 3septembre à 8h30",
                "rentree-peda": "Rentrée pédagogique le lundi 7 septembre à 8h30",
                "semestre1": "Semestre n°1",
                "semestre2": "Semestre n° 2",
                "weekend": "Gris, absent de la légende : correspond exactement aux samedis et dimanches",
                "R.M.A": "R.M.A : Réunion Maître d'Apprentissage",
            },
        },
        "jours": jours,
    }
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(resultat, ensure_ascii=False, indent=1), encoding="utf-8")

    compte = {}
    for j in jours.values():
        compte[j["statut"]] = compte.get(j["statut"], 0) + 1
    print(f"OK : {len(jours)} jours écrits dans {SORTIE}")
    print("Répartition :", compte)


if __name__ == "__main__":
    main()

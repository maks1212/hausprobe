# Autopilot Flächenerkennung

Ziel: Dach, Wand, Fenster und Tür auf echten Straßenfotos zuverlässig und mit scharfen Kanten erkennen.
Der Nutzer will erst Bescheid bekommen, wenn die Erkennung gut ist (oder wenn etwas kaputt ist).

## Kreislauf (läuft von selbst)
1. **Fotos sammeln** – Server, Auftrag 006 (`ml/server/mapillary_fetch.py`, Mapillary CC BY-SA): neue Pakete auf Branch `daten`, `pakete/paket-NNN.zip`.
2. **Markieren** – GitHub Actions `lehrer.yml` prüft alle 6 h, ob unmarkierte Pakete da sind, und lässt sie von
   Grounding DINO + SAM (Apache 2.0) markieren → Branch `lehrer-ergebnis`, `ergebnis/<lauf>/lehrer-paket-NNN.zip`.
   Repo ist seit 2026-11-26 öffentlich: Action-Minuten unbegrenzt, 6 Rechner parallel (etwa 1 Minute je Foto).
3. **Trainieren** – Server, cron 01:23 (`ml/server/auto_train.sh`): bei mindestens 3 neuen Lehrer-Paketen
   Training mit `LEHRER=1` → Branch `modell-flaechen-<zeit>`, `ml/ergebnis/hausprobe_flaechen.onnx` + `bericht.txt`.
   Protokoll: Branch `server`, `results/autopilot.log`.
4. **Prüfen und übernehmen** – tägliche Claude-Aufgabe (siehe unten).

## Tägliche Prüfung (Claude)
- Neuester Branch `modell-flaechen-*`, der jünger ist als der letzte Eintrag unten im Protokoll.
- `bericht.txt`: Zeile „IoU nur Mapillary“ mit „IoU bisheriges Modell, nur Mapillary“ vergleichen (dieselben festen Prüffotos).
- Sichtprüfung: altes und neues Modell auf den Testhäusern (Houses-Dataset, nur zum Testen) nebeneinander.
- Fair ist der Vergleich nur, wenn das bisherige Modell eine Trainingsliste hat (`models/hausprobe_flaechen.train.txt`).
  Steht im Bericht „ACHTUNG … ohne Trainingsliste“, zählen die Zahlen des bisherigen Modells nicht (es kennt Prüffotos), dann entscheidet die Sichtprüfung.
- Übernehmen nur wenn besser: Modell nach `models/hausprobe_flaechen.onnx` und `hausprobe_flaechen.train.txt` nach `models/`, in `segment.js` die Versionsnummer in
  `SURF="models/hausprobe_flaechen.onnx?v=N"` erhöhen, Eintrag unten ergänzen, auf `main` pushen (Vercel baut nur `main`).
- Hängt etwas (Sammlung steht, Actions schlagen fehl, Server meldet sich nicht), den Nutzer benachrichtigen.

## Zielwerte (Mapillary-Prüffotos, gegen Lehrer-Markierung)
Wand ≥ 0,75 · Dach ≥ 0,55 · Fenster ≥ 0,65 · Tür ≥ 0,35, und auf den Testhäusern sichtbar sauber (Fenster: alle Fenster erfasst, gerade Kanten, keine verschmolzenen Nachbarfenster).
Erst dann dem Nutzer melden: „Erkennung ist gut“.

## Regeln
- Street View nie zum Training. Houses-Dataset und Nutzer-Screenshots nur zum Testen.
- Keine Zugangsdaten ins Repo oder in den Chat. Mapillary-Token liegt nur auf dem Server (`~/.mapillary_token`).
- Nur frei lizenzierte Lehrer-Modelle (kein ADE20K).

## Protokoll
| Datum | Modell | Mapillary IoU Dach/Wand/Fenster/Tür | bisher | übernommen |
|---|---|---|---|---|
| 2026-11-18 | modell-flaechen-20261118-1423 | .36/.68/.48/.20 | .34/.60/.23/.12 | ja (v3) |
| 2026-11-18 | App: Guided-Filter-Kanten (512 px) + Schattenregel | – | – | ja |
| 2026-11-18 | App: Dachrand aus Blech (Traufe mit Rinne, Ortgang) entlang des echten Dachumrisses | – | – | ja |
| 2026-11-19 | modell-flaechen-20261119-0247 (nur 192 Lehrer-Fotos, neue Pakete kamen erst danach) | .14/.71/.40/.37 | Vergleich unfair (v3 kannte Prüffotos) | nein |
| 2026-11-19 | modell-flaechen-20261119-1217 (2419 Fotos, davon ~640 Lehrer) | .34/.66/.48/.30 | Vergleich unfair; Sichtprüfung: gleichauf, teils schwächer (Fenster) | nein |
| 2026-11-21 | modell-flaechen-20261121-0542 (4033 Fotos, ~1500 Mapillary) | .34/.68/.52/.24 | .36/.64/.43/.25 (unfair, v3 kannte Prüffotos); Sichtprüfung: deutlich weniger Fehlflächen auf Straße/Wiese, Fenster und Dach besser | ja (v4) |
| 2026-11-22 | modell-flaechen-20261122-0547 (4528 Fotos) | .34/.67/.53/.24 | .34/.68/.52/.24 (fair); Sichtprüfung: gemischt – weniger Himmel als Dach, dafür Bäume als Wand | nein |
| 2026-11-23 | modell-flaechen-20261123-0626 (5209 Fotos) | .39/.70/.55/.24 | .36/.69/.53/.25 (fair, mit Trainingsliste); Sichtprüfung: Dach deutlich sauberer und vollständiger, Wand/Fenster gleichauf | ja (v5) |
| 2026-11-26 | Ziel Fenster von 0,55 auf 0,65 angehoben (Nutzer: Fenster gut, aber nicht perfekt) | – | – | – |
| 2026-11-26 | Repo öffentlich (Action-Minuten unbegrenzt), Lehrer 6 Rechner parallel, Server-Auftrag 014 sammelt bis 3000 Fotos | – | – | – |
| 2026-11-27 | Ziel 10.000 Fotos: 36 Gegenden, Server-Auftrag 015 (Schritte zu 250), Lehrer 12 Rechner parallel; danach entscheiden, ob mehr Fotos noch helfen | – | – | – |

# Autopilot Flächenerkennung

Ziel: Dach, Wand, Fenster und Tür auf echten Straßenfotos zuverlässig und mit scharfen Kanten erkennen.
Der Nutzer will erst Bescheid bekommen, wenn die Erkennung gut ist (oder wenn etwas kaputt ist).

## Kreislauf (läuft von selbst)
1. **Fotos sammeln** – Server, Auftrag 006 (`ml/server/mapillary_fetch.py`, Mapillary CC BY-SA): neue Pakete auf Branch `daten`, `pakete/paket-NNN.zip`.
2. **Markieren** – GitHub Actions `lehrer.yml` prüft alle 6 h, ob unmarkierte Pakete da sind, und lässt sie von
   Grounding DINO + SAM (Apache 2.0) markieren → Branch `lehrer-ergebnis`, `ergebnis/<lauf>/lehrer-paket-NNN.zip`.
   Kontingent: 2000 Action-Minuten pro Monat, etwa 1 Minute je Foto.
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
Wand ≥ 0,75 · Dach ≥ 0,55 · Fenster ≥ 0,55 · Tür ≥ 0,35, und auf den Testhäusern sichtbar sauber.
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

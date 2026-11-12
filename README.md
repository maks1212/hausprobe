# Hausprobe

Neues Dach oder neue Fassade am eigenen Hausfoto ausprobieren. Unabhängiges Projekt und kein Angebot von PREFA; Produkt- und Farbnamen werden nur beschreibend verwendet.

## Funktionen

- Foto wählen (am Handy auch direkt aus der Kamera) oder mit dem gezeichneten Beispielhaus starten
- Flächen automatisch erkennen: Dach oder Wand antippen, ein Segmentierungsmodell im Browser findet die Fläche und lässt Fenster und Bewuchs davor frei; weitere Tipps ergänzen oder entfernen Teile
- Ecken von Hand setzen und nachträglich verschieben
- Produkt und Farbe aus dem PREFA Sortiment wählen (8 Dach- und 8 Fassadenprodukte, Farben je Produktgruppe)
- Material mit Struktur: Fugen mit Schattenwurf, Relief und Tonunterschiede je Element, Stucco-Körnung; Licht und Schatten kommen aus dem Foto
- Vorher/Nachher-Vergleich, Bild speichern und teilen
- Stand wird im Browser zwischengespeichert, die App lässt sich am Handy installieren

Das Foto bleibt im Browser und wird nirgends hochgeladen.

## Aufbau

Statische Seite ohne Build-Schritt.

- `index.html`, `styles.css`: Oberfläche
- `app.js`: Zeichnen, Bedienung, Speichern
- `data.js`: Stammdaten (Produkte, Formate, Farbnummern mit RAL-Näherung) aus öffentlichen PREFA Unterlagen; die hex-Werte sind eigene Bildschirm-Näherungen
- `segment.js`: Flächenerkennung mit EfficientSAM ViT-Tiny über onnxruntime-web (läuft im Browser, einmalig rund 52 MB Download)
- `refine.js`: Kanten der erkannten Fläche am Foto verfeinern (Guided Filter), Licht und Schatten aus dem Foto ableiten
- `models/`, `vendor/ort/`: Modell und Laufzeit, Herkunft und Lizenzen in `models/README.md`
- `vercel.json`: Header für Cross-Origin-Isolation, damit das Modell mehrere Threads nutzen kann
- `sw.js`, `manifest.webmanifest`: Installation und Offline-Betrieb

## Starten

`python3 -m http.server` im Ordner starten und die angezeigte Adresse öffnen. Die Erkennung läuft so mit einem Thread.

## Offen

- Fotorealistisches Rendering
- Angebotsanfrage mit Empfänger

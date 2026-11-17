# Hausprobe

Neues Dach oder neue Fassade am eigenen Hausfoto ausprobieren. Unabhängiges Projekt und kein Angebot von PREFA; Produkt- und Farbnamen werden nur beschreibend verwendet.

## Funktionen

- Foto wählen (am Handy auch direkt aus der Kamera) oder mit dem gezeichneten Beispielhaus starten
- Flächen automatisch erkennen: Dach oder Wand antippen, ein Segmentierungsmodell im Browser findet die Fläche und lässt Fenster und Bewuchs davor frei; weitere Tipps ergänzen oder entfernen Teile
- Ecken von Hand setzen und nachträglich verschieben
- Fensterverkleidung wie bei PREFA (Laibung und Sturz aus Ergänzungsband, Fensterbank mit Tropfkante): Fenster werden nach dem Markieren der Fassade automatisch gesucht (Probe-Tipps im Wandbereich, behalten werden rechteckige Flächen in Fenstergröße mit Kontrast und ohne Bewuchsfarbe), weitere per Tipp markiert; Rahmenbreite schlank, Rahmen oder breit, Farbe wie Fassade oder eigene
- Zoom (zwei Finger, Mausrad, Doppeltipp, Knöpfe) und Vorher/Nachher-Regler im Bild
- Maßstab: Breite (und optional Höhe) der Fläche in Metern; die Elemente werden im echten Format dazu gezeichnet. Bei erkannten Flächen wird die Breite aus der Fenstergröße vorgeschlagen
- Produkt und Farbe aus dem PREFA Sortiment wählen (8 Dach- und 8 Fassadenprodukte, Farben je Produktgruppe)
- Material mit Struktur: Fugen mit Schattenwurf, Relief und Tonunterschiede je Element, Stucco-Körnung; Licht und Schatten kommen aus dem Foto
- Vorher/Nachher per Knopf, Bild speichern und teilen
- Bedienung für Handy und Desktop: das Foto bleibt beim Scrollen sichtbar, Produkte und Farben in Wischzeilen, Foto auch per Ziehen oder Einfügen
- Stand wird im Browser zwischengespeichert, die App lässt sich am Handy installieren

Das Foto bleibt im Browser und wird nirgends hochgeladen.

## Aufbau

Statische Seite ohne Build-Schritt.

- `index.html`, `styles.css`: Oberfläche
- `app.js`: Zeichnen, Bedienung, Speichern
- `data.js`: Stammdaten (Produkte, Formate, Farbnummern mit RAL-Näherung) aus öffentlichen PREFA Unterlagen; die hex-Werte sind eigene Bildschirm-Näherungen
- Erkennung: jede vom Modell gelieferte Fläche wird auf die Farbe der angetippten Stelle eingeschränkt (Farbton zählt mehr als Helligkeit), so fallen Fenster, Türen, Tore und Dach heraus; getestet an zwölf Frontalfotos aus dem offenen Houses-Dataset (github.com/emanhamed/Houses-dataset) und einem eigenen Foto
- `label.html`: Seite „Trainingsdaten“ zum Markieren von Dach, Wand, Fenstern und Türen und zum Export als ZIP; Trainingsskripte in `ml/`
- `models/hausprobe_flaechen.onnx`: eigenes Flächenmodell (1,3 MB) für Dach, Wand, Fenster und Tür, trainiert auf 1.081 COCO-Stuff-Fotos mit kommerziell nutzbarer Lizenz (Markierungen CC BY 4.0, Caesar, Uijlings, Ferrari); damit markiert die App Fassade und Dach nach dem Laden eines Fotos selbst
- `models/hausprobe_fenster.onnx`: eigenes Fenster- und Türmodell (2 MB) auf den Bildmerkmalen von EfficientSAM, trainiert auf einem CC0-Fassadendatensatz
- `segment.js`: Flächenerkennung mit EfficientSAM ViT-Tiny über onnxruntime-web (läuft im Browser, einmalig rund 52 MB Download)
- `refine.js`: Kanten der erkannten Fläche verfeinern (Guided Filter für weiche Ränder; gerade Bauteilkanten wie Fensterrahmen werden als Linien bestimmt und scharf gezeichnet), Licht und Schatten aus dem Foto ableiten
- `models/`, `vendor/ort/`: Modell und Laufzeit, Herkunft und Lizenzen in `models/README.md`
- `vercel.json`: Header für Cross-Origin-Isolation, damit das Modell mehrere Threads nutzen kann
- `sw.js`, `manifest.webmanifest`: Installation und Offline-Betrieb

## Starten

`python3 -m http.server` im Ordner starten und die angezeigte Adresse öffnen. Die Erkennung läuft so mit einem Thread.

## Offen

- Fotorealistisches Rendering
- Angebotsanfrage mit Empfänger

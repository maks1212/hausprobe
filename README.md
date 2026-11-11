# Hausprobe

Neues Dach oder neue Fassade am eigenen Hausfoto ausprobieren. Unabhängiges Projekt und kein Angebot von PREFA; Produkt- und Farbnamen werden nur beschreibend verwendet.

## Funktionen

- Foto wählen (am Handy auch direkt aus der Kamera) oder mit dem gezeichneten Beispielhaus starten
- Flächen automatisch erkennen: Dach oder Wand antippen, die App sucht die zusammenhängende Fläche und schlägt Fenster als Aussparungen vor
- Ecken von Hand setzen und nachträglich verschieben
- Produkt und Farbe aus dem PREFA Sortiment wählen (8 Dach- und 8 Fassadenprodukte, Farben je Produktgruppe)
- Muster wird perspektivisch auf die Fläche gelegt, Licht und Schatten kommen aus dem Foto
- Vorher/Nachher-Vergleich, Bild speichern und teilen
- Stand wird im Browser zwischengespeichert, die App lässt sich am Handy installieren

Das Foto bleibt im Browser und wird nirgends hochgeladen.

## Aufbau

Statische Seite ohne Build-Schritt.

- `index.html`, `styles.css`: Oberfläche
- `app.js`: Zeichnen, Bedienung, Speichern
- `data.js`: Stammdaten (Produkte, Formate, Farbnummern mit RAL-Näherung) aus öffentlichen PREFA Unterlagen; die hex-Werte sind eigene Bildschirm-Näherungen
- `detect.js`: Flächenerkennung (Farbähnlichkeit ab dem angetippten Punkt, ohne KI-Modell)
- `sw.js`, `manifest.webmanifest`: Installation und Offline-Betrieb

## Starten

`python3 -m http.server` im Ordner starten und die angezeigte Adresse öffnen.

## Offen

- Erkennung mit einem KI-Modell statt über Farbähnlichkeit
- Fotorealistisches Rendering
- Angebotsanfrage mit Empfänger

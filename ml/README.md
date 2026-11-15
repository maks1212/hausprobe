# Eigene Erkennung trainieren

Hausprobe nutzt den Bild-Encoder von EfficientSAM (Apache-2.0) für jedes Foto ohnehin. Darauf sitzen kleine,
eigene Köpfe, die hier trainiert werden. Sie brauchen keine Grafikkarte: Die Encoder-Merkmale werden einmal
berechnet (rund 2 s je Foto auf 2 CPU-Kernen), das Training der Köpfe dauert danach Minuten.

## Fenster und Türen (`hausprobe_fenster.onnx`)

Mittelpunkt-Ansatz: je Zelle des 64 × 64-Gitters eine Wahrscheinlichkeit für die Mitte eines Fensters oder
einer Tür, dazu Breite, Höhe und Versatz. Ergebnis sind Rechtecke, wie sie die Fensterverkleidung braucht.

Startdaten: [building-facades-advertising-dataset](https://github.com/Urban-Research-Lab/building-facades-advertising-dataset)
(CC0, rund 675 Stadtfassaden aus Sankt Petersburg mit markierten Fenstern und Türen).

    python3 embed.py <modelle> <bilder>/images/train <arbeit>/emb/train
    python3 embed.py <modelle> <bilder>/images/test  <arbeit>/emb/test
    python3 train_win.py <arbeit> <bilder> <arbeit>/fenster        # schreibt fenster.onnx

Wichtig: Die Prüffotos des Datensatzes sind Stadtfassaden. Ein länger trainiertes Modell wird dort besser
(nach 40 Durchgängen 97 % Trefferquote, 94 % der Fenster gefunden), findet auf Einfamilienhäusern aber weniger.
Der eingesetzte Stand stammt aus einem frühen Durchgang (Prüffotos: 66 % Trefferquote, 90 % gefunden), der auf
Einfamilienhäusern deutlich besser abschneidet. Erst eigene, markierte Fotos aus Deutschland, Österreich und der
Schweiz erlauben eine verlässliche Bewertung und längeres Training.

## Dach, Wand, Fenster, Tür als Flächen (`hausprobe_flaechen.onnx`)

Daten kommen aus `label.html` (Seite „Trainingsdaten“): Fotos markieren, als ZIP exportieren.

    python3 train_seg.py <modelle> <ausgabe> export1.zip [export2.zip …]

Nur Fotos mit geklärter Lizenz (eigenes Foto, mit Erlaubnis, CC0, CC BY, CC BY-SA) gehen ins Training.
Bei CC BY und CC BY-SA ist eine Namensnennung nötig; die Angaben stehen im `manifest.json` des Exports.

## Auf einem eigenen Server trainieren (`ml/server/`)

`run.sh` erledigt alles auf einem Ubuntu-Server ohne Grafikkarte: lädt COCO-Stuff, wählt Fotos mit Dach oder Haus
und kommerziell nutzbarer Lizenz (CC BY, CC BY-SA, ohne bekannte Rechte, US-Regierung), berechnet die Merkmale,
trainiert das Flächenmodell und lädt das Ergebnis als neuen Branch ins Repo hoch.

    nohup bash ml/server/run.sh > ~/hausprobe-training.log 2>&1 &
    tail -f ~/hausprobe-training.log

Quellenangabe: COCO-Stuff (Caesar, Uijlings, Ferrari), Markierungen CC BY 4.0. Die Liste der verwendeten Fotos
mit Lizenz steht nach dem Lauf in `ml/ergebnis/quellen.json`.

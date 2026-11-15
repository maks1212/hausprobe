#!/usr/bin/env bash
# Hausprobe: Flächenmodell (Dach, Wand, Fenster, Tür) auf einem Ubuntu-Server trainieren.
# Start im geklonten Repo:   nohup bash ml/server/run.sh > ~/hausprobe-training.log 2>&1 &
# Fortschritt ansehen:       tail -f ~/hausprobe-training.log
# Einstellungen (optional):  MAX=4000 Fotos, EPOCHS=30 Durchgänge, W=Arbeitsordner, PUSH=0 kein Hochladen ins Repo
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
W="${W:-$HOME/hausprobe-training}"; MAX="${MAX:-4000}"; PUSH="${PUSH:-1}"
mkdir -p "$W/models"
echo "== $(date '+%F %T') Start, Arbeitsordner $W"
echo "CPU-Kerne: $(nproc)   Arbeitsspeicher: $(free -g | awk '/Mem:/{print $2}') GB   frei auf Platte: $(df -BG --output=avail "$W" | tail -1 | tr -d ' G') GB"
FREE=$(df -BG --output=avail "$W" | tail -1 | tr -d ' G')
if [ "$FREE" -lt 12 ]; then echo "FEHLER: Es werden rund 12 GB freier Platz gebraucht, frei sind $FREE GB."; exit 1; fi
if [ ! -x "$W/venv/bin/python" ]; then
  python3 -m venv "$W/venv" || { echo "FEHLER: Python-venv fehlt. Bitte ausführen: sudo apt update && sudo apt install -y python3-venv"; exit 1; }
fi
. "$W/venv/bin/activate"
echo "== $(date '+%F %T') Python-Pakete"
pip install -q --upgrade pip
pip install -q torch --index-url https://download.pytorch.org/whl/cpu
pip install -q onnxruntime onnx numpy pillow
cp "$REPO/models/efficient_sam_vitt_encoder.onnx" "$W/models/"
echo "== $(date '+%F %T') Daten laden und auswählen"
python3 "$HERE/coco_prep.py" "$W" "$MAX"
echo "== $(date '+%F %T') Merkmale berechnen und trainieren"
THREADS="$(nproc)" python3 "$HERE/train_flaechen.py" "$W/models" "$W"
mkdir -p "$REPO/ml/ergebnis"
cp "$W/out/hausprobe_flaechen.onnx" "$W/out/bericht.txt" "$W/out/vorschau.jpg" "$REPO/ml/ergebnis/"
cp "$W/manifest.json" "$REPO/ml/ergebnis/quellen.json"
if [ "$PUSH" = "1" ]; then
  echo "== $(date '+%F %T') Ergebnis ins Repo hochladen"
  B="modell-flaechen-$(date +%Y%m%d-%H%M)"
  cd "$REPO" && git switch -c "$B" && git add ml/ergebnis \
    && git -c user.name="Hausprobe Server" -c user.email="server@hausprobe.local" commit -q -m "Flächenmodell vom Server ($(date +%F))" \
    && git push -u origin "$B" && echo "Hochgeladen auf Branch $B" || echo "Hochladen hat nicht geklappt. Die Dateien liegen in $REPO/ml/ergebnis."
fi
echo "== $(date '+%F %T') FERTIG"

#!/usr/bin/env bash
# Hausprobe: Flächenmodell (Dach, Wand, Fenster, Tür) auf einem Ubuntu-Server trainieren.
# Start im geklonten Repo:   nohup bash ml/server/run.sh > ~/hausprobe-training.log 2>&1 &
# Fortschritt ansehen:       tail -f ~/hausprobe-training.log
# Einstellungen (optional):  LEHRER=1 vom großen Modell markierte Mapillary-Fotos, CMP=1 zusätzlich CMP-Fassaden, MAX=4000 Fotos, EPOCHS=30 Durchgänge, W=Arbeitsordner, PUSH=0 kein Hochladen ins Repo
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
W="${W:-$HOME/hausprobe-training}"; MAX="${MAX:-4000}"; PUSH="${PUSH:-1}"
mkdir -p "$W/models"
echo "== $(date '+%F %T') Start, Arbeitsordner $W"
echo "CPU-Kerne: $(nproc)   Arbeitsspeicher: $(free -g | awk '/Mem:/{print $2}') GB   frei auf Platte: $(df -BG --output=avail "$W" | tail -1 | tr -d ' G') GB"
FREE=$(df -BG --output=avail "$W" | tail -1 | tr -d ' G')
if [ "$FREE" -lt 12 ]; then echo "FEHLER: Es werden rund 12 GB freier Platz gebraucht, frei sind $FREE GB."; exit 1; fi
# Wenig Arbeitsspeicher: Auslagerungsdatei anlegen, damit Merkmale und Training nicht abbrechen.
MEM=$(free -m | awk '/Mem:/{print $2}'); SWAP=$(free -m | awk '/Swap:/{print $2}')
if [ "$((MEM+SWAP))" -lt 4000 ] && [ "$(id -u)" = "0" ] && [ ! -e /swapfile-hausprobe ]; then
  echo "Wenig Arbeitsspeicher ($MEM MB). Lege 4 GB Auslagerungsdatei an."
  fallocate -l 4G /swapfile-hausprobe || dd if=/dev/zero of=/swapfile-hausprobe bs=1M count=4096
  chmod 600 /swapfile-hausprobe && mkswap /swapfile-hausprobe >/dev/null && swapon /swapfile-hausprobe
fi
[ -e /swapfile-hausprobe ] && swapon --show=NAME | grep -q swapfile-hausprobe || { [ -e /swapfile-hausprobe ] && swapon /swapfile-hausprobe 2>/dev/null || true; }
echo "Auslagerung: $(free -m | awk '/Swap:/{print $2}') MB"
if [ ! -x "$W/venv/bin/python" ]; then
  python3 -m venv "$W/venv" || { echo "FEHLER: Python-venv fehlt. Bitte ausführen: sudo apt update && sudo apt install -y python3-venv"; exit 1; }
fi
. "$W/venv/bin/activate"
echo "== $(date '+%F %T') Python-Pakete"
pip install -q --upgrade pip
pip install -q torch --index-url https://download.pytorch.org/whl/cpu
pip install -q onnxruntime onnx numpy pillow
command -v curl >/dev/null || command -v wget >/dev/null || apt-get install -y -q curl >/dev/null 2>&1 || true
cp "$REPO/models/efficient_sam_vitt_encoder.onnx" "$W/models/"
echo "== $(date '+%F %T') Daten laden und auswählen"
python3 "$HERE/coco_prep.py" "$W" "$MAX"
[ "${CMP:-0}" = "1" ] && python3 "$HERE/cmp_prep.py" "$W"
[ "${LEHRER:-0}" = "1" ] && python3 "$HERE/lehrer_prep.py" "$W" "$REPO"
cp "$REPO/models/hausprobe_flaechen.onnx" "$W/models/hausprobe_flaechen_alt.onnx"
rm -f "$W/models/hausprobe_flaechen_alt.train.txt"; [ -f "$REPO/models/hausprobe_flaechen.train.txt" ] && cp "$REPO/models/hausprobe_flaechen.train.txt" "$W/models/hausprobe_flaechen_alt.train.txt"
echo "== $(date '+%F %T') Merkmale berechnen und trainieren"
THREADS="$(nproc)" python3 "$HERE/train_flaechen.py" "$W/models" "$W"
mkdir -p "$REPO/ml/ergebnis"
cp "$W/out/hausprobe_flaechen.onnx" "$W/out/bericht.txt" "$W/out/vorschau.jpg" "$W/out/hausprobe_flaechen.train.txt" "$REPO/ml/ergebnis/"
cp "$W/manifest.json" "$REPO/ml/ergebnis/quellen.json"
if [ "$PUSH" = "1" ]; then
  echo "== $(date '+%F %T') Ergebnis ins Repo hochladen"
  B="modell-flaechen-$(date +%Y%m%d-%H%M)"
  cd "$REPO" && git switch -c "$B" && git add ml/ergebnis \
    && git -c user.name="Hausprobe Server" -c user.email="server@hausprobe.local" commit -q -m "Flächenmodell vom Server ($(date +%F))" \
    && git push -u origin "$B" && echo "Hochgeladen auf Branch $B" || echo "Hochladen hat nicht geklappt. Die Dateien liegen in $REPO/ml/ergebnis."
  git -C "$REPO" switch -q main   # zurück, damit der Auftragsbriefkasten weiter die aktuelle Fassung nutzt
fi
echo "== $(date '+%F %T') FERTIG"

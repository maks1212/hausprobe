# App-Modell mit den vom großen Modell markierten Mapillary-Fotos (+ COCO) trainieren.
# Die Fotosammlung (006) wird solange angehalten, damit der kleine Server nicht überlastet.
set -uo pipefail
echo "Start $(date '+%F %T')"
pkill -STOP -f mapillary_fetch.py && echo "Sammlung angehalten"
trap 'pkill -CONT -f mapillary_fetch.py && echo "Sammlung läuft weiter"' EXIT
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q
LEHRER=1 bash ~/hausprobe/ml/server/run.sh

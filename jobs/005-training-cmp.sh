# Flächenmodell neu trainieren: COCO-Häuser plus CMP-Fassaden. Wartet, bis die Mapillary-Sammlung fertig ist,
# damit sich beide nicht die 2 CPU-Kerne teilen.
set -uo pipefail
while pgrep -f mapillary_fetch.py >/dev/null; do sleep 120; done
echo "Start $(date '+%F %T')"
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q
CMP=1 bash ~/hausprobe/ml/server/run.sh

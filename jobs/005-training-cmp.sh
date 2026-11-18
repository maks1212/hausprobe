# Flächenmodell neu trainieren: COCO-Häuser plus CMP-Fassaden. Wartet, bis die Mapillary-Sammlung fertig ist,
# Sperre des Briefkastens freigeben (ältere Fassung gab sie an Aufträge weiter), damit Zwischenstände ankommen.
flock -u 9 2>/dev/null || true
# damit sich beide nicht die 2 CPU-Kerne teilen.
set -uo pipefail
sleep 30; until [ -e ~/auftraege/results/004-mapillary.done ] && ! pgrep -f mapillary_fetch.py >/dev/null; do sleep 120; done
echo "Start $(date '+%F %T')"
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q
CMP=1 bash ~/hausprobe/ml/server/run.sh

#!/bin/bash
# Autopilot (nachts per cron): neu trainieren, sobald genug neue vom Lehrer markierte Fotos da sind.
# Ergebnis wie bei jedem Training: Branch modell-flaechen-<zeit> mit bericht.txt. Übernommen in die App wird es
# erst nach Prüfung (Vergleich mit dem bisherigen Modell auf denselben Prüffotos, Sichtprüfung an Testhäusern).
set -uo pipefail
exec >>/root/auto_train.log 2>&1
echo "== $(date '+%F %T') Autopilot"
pgrep -f train_flaechen.py >/dev/null && { echo "Training läuft schon"; exit 0; }
cd /root/hausprobe && git switch -q main 2>/dev/null; timeout 120 git pull -q || exit 0
timeout 300 git fetch -q origin "+refs/heads/lehrer-ergebnis:refs/remotes/origin/lehrer-ergebnis" || exit 0
n=$(git ls-tree -r --name-only refs/remotes/origin/lehrer-ergebnis | grep -c 'lehrer-paket-.*\.zip$')
alt=$(cat /root/.auto_train_pakete 2>/dev/null || echo 0)
echo "Lehrer-Pakete: $n (beim letzten Training $alt)"
[ "$n" -ge $((alt+3)) ] || [ "${1:-}" = "jetzt" ] || exit 0
pkill -STOP -f mapillary_fetch.py && echo "Sammlung angehalten"
trap 'pkill -CONT -f mapillary_fetch.py && echo "Sammlung läuft weiter"' EXIT
LEHRER=1 bash /root/hausprobe/ml/server/run.sh && echo "$n" > /root/.auto_train_pakete

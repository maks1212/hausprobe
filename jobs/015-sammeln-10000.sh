# Fotosammlung bis 10.000 Fotos, in Schritten zu 250, mit 36 Gegenden (Code auf main seit 9794624).
set -uo pipefail
echo "Start $(date '+%F %T')"
systemctl is-active mly-sammeln && { echo "Sammlung läuft noch"; exit 0; }
cd ~/hausprobe && git pull -q; echo "Code: $(git log --oneline -1)"
grep -c "Erweiterung für 10.000" ml/server/mapillary_fetch.py
Z="$(seq -s ' ' 3250 250 10000)"
sed -i "s/for ziel in .*; do/for ziel in $Z; do/" ~/sammeln.sh
grep -n "for ziel\|FACTOR" ~/sammeln.sh
df -h / | tail -1
systemd-run --unit=mly-sammeln --collect bash ~/sammeln.sh && echo "Sammlung gestartet"
sleep 5; systemctl is-active mly-sammeln

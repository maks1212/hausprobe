# Fotosammlung fortsetzen: 2100 bis 3000 Fotos. Markieren ist nicht mehr durch Action-Minuten begrenzt (Repo öffentlich).
set -uo pipefail
echo "Start $(date '+%F %T')"
systemctl is-active mly-sammeln && { echo "Sammlung läuft schon"; exit 0; }
cd ~/hausprobe && git pull -q; echo "Code: $(git log --oneline -1)"
sed -i 's/for ziel in .*; do/for ziel in 2100 2200 2300 2400 2500 2600 2700 2800 2900 3000; do/' ~/sammeln.sh
grep -n "for ziel\|FACTOR" ~/sammeln.sh
systemd-run --unit=mly-sammeln --collect bash ~/sammeln.sh && echo "Sammlung gestartet"
sleep 5; systemctl is-active mly-sammeln

# Fotosammlung fortsetzen: 1600 bis 2000 Fotos (Markier-Kontingent November reicht für ~500).
# Vorauswahl jetzt mit Modell v4 und strenger (sichtbare Wand UND Fenster), damit weniger leere Straßenfotos durchkommen.
set -uo pipefail
echo "Start $(date '+%F %T')"
systemctl is-active mly-sammeln && { echo "Sammlung läuft schon"; exit 0; }
cd ~/hausprobe && git pull -q; echo "Code: $(git log --oneline -1)"
sed -i 's/for ziel in .*; do/for ziel in 1600 1700 1800 1900 2000; do/; s/LOCKER=1 FACTOR=40/FACTOR=40/' ~/sammeln.sh
grep -n "export HOME" ~/sammeln.sh >/dev/null || sed -i '1i export HOME=/root' ~/sammeln.sh
grep -n "for ziel\|FACTOR" ~/sammeln.sh
systemd-run --unit=mly-sammeln --collect bash ~/sammeln.sh && echo "Sammlung gestartet"
sleep 5; systemctl is-active mly-sammeln

# Fotosammlung reparieren: Runde "Ziel 800" hat 6 h nur gesucht (zu viele Kandidaten) und nichts geladen.
# Neuer Code (sucht nur fehlende Kandidaten) und Ziele in 100er-Schritten, 12 h Zeitgrenze je Runde.
set -uo pipefail
echo "Start $(date '+%F %T')"
systemctl stop mly-sammeln 2>/dev/null; sleep 2
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q && echo "Code: $(git log --oneline -1)"
cat > ~/sammeln.sh <<'S'
. ~/hausprobe-training/venv/bin/activate; D=~/daten-branch; L=~/auftraege/results/sammeln.log
for ziel in 800 900 1000 1100 1200 1300 1400 1500; do
  (cd ~/hausprobe && git pull -q 2>/dev/null)
  echo "== $(date '+%F %T') Ziel $ziel Fotos" >> $L
  LOCKER=1 FACTOR=40 timeout 12h python3 ~/hausprobe/ml/server/mapillary_fetch.py ~/hausprobe/models ~/mapillary "$ziel" 2>&1 | grep --line-buffered -E "Kandidaten|Bereits|Paket|FERTIG|Fehler|behalten" >> $L
  cd "$D" && git pull -q --rebase origin daten 2>/dev/null; mkdir -p pakete && cp ~/mapillary/pakete/*.zip pakete/ && git add pakete \
    && git -c user.name="Hausprobe Server" -c user.email="server@hausprobe.local" commit -q -m "Mapillary-Pakete bis $ziel" \
    && git push -q origin daten && echo "hochgeladen: $(ls pakete | wc -l) Pakete" >> $L
  cd ~
done
S
systemd-run --unit=mly-sammeln --collect bash ~/sammeln.sh && echo "Sammlung neu gestartet (systemd mly-sammeln)"
sleep 5; systemctl is-active mly-sammeln; ls ~/mapillary/pakete | tail -2

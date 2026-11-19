# Schnell besser werden: Sammlung im Hintergrund weiterlaufen lassen (ohne Zeitgrenze des Briefkastens),
# warten bis der Lehrer die Pakete 013–016 markiert hat, dann sofort trainieren.
set -uo pipefail
echo "Start $(date '+%F %T')"
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q && echo "Code: $(git log --oneline -1)"
cat > ~/sammeln.sh <<'S'
. ~/hausprobe-training/venv/bin/activate; D=~/daten-branch; L=~/auftraege/results/sammeln.log
for ziel in 700 800 900 1000 1200 1500; do
  echo "== $(date '+%F %T') Ziel $ziel Fotos" >> $L
  LOCKER=1 FACTOR=40 timeout 6h python3 ~/hausprobe/ml/server/mapillary_fetch.py ~/hausprobe/models ~/mapillary "$ziel" 2>&1 | grep --line-buffered -E "Kandidaten|Bereits|Paket|FERTIG|Fehler|Error" >> $L
  cd "$D" && git pull -q --rebase origin daten 2>/dev/null; mkdir -p pakete && cp ~/mapillary/pakete/*.zip pakete/ && git add pakete \
    && git -c user.name="Hausprobe Server" -c user.email="server@hausprobe.local" commit -q -m "Mapillary-Pakete bis $ziel" \
    && git push -q origin daten && echo "hochgeladen: $(ls pakete | wc -l) Pakete" >> $L
  cd ~
done
S
systemctl stop mly-sammeln 2>/dev/null; systemd-run --unit=mly-sammeln --collect bash ~/sammeln.sh && echo "Sammlung läuft im Hintergrund (systemd mly-sammeln)"
cd ~/hausprobe
for t in $(seq 1 60); do
  git fetch -q origin "+refs/heads/lehrer-ergebnis:refs/remotes/origin/lehrer-ergebnis"
  n=$(git ls-tree -r --name-only refs/remotes/origin/lehrer-ergebnis | grep -cE 'lehrer-paket-01[3-6]\.zip$')
  echo "$(date '+%T') Lehrer fertig mit $n von 4 neuen Paketen"; [ "$n" -ge 4 ] && break; sleep 180
done
bash ~/hausprobe/ml/server/auto_train.sh jetzt; echo "Training beendet $(date '+%F %T'), Protokoll in results/autopilot.log"

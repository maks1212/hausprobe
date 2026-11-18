# Mehr Fotos für die Lehrer-Markierung: in Schritten bis 1000 Fotos sammeln, nach jedem Schritt hochladen.
set -uo pipefail
[ -s ~/.mapillary_token ] || { echo "Kein Mapillary-Schlüssel gefunden, Auftrag beendet."; exit 1; }
echo "Start $(date '+%F %T')"
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q
. ~/hausprobe-training/venv/bin/activate
URL="$(git -C ~/hausprobe remote get-url origin)"; D=~/daten-branch
for ziel in 300 400 500 600 700 800 900 1000; do
  echo "== $(date '+%F %T') Ziel $ziel Fotos"
  LOCKER=1 FACTOR=40 python3 ~/hausprobe/ml/server/mapillary_fetch.py ~/hausprobe/models ~/mapillary "$ziel" 2>&1 | grep -E "Kandidaten|Bereits|Paket|FERTIG|Fehler|Error" 
  cd "$D" && git pull -q --rebase origin daten 2>/dev/null; mkdir -p pakete && cp ~/mapillary/pakete/*.zip pakete/ && git add pakete \
    && git -c user.name="Hausprobe Server" -c user.email="server@hausprobe.local" commit -q -m "Mapillary-Pakete bis $ziel" \
    && git push -q origin daten && echo "hochgeladen: $(ls pakete | wc -l) Pakete"
  cd ~
done
echo "Ende $(date '+%F %T')"

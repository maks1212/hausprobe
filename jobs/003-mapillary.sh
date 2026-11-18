# Mapillary-Fotos sammeln, vormarkieren und als Pakete auf den Branch "daten" hochladen.
set -uo pipefail
[ -s ~/.mapillary_token ] || { echo "Kein Mapillary-Schlüssel gefunden, Auftrag beendet."; exit 1; }
echo "Start $(date '+%F %T')"
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q
. ~/hausprobe-training/venv/bin/activate
python3 ~/hausprobe/ml/server/mapillary_fetch.py ~/hausprobe/models ~/mapillary 200 || exit 1
URL="$(git -C ~/hausprobe remote get-url origin)"; D=~/daten-branch
if [ ! -d "$D/.git" ]; then
  git clone -q --single-branch -b daten "$URL" "$D" 2>/dev/null || { mkdir -p "$D" && cd "$D" && git init -q -b daten && git remote add origin "$URL"; }
fi
mkdir -p "$D/pakete" && cp ~/mapillary/pakete/*.zip "$D/pakete/" && cd "$D" && git add pakete \
  && git -c user.name="Hausprobe Server" -c user.email="server@hausprobe.local" commit -q -m "Mapillary-Pakete $(date +%F)" \
  && git push -q -u origin daten && echo "Pakete hochgeladen:" && ls -la pakete

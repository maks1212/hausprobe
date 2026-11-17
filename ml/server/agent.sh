#!/usr/bin/env bash
# Auftragsbriefkasten für den Trainingsserver.
# Läuft alle 5 Minuten per cron. Holt den Branch "server" in ~/auftraege, startet neue Aufträge aus jobs/
# (je eine .sh-Datei) im Hintergrund und lädt Protokolle und Ergebnisse nach results/ zurück.
# Abschalten: crontab -r
set -uo pipefail
B="${AUFTRAG_BRANCH:-server}"; D="$HOME/auftraege"; REPO_URL="$(git -C "$HOME/hausprobe" remote get-url origin)"
exec 9>"$HOME/.agent.lock"; flock -n 9 || exit 0
if [ ! -d "$D/.git" ]; then git clone -q --single-branch -b "$B" "$REPO_URL" "$D" || exit 1; fi
cd "$D" || exit 1
git fetch -q origin "$B" && git merge -q --ff-only "origin/$B" 2>/dev/null || git reset -q --hard "origin/$B"
mkdir -p results jobs
for j in jobs/*.sh; do
  [ -e "$j" ] || continue
  n="$(basename "$j" .sh)"
  [ -e "results/$n.done" ] || [ -e "results/$n.running" ] && continue
  echo "$(date '+%F %T')" > "results/$n.running"
  ( cd "$HOME/hausprobe" && git pull -q 2>/dev/null; cd "$D"
    timeout 20h bash "$D/$j" > "$D/results/$n.log" 2>&1; echo "Exitcode $?" >> "$D/results/$n.log"
    rm -f "$D/results/$n.running"; date '+%F %T' > "$D/results/$n.done" ) </dev/null >/dev/null 2>&1 &
  disown
done
sleep 2
# Protokolle kürzen, damit das Repo klein bleibt, und hochladen, wenn sich etwas geändert hat.
for f in results/*.log; do [ -e "$f" ] && [ "$(wc -l < "$f")" -gt 400 ] && { tail -400 "$f" > "$f.tmp"; mv "$f.tmp" "$f"; }; done
git add -A results >/dev/null 2>&1
if ! git diff --cached --quiet; then
  git -c user.name="Hausprobe Server" -c user.email="server@hausprobe.local" commit -q -m "Status $(date '+%F %T')"
  git push -q origin "HEAD:$B" 2>/dev/null || { git fetch -q origin "$B" && git rebase -q "origin/$B" && git push -q origin "HEAD:$B"; }
fi

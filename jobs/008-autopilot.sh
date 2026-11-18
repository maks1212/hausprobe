set -uo pipefail
echo "Start $(date '+%F %T')"
cd ~/hausprobe && git switch -q main 2>/dev/null; git pull -q && echo "Code: $(git log --oneline -1)"
( crontab -l 2>/dev/null | grep -v auto_train.sh; echo "23 1 * * * bash /root/hausprobe/ml/server/auto_train.sh" ) | crontab -
echo "cron:"; crontab -l
echo "Autopilot eingerichtet: jede Nacht 01:23 Training, wenn mindestens 3 neue Lehrer-Pakete da sind."

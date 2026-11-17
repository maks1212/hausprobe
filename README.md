# Aufträge für den Trainingsserver

Jede Datei in `jobs/` ist ein Auftrag (Bash-Skript). Der Server prüft alle 5 Minuten (`ml/server/agent.sh` im
Branch `main`), startet neue Aufträge und legt Protokoll und Ergebnis in `results/` ab:
`<name>.running` solange er läuft, `<name>.log` das Protokoll, `<name>.done` wenn er fertig ist.

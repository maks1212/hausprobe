# Erster Auftrag: prüft, ob der Briefkasten funktioniert, und meldet die Ausstattung des Servers.
echo "Briefkasten läuft als $(whoami) auf $(hostname)"
echo "CPU-Kerne: $(nproc)"; free -m; df -h / | tail -1
python3 --version
test -f ~/.mapillary_token && echo "Mapillary-Schlüssel: vorhanden" || echo "Mapillary-Schlüssel: fehlt"
ls ~/hausprobe-training/out 2>/dev/null

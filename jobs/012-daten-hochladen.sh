# Gesammelte Pakete 017-032 hochladen (Push aus dem systemd-Dienst scheiterte: kein HOME, keine Zugangsdaten)
set -u
cd ~/daten-branch && git push origin daten 2>&1 | tail -2; git log -1 --format='%ci %s'
sed -i '1i export HOME=/root' ~/sammeln.sh; head -2 ~/sammeln.sh

# Diagnose Fotosammlung: Pakete, Prozesse, Upload
set -u
date '+%F %T'; systemctl status mly-sammeln --no-pager 2>&1 | head -12
ps -eo pid,etime,args | grep -E "mapillary_fetch|sammeln" | grep -v grep
. ~/hausprobe-training/venv/bin/activate
python3 - <<'P'
import zipfile,json,os
d=os.path.expanduser('~/mapillary/pakete');ids=set()
for f in sorted(os.listdir(d)):
    try:
        m=json.loads(zipfile.ZipFile(d+'/'+f).read('manifest.json'));n=len(m['items']);ids|={i['id'] for i in m['items']}
        print(f,n,os.path.getsize(d+'/'+f)//1024,'KB')
    except Exception as e:print(f,'FEHLER',e)
print('eindeutige Fotos',len(ids))
P
ls -la --time-style=+%F_%T ~/mapillary/pakete | tail -6
journalctl -u mly-sammeln --no-pager -n 30 2>&1 | grep -v "Error 500" | tail -20
cd ~/daten-branch && git status -sb | head -5 && git log -2 --format='%ci %s' && git pull --rebase origin daten 2>&1 | tail -3
df -h ~ | tail -1; free -m | head -2

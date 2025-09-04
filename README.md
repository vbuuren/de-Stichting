# de-Stichting — Volledige installatiehandleiding (voor dummies)

**Korte omschrijving:**
Een complete ledenadministratie + uitjes-website (frontend + backend) die draait in een Proxmox container. Login met **gebruikersnaam** (met hoofdletter als in DB) en tijdelijk wachtwoord `1234`. Admins: `Marcel`, `Dennis`. Gebruikers: `Roelie`, `Sandra`.

---

## Wat je krijgt in deze map
- `/backend` — Node/Express backend (Prisma + SQLite)
- `/frontend` — Vite + React frontend
- `/install/deploy.sh` — Eén script dat alles installeert en configureert
- `/install/destichting-backend.service` — systemd service (referentie)
- `/install/nginx-destichting.conf` — nginx site (referentie)

---

## Voorbereiding (Windows -> Proxmox)
Je hebt nodig:
- Toegang tot de Proxmox container `ct102` (IP **192.168.1.103**). Root login via SSH.
- WinSCP of scp om bestanden te kopiëren.
- GitHub account om de code in je private repo te pushen (optioneel maar aanbevolen).

### 1) Maak de GitHub repo (optioneel maar aanbevolen)
1. Ga naar https://github.com en maak een **private** repository `vbuuren/de-Stichting`.
2. Gebruik SSH of HTTPS to push. (Als je HTTPS gebruikt en repo private is, maak een Personal Access Token (PAT) met `repo` scope.)

**Push vanaf je Windows PC** (PowerShell):
```powershell
cd D:\Users\vbuur\Downloads\
unzip de-Stichting-final.zip -d de-Stichting
cd de-Stichting

git init
git branch -M main
git add .
git commit -m "Initial commit: de Stichting full setup"
# Replace the remote URL below: use your GitHub repo URL
git remote add origin https://github.com/vbuuren/de-Stichting.git
# If repo is private and you use HTTPS, you can push with a PAT like:
# git push https://<your-github-username>:<PAT>@github.com/vbuuren/de-Stichting.git --set-upstream origin main
git push -u origin main
```

**Alternatief (WinSCP):** upload de hele folder `/de-Stichting` naar een tijdelijke map op je container, bv `/root/`.

---

## Deploy naar de Proxmox container ct102 (stap-voor-stap, exact)
**Aannames:** Container draait Debian/Ubuntu en je kunt SSH inloggen als root. Root-wachtwoord dat je noemde: `Mars72pr`.

### 1) Kopieer de bestanden naar de container
**Via PowerShell (scp):**
```powershell
# vanuit D:\Users\vbuur\Downloads\
scp -r de-Stichting root@192.168.1.103:/root/de-Stichting
```

**Via WinSCP (GUI):**
1. Open WinSCP -> New Site -> Protocol: SFTP -> Host name: `192.168.1.103` -> Username: `root` -> Password: `Mars72pr` -> Login.
2. Upload de volledige `de-Stichting` directory naar `/root/`.

### 2) Inloggen op de container
Open PowerShell of PuTTY:
```powershell
ssh root@192.168.1.103
# password: Mars72pr
```

### 3) Verplaats bestanden naar juiste plek en maak uitvoerbaar
```bash
# als je de zip hebt ge-upload, unzip anders copy:
cd /root
# als je ge-upload als folder:
mv de-Stichting /opt/destichting
# of unzip:
# unzip de-Stichting-final.zip -d /opt/destichting
cd /opt/destichting/install
chmod +x deploy.sh
```

### 4) Start het deploy-script (zorg dat je root bent / sudo)
```bash
sudo ./deploy.sh
```
**Wat het script doet (kort):**
- `apt update` + installeert Node, npm, sqlite3, nginx, git, openssl, locales
- genereert `en_US.UTF-8` en `nl_NL.UTF-8` locales
- installeert backend dependencies (inclusief Prisma)
- `prisma generate` en `prisma migrate deploy` (met fallback naar `prisma db push`)
- seed database (maakt gebruikers Marcel, Dennis, Roelie, Sandra met wachtwoord 1234)
- build frontend en kopieert `dist/` naar `/var/www/destichting`
- maakt `/etc/destichting/backend.env` aan met een veilig gegenereerde `JWT_SECRET`
- maakt systemd service `destichting-backend.service` en start deze
- configureert nginx en herstart nginx

**Controleer output** tijdens run — het script toont fouten als iets faalt.

### 5) Nagaan of alles draait
- Backend service:
```bash
systemctl status destichting-backend --no-pager
# of live logs:
journalctl -u destichting-backend -f
```
- Nginx:
```bash
nginx -t
systemctl status nginx --no-pager
```
- Toegang:
  - Open browser op je werkstation en ga naar `http://192.168.1.103` of `http://destichting.ddns.net`.

---

## Inloggen en eerste stappen
- Inlogtype: **gebruikersnaam** (exacte hoofdletter zoals in seed)
- Wachtwoord (tijdelijk): `1234` (verplicht wijzigen bij 1e login)

Accounts uit seed:
- **Admin:** Marcel / 1234
- **Admin:** Dennis / 1234
- **User:** Roelie / 1234
- **User:** Sandra / 1234

Bij eerste login krijg je een dialoog om het wachtwoord te wijzigen.

---

## Hoe push je updates naar de container vanaf GitHub (recommended workflow)
1. Werk lokaal aan code, commit en push naar GitHub.
2. Op de container:
```bash
# stop service, update files and redeploy
cd /opt/destichting
git pull origin main
# then re-run backend install & prisma generate & build frontend:
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy || npx prisma db push --accept-data-loss
npm run prisma:seed || true
cd ../frontend
npm ci
npm run build
sudo rsync -a dist/ /var/www/destichting/
sudo systemctl restart destichting-backend
sudo systemctl restart nginx
```

> Tip: gebruik a dedicated deploy user or CI in future. For now this manual `git pull` is simple and works.

---

## Troubleshooting (veelvoorkomende issues en fixes)
- `502 Bad Gateway` in nginx: controleer backend service `systemctl status destichting-backend` en `journalctl -u destichting-backend -n 200`.
- `EACCES` permission errors when writing uploads: controleer `/var/lib/destichting/uploads` owner (`www-data:www-data`) and permissions.
- Prisma errors about migrations: run `npx prisma migrate dev --name init` locally to generate migration folder, or the script will have used `prisma db push` as fallback.
- Can't push to GitHub (private repo): create a PAT (Personal Access Token) and push using `https://<username>:<PAT>@github.com/...` or use SSH keys.

---

## Security notes
- **VERANDER JWT_SECRET** of houd het bestand `/etc/destichting/backend.env` veilig; het script generates a secure random secret for you.
- Verander root-wachtwoord en gebruik SSH-keys for future access rather than password auth.

---

## Logs & useful commands
```bash
# Backend logs
journalctl -u destichting-backend -f
# Nginx logs
tail -f /var/log/nginx/error.log /var/log/nginx/access.log
# Check DB contents (sqlite)
sqlite3 /opt/destichting/backend/prisma/dev.db "select id, username, role, mustChangePassword from User;"
```

---

## Hulp nodig?
Reageer hier met de foutmelding en ik help je stap voor stap met de fix.

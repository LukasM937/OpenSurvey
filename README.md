# Deutsche Gesellschaftsstudie

Anonymous survey on demographics, politics, attitudes, and living conditions in Germany.

**Domain:** `survey.muehrke.de`  
**Stack:** React · FastAPI · Apache · systemd  
**Questions:** 157 in 17 sections  
**Schema-Hash:** `acffb1411db2fd29f364346686654a3357a3700d9b1229d96495b49678a4146f`

---

## Architecture

```
Browser / iPhone
      │  HTTPS
      ▼
Apache (survey.muehrke.de)
  ├── /api/survey      → POST only → uvicorn 127.0.0.1:8742
  ├── /api/newsletter  → POST only → uvicorn 127.0.0.1:8742
  ├── /health          → localhost only
  ├── /results         → public aggregated results dashboard
  └── /admin           → localhost + Tailscale only (token-protected)
      ▼
uvicorn / FastAPI  (server.py)
  ├── Survey data     os.open("x", 0o600)
  │   └── /var/data/survey/YYYY-MM/YYYYMMDDTHHMMSSZ_{id}.json
  └── Newsletter      hybrid RSA-4096 + AES-256-GCM
      └── /var/data/newsletter/subscribers.ndjson
```

---

## Repository Layout

```
src/survey/umfrage.jsx              React frontend (157 questions, i18n, skip logic, tooltips)
src/survey/umfrage_struktur.json    Machine-readable question schema
src/server/server.py                FastAPI backend (hardened, encrypted newsletter)
src/server/aggregator.py            Data aggregation + k-anonymity export
src/server/newsletter_keygen.py     RSA-4096 keypair generation (run once)
src/server/newsletter_decrypt.py    Decrypt newsletter addresses
src/server/requirements.txt         Python dependencies
src/admin/index.html                Admin dashboard (token-protected, local only)
src/results/index.html              Public aggregated results page
deploy/umfrage-server.service       Systemd unit with hardening
deploy/survey.muehrke.de.conf       Apache HTTP → HTTPS redirect
deploy/survey.muehrke.de-le-ssl.conf Apache HTTPS + proxy
```

---

## Prerequisites

- Debian 12 / Ubuntu 22.04 LTS (tested on Raspberry Pi)
- Python 3.11+
- Node ≥ 20 (for frontend build)
- Apache2 with mod_proxy, mod_headers, mod_ssl, mod_rewrite
- certbot (Let's Encrypt)
- systemd

---

## 1 · Users and Directories

```bash
# Survey user (runs the server process)
sudo useradd -r -s /sbin/nologin -d /opt/survey-server umfrage

# Newsletter user (only one who can decrypt)
sudo useradd -r -m -s /bin/bash newsletter

# Directories
sudo mkdir -p /opt/survey-server /var/data/survey /var/data/newsletter /etc/survey

# Survey data path
sudo chown umfrage:umfrage /var/data/survey
sudo chmod 700 /var/data/survey
sudo chattr +a /var/data/survey        # append-only: deletion not possible
lsattr -d /var/data/survey            # check: -----a--------e----

# Newsletter directory: umfrage can write but not read
sudo chown newsletter:newsletter /var/data/newsletter
sudo chmod 730 /var/data/newsletter
sudo usermod -aG newsletter umfrage   # umfrage joins newsletter group

# Code directory
sudo chown -R root:umfrage /opt/survey-server
sudo chmod 750 /opt/survey-server
```

---

## 2 · Python Environment

```bash
sudo python3 -m venv /opt/survey-server/venv
sudo /opt/survey-server/venv/bin/pip install \
    fastapi "uvicorn[standard]" cryptography

sudo cp src/server/server.py src/server/aggregator.py /opt/survey-server/
sudo chmod 440 /opt/survey-server/server.py
sudo chown root:umfrage /opt/survey-server/server.py /opt/survey-server/aggregator.py
```

---

## 3 · Newsletter Keypair (once)

```bash
sudo cp src/server/newsletter_keygen.py /home/newsletter/
sudo -u newsletter python3 /home/newsletter/newsletter_keygen.py
# → /home/newsletter/private/newsletter_priv.pem  (chmod 600)
# → /etc/survey/newsletter_pub.pem                (chmod 644)
```

---

## 4 · Admin Token

Generate a random token and add it to the systemd service:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Add to `/etc/systemd/system/umfrage-server.service`:

```ini
Environment=ADMIN_TOKEN=<paste-token-here>
```

The admin dashboard at `/admin` requires this token. It is only reachable from
`127.0.0.1` and Tailscale (`100.x.x.x`) at both the Apache and application layer.

---

## 5 · Systemd Service

```bash
sudo cp deploy/umfrage-server.service /etc/systemd/system/

# Edit to set your values:
#   SURVEY_DATA_DIR=/var/data/survey
#   SURVEY_ALLOWED_ORIGINS=https://survey.muehrke.de
#   NEWSLETTER_PUBKEY=/etc/survey/newsletter_pub.pem
#   ADMIN_TOKEN=<generated-above>
sudo nano /etc/systemd/system/umfrage-server.service

sudo systemctl daemon-reload
sudo systemctl enable --now umfrage-server
sudo systemctl status umfrage-server

# Expected startup line:
# Schema-Hash: acffb1411db2fd29...  (157 Fragen)
```

---

## 6 · Apache

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite

sudo cp deploy/survey.muehrke.de.conf /etc/apache2/sites-available/
sudo cp deploy/survey.muehrke.de-le-ssl.conf /etc/apache2/sites-available/

sudo a2ensite survey.muehrke.de
sudo apache2ctl configtest && sudo systemctl reload apache2

sudo certbot --apache -d survey.muehrke.de

sudo a2ensite survey.muehrke.de-le-ssl
sudo apache2ctl configtest && sudo systemctl reload apache2
```

---

## 7 · Frontend Build

```bash
nvm install 20 && nvm use 20

cd src/survey
npm create vite@latest survey-frontend -- --template react
cp umfrage.jsx survey-frontend/src/App.jsx
cd survey-frontend
npm install && npm run build

sudo mkdir -p /var/www/survey
sudo cp -r dist/* /var/www/survey/
sudo chown -R www-data:www-data /var/www/survey
```

Add to `deploy/survey.muehrke.de-le-ssl.conf`:

```apache
DocumentRoot /var/www/survey
<Directory /var/www/survey>
    Options -Indexes
    AllowOverride None
    Require all granted
    FallbackResource /index.html
</Directory>
```

---

## 8 · Dashboard Pages

```bash
# Deploy admin and results dashboard HTML files
sudo mkdir -p /opt/survey-server/admin /opt/survey-server/results
sudo cp src/admin/index.html /opt/survey-server/admin/
sudo cp src/results/index.html /opt/survey-server/results/
sudo chown -R root:umfrage /opt/survey-server/admin /opt/survey-server/results
sudo chmod 640 /opt/survey-server/admin/index.html /opt/survey-server/results/index.html

# Admin dashboard (localhost / Tailscale only):
#   https://survey.muehrke.de/admin  →  enter token from ADMIN_TOKEN env var
# Public results page:
#   https://survey.muehrke.de/results
```

---

## 9 · CORS

```ini
# Own domain only:
Environment=SURVEY_ALLOWED_ORIGINS=https://survey.muehrke.de

# Claude Artifact or multiple domains:
Environment=SURVEY_ALLOWED_ORIGINS=*
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart umfrage-server
```

---

## 10 · Testing

```bash
# Health check (localhost only)
curl http://localhost:8742/health
# → {"status":"ok","submissions":0,"by_month":{},...}

# Correct test submission
HASH="acffb1411db2fd29f364346686654a3357a3700d9b1229d96495b49678a4146f"
curl -X POST https://survey.muehrke.de/api/survey \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"test001\",\"schema_hash\":\"$HASH\",\"responses\":{}}"
# → {"status":"ok"}

# Admin stats (requires token)
curl http://localhost:8742/admin/api/stats \
  -H "X-Admin-Token: <your-token>"

# Public results
curl http://localhost:8742/results/api/stats

# Clean up test file
sudo chattr -a /var/data/survey
sudo find /var/data/survey -name "*test001*" -delete
sudo chattr +a /var/data/survey
```

---

## 11 · Newsletter Management

```bash
sudo cp src/server/newsletter_decrypt.py /home/newsletter/
sudo chown newsletter:newsletter /home/newsletter/newsletter_decrypt.py
sudo chmod 700 /home/newsletter/newsletter_decrypt.py

sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py          # all
sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py --csv    # CSV export
sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py --count  # count only
sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py --since 2025-05
```

---

## 12 · Data Export (Scientific)

The admin dashboard (`/admin`) provides a **Scientific Dataset** export button.
The dataset is k-anonymized:

- Free-text answers (Q052, Q064) and postal codes (Q121) are excluded
- Regional breakdowns only for Bundesländer with **≥ 50 submissions**
- Suppressed regions contribute to national totals but are not listed individually
- Timestamps are rounded to `YYYY-MM`

For manual export:

```bash
curl http://localhost:8742/admin/api/export \
  -H "X-Admin-Token: <your-token>" \
  > export_$(date +%Y%m%d).json
```

---

## 13 · Schema Updates (Adding Questions)

1. Add question to `umfrage.jsx` → SECTIONS (new ID e.g. Q158)
2. Recalculate hash:
   ```bash
   python3 -c "
   import hashlib, json
   ids = sorted([f'Q{i:03d}' for i in range(1, 159)])
   print(hashlib.sha256(json.dumps(ids, separators=(',',':')).encode()).hexdigest())
   "
   ```
3. Update `SCHEMA_HASH` in `umfrage.jsx`
4. In `server.py`: add to `VALID_QUESTION_IDS` and `QUESTION_TYPES`

| Survey type | Server type |
|---|---|
| `radio`, `text`, `party_single`, `plz` | `str` |
| `check`, `party_multi` | `list` |
| `likert5` | `int1-5` |
| `slider7` | `int1-7` |
| `scale10` | `int0-10` |
| `number` | `int` |

---

## 14 · Monthly Rotation (cron)

```bash
# /etc/cron.d/survey-freeze
5 0 1 * * root chattr +a /var/data/survey/$(date -d "last month" +\%Y-\%m) 2>/dev/null || true
```

---

## 15 · Maintenance

```bash
# Update server
scp src/server/server.py src/server/aggregator.py pi@muehrke.de:/tmp/
sudo cp /tmp/server.py /tmp/aggregator.py /opt/survey-server/
sudo chmod 440 /opt/survey-server/server.py
sudo chown root:umfrage /opt/survey-server/server.py /opt/survey-server/aggregator.py
sudo systemctl restart umfrage-server

# Update dashboard HTML
sudo cp src/admin/index.html /opt/survey-server/admin/
sudo cp src/results/index.html /opt/survey-server/results/

# Rebuild frontend
npm run build && sudo cp -r dist/* /var/www/survey/
sudo chown -R www-data:www-data /var/www/survey

# Log rotation
journalctl --vacuum-time=30d

# Verify append-only flags
lsattr -d /var/data/survey && lsattr -d /var/data/survey/*/

# TLS renewal (certbot handles automatically)
sudo certbot renew --dry-run
```

---

## Security Overview

| Layer | Measure |
|-------|---------|
| Network | HTTPS only |
| Proxy | Apache sets `X-Forwarded-For: %{REMOTE_ADDR}` — no spoofing |
| Application | Rate limiting, schema hash, value validation, JSON depth limit |
| Admin | IP restriction (localhost + Tailscale) + secret token (HMAC compare) |
| Filesystem | `chattr +a` (append-only), `chmod 700`, file mode `0o600` |
| Newsletter | RSA-4096 + AES-256-GCM, public-key-only in server process |
| Process | Dedicated user `umfrage` without login shell |
| Systemd | `NoNewPrivileges`, `MemoryDenyWriteExecute`, `SystemCallFilter`, `PrivateDevices`, `CapabilityBoundingSet=`, `UMask=0077` |
| Duplicates | `open("x")` atomic + `rglob` check |
| Data | No IP addresses, no tracking — responses + timestamp only |

---

## Privacy

**This survey is anonymous — not anonymized.**

No IP addresses, names, or accounts are collected. The survey is anonymous from the
start. All published texts must state:

> "Diese Umfrage ist anonym. Es werden keine personenbezogenen Daten erhoben."

Newsletter e-mail addresses are personal data and are stored **strictly separate**
from survey responses — no survey ID is linked to an e-mail address.

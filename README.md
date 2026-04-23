# Deutsche Gesellschaftsstudie

An open-source, anonymous survey on demographics, political attitudes, and living
conditions in Germany — 157 questions across 17 thematic sections.

**Live:** [survey.muehrke.de](https://survey.muehrke.de)

---

## What this is

A self-hosted survey platform built for scientific data collection. All responses
are anonymous from the ground up — no IP addresses, no accounts, no tracking.
Collected data will be published on [Zenodo](https://zenodo.org) under CC BY 4.0
once a sufficient number of responses has been gathered.

The survey covers:
- Sociodemographics (age, education, income, housing)
- Family & household structure
- Political orientation, voting behaviour, party competence
- Trust in institutions and democracy satisfaction
- Energy, mobility, and geopolitics
- Religion, migration background, legal experiences
- Life satisfaction and social connectedness

---

## Features

- **157 questions · 17 sections** — including skip logic (20+ rules), Likert scales,
  sliders, multi-select, and free-text fields
- **Multilingual** — German complete; English, Turkish, Ukrainian, Polish in progress
- **Schema-hash validation** — client and server agree on the question set before
  any data is written to disk
- **Hardened backend** — rate limiting, depth-limited JSON parsing, body field
  whitelist, append-only filesystem, systemd sandboxing, no root privileges
- **Bot protection** — [Friendly Captcha v2](https://friendlycaptcha.com) proof-of-work
  on all public write endpoints; GDPR-compliant, no cookies, no tracking
- **Encrypted newsletter** — subscriber e-mails stored with RSA-4096 + AES-256-GCM;
  the server process only holds the public key; consent timestamp is server-generated
- **Admin dashboard** — token-protected, accessible via localhost or Tailscale
  (`100.64.0.0/10`) only; live aggregates, question browser, export
- **Public results page** — k-anonymized aggregates at `/results`; regional breakdowns
  only for Bundesländer with ≥ 50 submissions
- **Scientific export** — k-anonymous JSON dataset (free-text and postal codes
  excluded, timestamps rounded to month)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite (also runs as a claude.ai Artifact) |
| Backend | FastAPI · uvicorn · Python 3.11+ |
| Reverse proxy | Apache 2.4 (mod_proxy, mod_ssl, mod_rewrite, mod_headers) |
| Crypto | `cryptography` — RSA-4096-OAEP + AES-256-GCM |
| Bot protection | Friendly Captcha v2 (proof-of-work, stdlib `urllib`, no extra dep) |
| Process | systemd with full sandboxing |
| TLS | Let's Encrypt via certbot |

---

## Repository layout

```
src/
  survey/
    umfrage.jsx              React frontend (questions, skip logic, i18n, storage adapter)
    umfrage_struktur.json    Machine-readable question schema
  server/
    server.py                FastAPI backend
    aggregator.py            Data aggregation + k-anonymity export
    newsletter_keygen.py     One-time RSA keypair generation
    newsletter_decrypt.py    Decrypt newsletter subscribers (newsletter user only)
    requirements.txt
  admin/
    index.html               Admin dashboard (self-contained, Chart.js)
  results/
    index.html               Public results page (self-contained, Chart.js)
deploy/
  umfrage-server.service     Systemd unit with hardening
  survey.muehrke.de.conf     Apache HTTP → HTTPS redirect
  survey.muehrke.de-le-ssl.conf  Apache HTTPS + reverse proxy
```

---

## Privacy & data

- **Fully anonymous** — no IP addresses, names, or session identifiers are stored
- **Newsletter addresses** are encrypted on write and stored separately from survey
  responses; no link between a submission and an e-mail address exists; consent
  timestamps are server-generated (verifiable GDPR audit trail)
- **Publication** will exclude free-text fields (Q052, Q064) and postal codes (Q121);
  regional breakdowns are suppressed below the 50-submission threshold
- All published texts use the wording:
  > "Diese Umfrage ist anonym. Es werden keine personenbezogenen Daten erhoben."

---

## Self-hosting

> Full step-by-step instructions are in the sections below.

**Quick overview:**

1. Create system users (`umfrage`, `newsletter`) and data directories
2. Deploy the Python venv and copy `server.py` + `aggregator.py`
3. Generate the newsletter RSA keypair (once, as the `newsletter` user)
4. Register a free Friendly Captcha account and obtain a sitekey + API key
5. Generate an admin token and configure all env vars in the systemd unit
6. Enable the systemd service
7. Configure Apache with the provided vhost configs and obtain a TLS certificate
8. Build the React frontend with Vite and deploy to `/var/www/survey/`
9. Copy `src/admin/index.html` and `src/results/index.html` to
   `/opt/survey-server/admin/` and `/opt/survey-server/results/`

<details>
<summary>1 · Users and directories</summary>

```bash
sudo useradd -r -s /sbin/nologin -d /opt/survey-server umfrage
sudo useradd -r -m -s /bin/bash newsletter

sudo mkdir -p /opt/survey-server /var/data/umfrage /var/data/newsletter /etc/survey

sudo chown umfrage:umfrage /var/data/umfrage && sudo chmod 700 /var/data/umfrage
sudo chattr +a /var/data/umfrage        # append-only

sudo chown newsletter:newsletter /var/data/newsletter && sudo chmod 730 /var/data/newsletter
sudo usermod -aG newsletter umfrage

sudo chown -R root:umfrage /opt/survey-server && sudo chmod 750 /opt/survey-server
```
</details>

<details>
<summary>2 · Python environment</summary>

```bash
sudo python3 -m venv /opt/survey-server/venv
sudo /opt/survey-server/venv/bin/pip install fastapi "uvicorn[standard]" cryptography

sudo cp src/server/server.py src/server/aggregator.py /opt/survey-server/
sudo chmod 440 /opt/survey-server/server.py
sudo chown root:umfrage /opt/survey-server/server.py /opt/survey-server/aggregator.py
```
</details>

<details>
<summary>3 · Newsletter keypair (once)</summary>

```bash
sudo cp src/server/newsletter_keygen.py /home/newsletter/
sudo -u newsletter python3 /home/newsletter/newsletter_keygen.py
# → /home/newsletter/private/newsletter_priv.pem  (chmod 600, newsletter user only)
# → /etc/survey/newsletter_pub.pem                (chmod 644, server reads on startup)
```
</details>

<details>
<summary>4 · Friendly Captcha</summary>

1. Register at [friendlycaptcha.com](https://friendlycaptcha.com) (free tier available)
2. Create an **application** to get a **sitekey** (public, goes in the frontend)
3. Create an **API key** (secret, goes in the systemd unit — never in frontend code)

**Frontend widget** — add to the survey form:

```html
<!-- Load the Friendly Captcha v2 SDK (no npm required) -->
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@friendlycaptcha/sdk/site.min.js"
  crossorigin="anonymous" defer></script>

<!-- Place the widget inside your form, before the submit button -->
<div class="frc-captcha" data-sitekey="YOUR_SITEKEY"></div>
```

The widget completes a proof-of-work challenge and writes the solution token to a
hidden `<input name="frc-captcha-response">`. Include it in the JSON body sent to
`POST /api/survey` and `POST /api/newsletter`:

```js
body: JSON.stringify({
    id: surveyId,
    schema_hash: SCHEMA_HASH,
    responses: answers,
    "frc-captcha-response": document.querySelector(".frc-captcha input")?.value ?? "",
})
```

**Server-side env vars** — add to the systemd unit:

```ini
Environment=FRIENDLYCAPTCHA_API_KEY=<your-api-key>
Environment=FRIENDLYCAPTCHA_SITEKEY=<your-sitekey>
# Optional: use EU endpoint to keep all data EU-only
# Environment=FRIENDLYCAPTCHA_ENDPOINT=https://eu.frcapi.com/api/v2/captcha/siteverify
```

> **Dev mode:** leave `FRIENDLYCAPTCHA_API_KEY` unset (empty string) to skip captcha
> verification entirely. The server logs a warning on startup. Never deploy to
> production without setting this.
</details>

<details>
<summary>5 · Admin token</summary>

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Add to `/etc/systemd/system/umfrage-server.service`:

```ini
Environment=ADMIN_TOKEN=<token>
```

The admin dashboard at `/admin` accepts this token and is reachable only from
`127.0.0.1` and Tailscale (`100.64.0.0/10`) — enforced at both Apache and
application level.
</details>

<details>
<summary>6 · Systemd service</summary>

```bash
sudo cp deploy/umfrage-server.service /etc/systemd/system/
# Edit to set ADMIN_TOKEN, FRIENDLYCAPTCHA_API_KEY, FRIENDLYCAPTCHA_SITEKEY,
# and optionally SURVEY_DATA_DIR, SURVEY_ALLOWED_ORIGINS, NEWSLETTER_PUB_KEY
sudo nano /etc/systemd/system/umfrage-server.service

sudo systemctl daemon-reload
sudo systemctl enable --now umfrage-server
```

Key environment variables:

| Variable | Default | Description |
|---|---|---|
| `ADMIN_TOKEN` | *(required)* | Admin dashboard token; generate with `secrets.token_hex(32)` |
| `FRIENDLYCAPTCHA_API_KEY` | *(required in prod)* | Secret API key from FriendlyCaptcha dashboard |
| `FRIENDLYCAPTCHA_SITEKEY` | *(required in prod)* | Public sitekey — also used in frontend |
| `FRIENDLYCAPTCHA_ENDPOINT` | `https://global.frcapi.com/...` | Override with EU endpoint if desired |
| `SURVEY_DATA_DIR` | `/var/data/umfrage` | Directory where survey JSON files are stored |
| `NEWSLETTER_DATA_FILE` | `/var/data/newsletter/subscribers.ndjson` | Encrypted subscriber list |
| `NEWSLETTER_PUB_KEY` | `/etc/survey/newsletter_pub.pem` | RSA public key for newsletter encryption |
| `SURVEY_ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `SURVEY_RATE_LIMIT_REQ` | `5` | Max requests per IP per window |
| `SURVEY_RATE_LIMIT_WIN` | `60` | Rate limit window in seconds |
| `SURVEY_MAX_BODY` | `524288` | Max request body in bytes (512 KB) |
| `SURVEY_MAX_FILES` | `50000` | Max total survey files before 503 |
| `SURVEY_MIN_FREE_MB` | `200` | Min free disk space before 503 |
</details>

<details>
<summary>7 · Apache</summary>

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo cp deploy/survey.muehrke.de.conf deploy/survey.muehrke.de-le-ssl.conf \
    /etc/apache2/sites-available/
sudo a2ensite survey.muehrke.de
sudo apache2ctl configtest && sudo systemctl reload apache2
sudo certbot --apache -d survey.muehrke.de
sudo a2ensite survey.muehrke.de-le-ssl
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Note: `mod_headers` is required for the `HSTS` and `X-Forwarded-For` directives
in the SSL vhost. It is included in the `a2enmod` command above.
</details>

<details>
<summary>8 · Frontend build</summary>

```bash
cd src/survey
npm create vite@latest survey-frontend -- --template react
cp umfrage.jsx survey-frontend/src/App.jsx
cd survey-frontend && npm install && npm run build
sudo mkdir -p /var/www/survey
sudo cp -r dist/* /var/www/survey/ && sudo chown -R www-data:www-data /var/www/survey
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
</details>

<details>
<summary>9 · Dashboard pages</summary>

```bash
sudo mkdir -p /opt/survey-server/admin /opt/survey-server/results
sudo cp src/admin/index.html /opt/survey-server/admin/
sudo cp src/results/index.html /opt/survey-server/results/
sudo chown -R root:umfrage /opt/survey-server/admin /opt/survey-server/results
sudo chmod 640 /opt/survey-server/admin/index.html /opt/survey-server/results/index.html
```
</details>

<details>
<summary>10 · Testing</summary>

```bash
# Health check (localhost only)
curl http://localhost:8742/health

# Survey submission — captcha is skipped when FRIENDLYCAPTCHA_API_KEY is unset
HASH="$(python3 -c "
import hashlib, json
ids = sorted([f'Q{i:03d}' for i in range(1,158)])
print(hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest())
")"
curl -X POST http://localhost:8742/api/survey \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"test001\",\"schema_hash\":\"$HASH\",\"responses\":{}}"
# → {"status":"ok"}

# Admin endpoints (token required)
curl http://localhost:8742/admin/api/stats -H "X-Admin-Token: <token>"
curl http://localhost:8742/results/api/stats

# Clean up test submission
sudo chattr -a /var/data/umfrage
sudo find /var/data/umfrage -name "*test001*" -delete
sudo chattr +a /var/data/umfrage
```

> In production, `POST /api/survey` and `POST /api/newsletter` require a valid
> Friendly Captcha solution token. Use `FRIENDLYCAPTCHA_API_KEY=` (unset) during
> development to bypass captcha.
</details>

<details>
<summary>11 · Newsletter management</summary>

```bash
sudo cp src/server/newsletter_decrypt.py /home/newsletter/
sudo chown newsletter:newsletter /home/newsletter/newsletter_decrypt.py
sudo chmod 700 /home/newsletter/newsletter_decrypt.py

sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py           # list all
sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py --csv     # CSV export
sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py --count   # count only
sudo -u newsletter python3 /home/newsletter/newsletter_decrypt.py --since 2025-05
```
</details>

<details>
<summary>12 · Adding questions</summary>

1. Add question to `SECTIONS` in `umfrage.jsx`
2. Recalculate schema hash:
   ```bash
   python3 -c "
   import hashlib, json
   ids = sorted([f'Q{i:03d}' for i in range(1, 159)])  # adjust range
   print(hashlib.sha256(json.dumps(ids, separators=(',',':')).encode()).hexdigest())
   "
   ```
3. Update `SCHEMA_HASH` in `umfrage.jsx`
4. Add to `VALID_QUESTION_IDS` and `QUESTION_TYPES` in `server.py`

| Survey type | Server type |
|---|---|
| `radio`, `text`, `plz` | `str` |
| `check` | `list` |
| `likert5` | `int1-5` |
| `slider7` | `int1-7` |
| `scale10` | `int0-10` |
| `number` | `int` |

> **Note:** each question ID may appear in exactly one type group. Duplicate entries
> across the `**{...}` dict comprehensions silently overwrite each other — the last
> group wins.
</details>

---

## Security

| Layer | Measure |
|-------|---------|
| Network | HTTPS only · HSTS `max-age=63072000; includeSubDomains` |
| Proxy | Apache forces `X-Forwarded-For: %{REMOTE_ADDR}` — no header spoofing; `TraceEnable off` |
| Bot protection | Friendly Captcha v2 proof-of-work on `POST /api/survey` and `POST /api/newsletter` |
| Application | Rate limiting (all public endpoints) · schema-hash validation · value validation · JSON depth limit · body field whitelist · `Content-Length` header sanitisation |
| Admin | IP restriction (localhost + Tailscale `100.64.0.0/10`) + HMAC-safe token comparison · failed auth attempts logged |
| Filesystem | `chattr +a` (append-only) · `chmod 700` · `O_CREAT\|O_EXCL` atomic file creation |
| Newsletter | RSA-4096-OAEP + AES-256-GCM · public key only in server process · `fcntl.flock` for multi-process write safety · consent timestamp is server-generated |
| Response headers | `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` |
| Systemd | `NoNewPrivileges` · `MemoryDenyWriteExecute` · `SystemCallFilter` · `CapabilityBoundingSet=` · `ProtectSystem=strict` · `ReadWritePaths` scoped to data directories |

---

## License

[MIT](LICENSE) — data will be published under CC BY 4.0 on Zenodo.

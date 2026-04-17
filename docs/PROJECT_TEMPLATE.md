# Adding a New Lab App

How to add a new ML app to a labs platform. Follow end-to-end.

## 1. Decide slug and port

- Slug: lowercase, hyphen-separated, matches URL (`<domain>/<slug>`)
- Port: first free local port (8501 = gym-churn; use 8502, 8503, ...)

Examples: `gym-churn` → 8501, `franchise-demand` → 8502, `email-nlp` → 8503

## 2. Create the app folder

```bash
cd labs/apps
mkdir <slug>
cd <slug>
```

Required structure:

```
apps/<slug>/
├── Dockerfile              ← local dev only
├── docker-compose.yml      ← local dev only
├── requirements.txt        ← must include streamlit
├── README.md               ← what this app does, how to use
├── src/
│   └── app.py              ← Streamlit entry point
├── data/                   ← gitignored (generated/cached)
└── notebooks/              ← optional EDA
```

### Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8501 8888
CMD ["streamlit", "run", "src/app.py", "--server.port=8501", "--server.address=0.0.0.0"]
```

### docker-compose.yml

```yaml
services:
  lab:
    build: .
    container_name: <slug>
    ports:
      - "8501:8501"
      - "8888:8888"
    volumes:
      - .:/app
    working_dir: /app
```

## 3. Make the Streamlit app path-aware

Production runs with `--server.baseUrlPath=/<slug>`. Keep all URLs relative. No hardcoded absolute paths like `/static/x.png` — use Streamlit's native helpers (`st.image`, `st.page_link`).

## 4. Test locally

```bash
docker compose up --build
# Open http://localhost:8501
```

Verify sliders, uploads, buttons all work.

## 5. Create systemd service

Copy `scripts/systemd-app.service.example` → `scripts/labs-<slug>.service`. Replace:
- `__SLUG__` → your app slug
- `__PORT__` → your app's local port
- `__WEBROOT__` → your server's labs root path, e.g. `/usr/local/www/labs`

## 6. Add Apache route

Edit your production `apache-vhost.conf` (generated once from `scripts/apache-vhost.conf.example`). Inside `<VirtualHost *:443>`, add:

```apache
<Location /<slug>>
    ProxyPass         http://127.0.0.1:<PORT>/<slug>
    ProxyPassReverse  http://127.0.0.1:<PORT>/<slug>
</Location>

RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule ^/<slug>/(.*) ws://127.0.0.1:<PORT>/<slug>/$1 [P,L]
```

## 7. Deploy to production

Laptop:
```bash
cd labs
git add apps/<slug> scripts/labs-<slug>.service scripts/apache-vhost.conf
git commit -m "Add <slug> lab app"
git push
```

Server:
```bash
cd <LABS_ROOT>
git pull
sudo cp scripts/labs-<slug>.service /etc/systemd/system/
sudo cp scripts/apache-vhost.conf /etc/apache2/sites-available/labs.conf
sudo systemctl daemon-reload
sudo systemctl enable --now labs-<slug>.service
sudo apachectl configtest && sudo systemctl reload apache2
LABS_ROOT=<LABS_ROOT> ./scripts/deploy.sh <slug>
```

## 8. Verify

- `https://<domain>/<slug>` loads
- Sliders/uploads work (proves WebSocket tunneling is live)
- `journalctl -u labs-<slug>.service -f` shows no errors

---

## Conventions

- **One app = one local port** (8501, 8502, ...)
- **One systemd service per app** — isolated failure domain
- **One venv per app** — no shared Python deps across apps
- **Uploaded data processed in-memory** — never written to disk unless explicit
- **Each app has its own README** — what it does, what data it expects, what it returns

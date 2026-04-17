# labs

Hands-on ML experiments — each one an end-to-end rebuild of a production ML system. Synthetic data, feature engineering, trained models, SHAP explanations, interactive demos. Self-hosted.

Running at [labs.kargin-utkin.com](https://labs.kargin-utkin.com). Portfolio descriptions at [kargin-utkin.com/labs](https://kargin-utkin.com/labs).

## Apps

| Slug | Domain | Status | Demo |
|---|---|---|---|
| [`gym-churn`](apps/gym-churn/) | Fitness member churn prediction | shipped | [labs.kargin-utkin.com/gym-churn](https://labs.kargin-utkin.com/gym-churn) |
| [`spend-lens`](apps/spend-lens/) | Private personal finance analyzer (client-side) | in-progress | [labs.kargin-utkin.com/spend-lens](https://labs.kargin-utkin.com/spend-lens) |
| `franchise-demand` | 1-hour-ahead demand forecasting | planned | — |

## Structure

```
labs/
├── apps/                    ← each app is a self-contained Streamlit project
│   └── gym-churn/
├── scripts/                 ← deploy templates (genericized — replace placeholders)
│   ├── apache-vhost.conf.example           ← Apache reverse proxy + SSL
│   ├── apache-vhost.bootstrap.conf.example ← HTTP-only, for Let's Encrypt provisioning
│   ├── systemd-app.service.example         ← one systemd unit per app
│   └── deploy.sh                           ← parameterised via LABS_ROOT
├── docs/
│   └── PROJECT_TEMPLATE.md  ← how to add a new app
└── public/
    └── index.html           ← root landing page
```

## Tech stack

- **Apps:** Python + Streamlit, containerised locally via Docker
- **Local dev:** `docker compose up` inside each app folder
- **Production:** native Python `venv/` + systemd, behind Apache reverse proxy with WebSocket support for Streamlit live updates

## Run locally

```bash
git clone https://github.com/alexnews/labs.git
cd labs/apps/gym-churn
docker compose up --build
# open http://localhost:8501
```

## Routing model

One app = one local port. Apache reverse-proxies a URL path to the port:

```
<domain>/gym-churn/*  →  127.0.0.1:8501
<domain>/<next>/*     →  127.0.0.1:8502
```

Each app has its own systemd service, its own venv, its own failure domain.

## Adding a new app

See [`docs/PROJECT_TEMPLATE.md`](docs/PROJECT_TEMPLATE.md) for the full walkthrough.

## Deploy (production)

Laptop → `git push` → server `git pull` → `LABS_ROOT=/path/to/labs ./scripts/deploy.sh <slug>` → systemd restart.

See [`scripts/`](scripts/) for the Apache + systemd templates. Replace `__DOMAIN__`, `__WEBROOT__`, `__SLUG__`, `__PORT__` placeholders before deploying.

## License

MIT — see [LICENSE](LICENSE).

## Author

[Alex Kargin](https://kargin-utkin.com) — CTO of [InnovaTek](https://innovateksolutionsinc.com), building private/on-premise AI systems.

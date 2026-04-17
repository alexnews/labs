# Gym Member Churn Predictor

**End-to-end machine learning system that predicts which fitness studio members are likely to cancel their membership — and explains why.** Built with XGBoost for classification, SHAP for interpretable per-member explanations, and Streamlit for an interactive demo. Self-hosted at [labs.kargin-utkin.com/gym-churn](https://labs.kargin-utkin.com/gym-churn).

> Keywords: churn prediction, customer retention, XGBoost classifier, SHAP feature importance, interpretable machine learning, gym member churn, fitness studio retention analytics, gradient boosting classifier, churn probability model, Streamlit ML demo, self-hosted machine learning, on-premise AI, Python scikit-learn XGBoost.

---

## What this is

A hands-on rebuild of the kind of member-churn prediction system that fitness chains (Orange Theory Fitness, Equinox, Planet Fitness, boutique studios) use to identify at-risk members before they cancel. The model takes a member's behavior — visit frequency, tenure, payment history, class variety, distance from studio — and outputs:

1. **Churn probability** — how likely this member is to cancel in the next 30 days
2. **Risk factors** — which behaviors are pushing the risk up or down, per member (via SHAP values)
3. **Population insights** — which features drive churn across the entire member base

This is the kind of output a studio manager or retention team actually uses: not just a score, but a *reason* they can act on.

## Why it exists

Portfolio project demonstrating a production-realistic ML pipeline: data generation → feature engineering → model training → interpretability → deployed interactive demo. Built on personal experience observing how these systems are architected at major fitness and restaurant chains.

The modeling code is identical to what would be used on real member data — only the data is synthetic (generated with realistic correlations, not public member information).

## Live demo

[labs.kargin-utkin.com/gym-churn](https://labs.kargin-utkin.com/gym-churn)

The demo has four tabs:

### 1. Overview
High-level model performance — churn probability distribution, a sortable table of the 20 highest-risk members, top-line metrics (AUC, churn rate, risk thresholds).

### 2. Feature Importance
Global SHAP plots showing which features most influence the model's predictions across all members:
- **Beeswarm plot** — how each feature's value pushes the prediction up or down
- **Bar plot** — mean absolute SHAP value per feature (importance ranking)
- **Dependence plots** — how specific feature values affect the prediction

### 3. Member Lookup
Enter any member ID (1–5000) and see:
- Their current churn probability
- Their actual outcome (churned vs retained)
- A **SHAP waterfall chart** explaining exactly *why* the model predicted this specific risk score — which features pushed it up, which pulled it down, and by how much

### 4. What-If Simulator
Adjust any member's attributes with sliders (visits in last 30 days, tenure, late payments, distance, morning visit %, class variety) and watch the predicted churn risk update in real time. Useful for answering questions like: *"If this member had one more late payment, how much more likely are they to cancel?"*

## How it works — the ML pipeline

| Stage | What happens | Tech |
|---|---|---|
| **1. Data** | 5,000 synthetic fitness members with realistic behavioral correlations (declining visits → higher churn, longer tenure → lower churn, etc.) | NumPy, pandas |
| **2. Feature engineering** | 24 features: demographics, visit patterns, trend features, interaction features (new member + declining visits = danger zone), ratio features (visits per mile, late payment rate) | pandas |
| **3. Train/test split** | Stratified 80/20 split preserving 18% churn rate in both sets | scikit-learn |
| **4. Models** | Logistic Regression baseline (AUC 0.815) and XGBoost (AUC 0.790) for comparison | scikit-learn, XGBoost |
| **5. Interpretability** | SHAP TreeExplainer on XGBoost — global feature importance + per-prediction explanations | SHAP |
| **6. Demo** | 4-tab interactive web app, live on own infrastructure | Streamlit, Apache reverse proxy, systemd |

Top churn drivers (by mean |SHAP|): **visits_last_30d**, tenure_months, unique_class_types, visit_trend, late_payment_rate.

## Run it locally

```bash
git clone https://github.com/alexnews/labs.git
cd labs/apps/gym-churn
docker compose up --build
```

Then open [http://localhost:8501](http://localhost:8501).

First run generates the synthetic data and trains the model (takes ~30 seconds).

## Project structure

```
gym-churn/
├── Dockerfile              # Local dev environment (Python 3.11 + Streamlit)
├── docker-compose.yml      # One-command local setup
├── requirements.txt        # Pinned deps: pandas, scikit-learn, XGBoost, SHAP, Streamlit
├── src/
│   ├── generate_data.py    # Synthetic member dataset with realistic churn correlations
│   ├── features.py         # Feature engineering + train/test split
│   ├── train.py            # Trains LogReg + XGBoost, saves the best model
│   ├── explain.py          # Generates SHAP plots (beeswarm, bar, dependence, waterfall)
│   └── app.py              # Streamlit demo: 4 tabs, interactive what-if simulator
├── notebooks/
│   └── 01_eda.ipynb        # Exploratory data analysis: distributions, churn by segment, correlations
└── data/                   # Generated artifacts (gitignored): members.csv, xgb_model.pkl, shap_*.png
```

## Tech stack

- **Python 3.11**, pandas, NumPy
- **scikit-learn** — Logistic Regression baseline, train/test split, metrics
- **XGBoost** — gradient-boosted trees classifier, final production model
- **SHAP** — game-theoretic feature attribution for interpretable predictions
- **Streamlit** — interactive web app for the demo
- **Docker** — local dev environment
- **Apache + systemd** — production deploy at labs.kargin-utkin.com
- **Matplotlib** — SHAP visualizations (beeswarm, waterfall, dependence plots)

## Dataset

Synthetic — 5,000 members generated by `src/generate_data.py`. Churn labels come from a logistic probability function with realistic correlations and noise, not random sampling. This means:

- The model has real signal to learn (it's not trivially solvable)
- SHAP feature importance reflects genuine causal structure in the data
- Feature weights match known fitness-industry patterns (visit frequency, tenure, payment behavior, referral source, distance to studio)

All feature definitions, correlation structure, and the generator code are in `src/generate_data.py` for full transparency.

## Performance

| Metric | Logistic Regression | XGBoost |
|---|---|---|
| AUC-ROC | 0.815 | 0.790 |
| Precision (churners) | 0.41 | 0.48 |
| Recall (churners) | 0.71 | 0.53 |
| Accuracy | 0.76 | 0.81 |

Logistic Regression wins on AUC/recall (good for catching at-risk members early). XGBoost wins on precision/accuracy (fewer false alarms). Which to pick depends on the business cost of missing a churner vs bothering a loyal one — in a retention-outreach context, recall usually matters more.

## Roadmap

- [ ] **CSV upload** — let users upload their own member data and get predictions
- [ ] **API endpoint** — REST interface for integration with other systems
- [ ] **Real public dataset validation** — run the same pipeline on Kaggle's fitness churn dataset
- [ ] **Hyperparameter tuning** — currently using defaults; add Optuna or grid search
- [ ] **Time-series features** — weekly cohort tracking, seasonality, multi-month trends

## License

MIT. Use, modify, run on your own infrastructure — no restrictions.

## About the author

Alex Kargin — CTO of [InnovaTek](https://innovateksolutionsinc.com), specializing in private/on-premise AI infrastructure. More experiments at [labs.kargin-utkin.com](https://labs.kargin-utkin.com) and writing at [kargin-utkin.com](https://kargin-utkin.com).

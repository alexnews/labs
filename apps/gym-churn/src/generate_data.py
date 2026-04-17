"""
Synthetic data generator for OTF-style member churn prediction.

Generates ~5000 fitness studio members with realistic behavioral patterns
and a churn target. The data has built-in correlations that mirror real
fitness membership dynamics:

  - Declining visit frequency → higher churn probability
  - High recency (days since last visit) → higher churn
  - Short tenure → higher churn (new members drop faster)
  - Late payments → higher churn
  - Morning visitors and class-variety seekers → lower churn
  - Friend referrals → lower churn (social accountability)

The churn label is generated via a logistic probability function of
these features — NOT independent random sampling. This means a trained
model CAN learn real signal, and SHAP values WILL show meaningful
feature attributions.
"""

import numpy as np
import pandas as pd
from pathlib import Path


def generate_members(n: int = 5000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    # --- Demographics & enrollment ---
    age = rng.integers(18, 66, size=n)
    gender = rng.choice(["M", "F"], size=n, p=[0.45, 0.55])

    membership_type = rng.choice(
        ["basic", "premium", "unlimited"],
        size=n,
        p=[0.35, 0.40, 0.25],
    )
    monthly_fee = np.where(
        membership_type == "basic",
        rng.normal(59, 5, n),
        np.where(membership_type == "premium", rng.normal(99, 8, n), rng.normal(159, 12, n)),
    ).round(2)

    tenure_months = rng.exponential(scale=14, size=n).clip(1, 72).round(1)

    has_referral = rng.binomial(1, 0.30, size=n)

    distance_miles = rng.exponential(scale=4, size=n).clip(0.5, 25).round(1)

    home_studio_id = rng.integers(1, 11, size=n)

    # --- Visit behavior ---
    # Base visit rate depends on membership tier & tenure
    base_rate = np.where(
        membership_type == "basic", 2.0,
        np.where(membership_type == "premium", 3.2, 4.5),
    )
    # Newer members are more variable
    tenure_factor = np.clip(tenure_months / 12, 0.3, 1.5)
    weekly_rate = (base_rate * tenure_factor * rng.uniform(0.5, 1.5, n)).clip(0.1, 7)

    # Visits in 3 windows (last 30d, 31-60d, 61-90d)
    # ~4.3 weeks per 30-day window
    visits_last_90d = rng.poisson(weekly_rate * 4.3, n).clip(0, 30)
    visits_last_60d = rng.poisson(weekly_rate * 4.3, n).clip(0, 30)

    # Some members have declining trend (pre-churn signal)
    decline_mask = rng.random(n) < 0.25
    decline_factor = np.where(decline_mask, rng.uniform(0.2, 0.7, n), rng.uniform(0.8, 1.3, n))
    visits_last_30d = (visits_last_60d * decline_factor).round().clip(0, 30).astype(int)

    avg_visits_per_week = ((visits_last_30d + visits_last_60d + visits_last_90d) / (4.3 * 3)).round(2)

    # Recency: days since last visit (correlated with recent visit volume)
    days_since_last_visit = np.where(
        visits_last_30d > 0,
        rng.exponential(scale=30 / (visits_last_30d + 1), size=n).clip(1, 30),
        30 + rng.exponential(scale=15, size=n).clip(1, 60),
    ).round(0).astype(int)

    # Visit trend: (recent - older) / older — negative means declining
    visit_trend = np.where(
        visits_last_90d > 0,
        (visits_last_30d - visits_last_90d) / (visits_last_90d + 1),
        0,
    ).round(3)

    # Morning visits (% before 11am) — morning people are stickier
    pct_morning = rng.beta(2, 3, n).round(3)

    # Class variety (1-8 unique types attended)
    unique_class_types = rng.integers(1, 9, size=n)
    # Low-visit members naturally have less variety
    unique_class_types = np.minimum(
        unique_class_types,
        (visits_last_30d + visits_last_60d + visits_last_90d).clip(1, 8),
    )

    # Late payments in last 6 months
    late_payments = rng.poisson(0.3, n).clip(0, 5)

    # --- Churn target via logistic model ---
    # These weights encode domain knowledge about what drives churn
    logit = (
        -0.2                                            # base (~20% churn rate)
        + 1.0 * (visits_last_30d < 3).astype(float)    # very low recent visits
        - 0.5 * np.log1p(visits_last_30d)               # more visits = less churn
        + 0.025 * days_since_last_visit                  # high recency = more churn
        - 0.6 * np.clip(visit_trend, -2, 2)             # declining trend = more churn
        - 0.04 * tenure_months                           # longer tenure = less churn
        + 0.5 * late_payments                            # payment issues = more churn
        - 0.5 * has_referral                             # social bond = less churn
        - 0.6 * pct_morning                              # morning people stick
        - 0.15 * unique_class_types                      # variety = engagement
        + 0.04 * distance_miles                          # farther = more churn
        + 0.35 * (membership_type == "basic").astype(float)  # basic = higher churn
        + rng.normal(0, 0.4, n)                          # noise — model won't be perfect
    )

    churn_prob = 1 / (1 + np.exp(-logit))
    churned = rng.binomial(1, churn_prob)

    df = pd.DataFrame({
        "member_id": np.arange(1, n + 1),
        "age": age,
        "gender": gender,
        "membership_type": membership_type,
        "monthly_fee": monthly_fee,
        "tenure_months": tenure_months,
        "home_studio_id": home_studio_id,
        "has_referral": has_referral,
        "distance_miles": distance_miles,
        "visits_last_30d": visits_last_30d,
        "visits_last_60d": visits_last_60d,
        "visits_last_90d": visits_last_90d,
        "avg_visits_per_week": avg_visits_per_week,
        "days_since_last_visit": days_since_last_visit,
        "visit_trend": visit_trend,
        "pct_morning_visits": pct_morning,
        "unique_class_types": unique_class_types,
        "late_payments": late_payments,
        "churned": churned,
    })

    return df


def print_summary(df: pd.DataFrame) -> None:
    n = len(df)
    churn_rate = df["churned"].mean()
    print(f"Generated {n} members")
    print(f"Churn rate: {churn_rate:.1%} ({df['churned'].sum()} churned / {n - df['churned'].sum()} retained)")
    print(f"\nMembership distribution:")
    print(df["membership_type"].value_counts().to_string())
    print(f"\nFeature ranges:")
    for col in ["age", "tenure_months", "visits_last_30d", "days_since_last_visit", "distance_miles", "late_payments"]:
        print(f"  {col}: {df[col].min()} – {df[col].max()} (median {df[col].median()})")

    print(f"\nChurn rate by membership type:")
    print(df.groupby("membership_type")["churned"].mean().round(3).to_string())

    print(f"\nChurn rate by referral:")
    print(df.groupby("has_referral")["churned"].mean().round(3).to_string())


if __name__ == "__main__":
    output_path = Path(__file__).parent.parent / "data" / "members.csv"
    output_path.parent.mkdir(exist_ok=True)

    df = generate_members()
    df.to_csv(output_path, index=False)
    print(f"Saved to {output_path}\n")
    print_summary(df)

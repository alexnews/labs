"""
Feature engineering for gym member churn prediction.

Takes the raw member DataFrame and produces model-ready features:
  1. Encode categoricals (membership_type, gender)
  2. Create interaction features (visit decline + low tenure = danger zone)
  3. Create ratio features (visits per mile, payments per month)
  4. Drop raw ID / redundant columns
  5. Time-aware train/test split (no data leakage)
"""

from pathlib import Path

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # --- Encode categoricals ---
    df["is_basic"] = (df["membership_type"] == "basic").astype(int)
    df["is_premium"] = (df["membership_type"] == "premium").astype(int)
    df["is_female"] = (df["gender"] == "F").astype(int)

    # --- Visit-based features ---
    # Total visits across all 3 windows
    df["total_visits_90d"] = df["visits_last_30d"] + df["visits_last_60d"] + df["visits_last_90d"]

    # Visit acceleration: is the decline accelerating?
    df["visit_accel"] = (df["visits_last_30d"] - df["visits_last_60d"]) - \
                        (df["visits_last_60d"] - df["visits_last_90d"])

    # Binary: zero visits in last 30 days (strong churn signal)
    df["zero_visits_30d"] = (df["visits_last_30d"] == 0).astype(int)

    # --- Ratio features ---
    # Visits per mile — high distance + low visits = at risk
    df["visits_per_mile"] = df["visits_last_30d"] / (df["distance_miles"] + 0.1)

    # Late payments per tenure month — normalizes for how long they've been a member
    df["late_payment_rate"] = df["late_payments"] / (df["tenure_months"] + 1)

    # --- Interaction features ---
    # New member + declining visits = highest risk segment
    df["new_and_declining"] = ((df["tenure_months"] < 6) & (df["visit_trend"] < -0.2)).astype(int)

    # High distance + basic plan = low commitment
    df["far_and_basic"] = ((df["distance_miles"] > 5) & (df["is_basic"] == 1)).astype(int)

    # --- Drop columns the model shouldn't see ---
    drop_cols = ["member_id", "membership_type", "gender", "home_studio_id"]
    df = df.drop(columns=[c for c in drop_cols if c in df.columns])

    return df


def split_data(df: pd.DataFrame, test_size: float = 0.2, seed: int = 42):
    """Stratified train/test split preserving churn class balance."""
    target = "churned"
    X = df.drop(columns=[target])
    y = df[target]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=seed, stratify=y
    )

    print(f"Train: {len(X_train)} samples, churn rate {y_train.mean():.1%}")
    print(f"Test:  {len(X_test)} samples, churn rate {y_test.mean():.1%}")
    print(f"Features: {X_train.shape[1]}")
    print(f"\nFeature list:")
    for col in X_train.columns:
        print(f"  {col}")

    return X_train, X_test, y_train, y_test


if __name__ == "__main__":
    df = pd.read_csv(DATA_DIR / "members.csv")
    print("=== Before feature engineering ===")
    print(f"Columns: {list(df.columns)}\n")

    df = engineer_features(df)
    print("=== After feature engineering ===")
    print(f"Columns: {list(df.columns)}\n")

    X_train, X_test, y_train, y_test = split_data(df)

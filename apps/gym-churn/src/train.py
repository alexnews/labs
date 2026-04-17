"""
Model training for gym member churn prediction.

Trains two models and compares them:
  1. Logistic Regression — simple baseline, fully interpretable
  2. XGBoost — gradient-boosted trees, stronger but less transparent

Evaluation focuses on:
  - AUC-ROC (how well it ranks churners above retained)
  - Precision/Recall (tradeoff between catching churners and false alarms)
  - Confusion matrix (what errors does it actually make?)
"""

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    roc_auc_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay,
    RocCurveDisplay,
    precision_recall_curve,
    PrecisionRecallDisplay,
)
from xgboost import XGBClassifier

from features import engineer_features, split_data, DATA_DIR


def train_baseline(X_train, y_train, X_test, y_test):
    """Logistic Regression — the baseline every project needs."""
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    model = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)
    model.fit(X_train_scaled, y_train)

    y_prob = model.predict_proba(X_test_scaled)[:, 1]
    y_pred = model.predict(X_test_scaled)
    auc = roc_auc_score(y_test, y_prob)

    print("=" * 50)
    print("LOGISTIC REGRESSION (baseline)")
    print("=" * 50)
    print(f"AUC-ROC: {auc:.3f}")
    print()
    print(classification_report(y_test, y_pred, target_names=["Retained", "Churned"]))

    # Feature importance from coefficients
    coef_df = pd.DataFrame({
        "feature": X_train.columns,
        "coefficient": model.coef_[0]
    }).sort_values("coefficient", key=abs, ascending=False)
    print("Top 10 features by |coefficient|:")
    for _, row in coef_df.head(10).iterrows():
        direction = "+" if row["coefficient"] > 0 else "-"
        print(f"  {direction} {row['feature']:25s} {row['coefficient']:+.3f}")

    return model, scaler, y_prob, y_pred


def train_xgboost(X_train, y_train, X_test, y_test):
    """XGBoost — gradient-boosted trees, the workhorse of tabular ML."""
    scale_pos_weight = (y_train == 0).sum() / (y_train == 1).sum()

    model = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        scale_pos_weight=scale_pos_weight,
        eval_metric="auc",
        random_state=42,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = model.predict(X_test)
    auc = roc_auc_score(y_test, y_prob)

    print("=" * 50)
    print("XGBOOST")
    print("=" * 50)
    print(f"AUC-ROC: {auc:.3f}")
    print()
    print(classification_report(y_test, y_pred, target_names=["Retained", "Churned"]))

    # Feature importance
    importance = pd.DataFrame({
        "feature": X_train.columns,
        "importance": model.feature_importances_
    }).sort_values("importance", ascending=False)
    print("Top 10 features by importance:")
    for _, row in importance.head(10).iterrows():
        print(f"  {row['feature']:25s} {row['importance']:.3f}")

    return model, y_prob, y_pred


def plot_comparison(y_test, lr_prob, xgb_prob, lr_pred, xgb_pred):
    """Side-by-side evaluation plots."""
    fig, axes = plt.subplots(2, 2, figsize=(14, 11))

    # ROC curves
    RocCurveDisplay.from_predictions(y_test, lr_prob, name="Logistic Regression", ax=axes[0, 0])
    RocCurveDisplay.from_predictions(y_test, xgb_prob, name="XGBoost", ax=axes[0, 0])
    axes[0, 0].set_title("ROC Curve")
    axes[0, 0].plot([0, 1], [0, 1], "k--", alpha=0.3)

    # Precision-Recall curves
    PrecisionRecallDisplay.from_predictions(y_test, lr_prob, name="Logistic Regression", ax=axes[0, 1])
    PrecisionRecallDisplay.from_predictions(y_test, xgb_prob, name="XGBoost", ax=axes[0, 1])
    axes[0, 1].set_title("Precision-Recall Curve")

    # Confusion matrices
    ConfusionMatrixDisplay.from_predictions(
        y_test, lr_pred, display_labels=["Retained", "Churned"], ax=axes[1, 0],
        cmap="Blues"
    )
    axes[1, 0].set_title("Logistic Regression — Confusion Matrix")

    ConfusionMatrixDisplay.from_predictions(
        y_test, xgb_pred, display_labels=["Retained", "Churned"], ax=axes[1, 1],
        cmap="Oranges"
    )
    axes[1, 1].set_title("XGBoost — Confusion Matrix")

    plt.tight_layout()
    plt.savefig(str(DATA_DIR / "model_comparison.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("\nSaved comparison plot to data/model_comparison.png")


if __name__ == "__main__":
    df = pd.read_csv(DATA_DIR / "members.csv")
    df = engineer_features(df)
    X_train, X_test, y_train, y_test = split_data(df)

    print()
    lr_model, scaler, lr_prob, lr_pred = train_baseline(X_train, y_train, X_test, y_test)

    print()
    xgb_model, xgb_prob, xgb_pred = train_xgboost(X_train, y_train, X_test, y_test)

    plot_comparison(y_test, lr_prob, xgb_prob, lr_pred, xgb_pred)

    # Save the best model
    model_path = DATA_DIR / "xgb_model.pkl"
    with open(model_path, "wb") as f:
        pickle.dump(xgb_model, f)
    print(f"\nSaved XGBoost model to {model_path}")

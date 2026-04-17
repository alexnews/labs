"""
SHAP explainability for the churn model.

SHAP (SHapley Additive exPlanations) answers:
  - Which features matter MOST across all predictions? (global importance)
  - WHY was THIS specific member predicted to churn? (local explanation)
  - How does each feature's VALUE affect the prediction? (dependence)

This is what turns a black-box model into something you can explain
to a business stakeholder: "Member #4521 is high-risk because their
visits dropped 60% and they've had 2 late payments."
"""

import pickle

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import shap

from features import engineer_features, split_data, DATA_DIR


def explain_model(model, X_test, y_test):
    explainer = shap.TreeExplainer(model)
    shap_values = explainer(X_test)

    # --- 1. Global feature importance (beeswarm) ---
    print("Generating SHAP beeswarm plot (global feature importance)...")
    fig, ax = plt.subplots(figsize=(12, 10))
    shap.plots.beeswarm(shap_values, max_display=20, show=False)
    plt.title("SHAP Feature Importance — Which Features Drive Churn Predictions?", fontsize=13)
    plt.tight_layout()
    plt.savefig(str(DATA_DIR / "shap_beeswarm.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  Saved: data/shap_beeswarm.png")

    # --- 2. Mean absolute SHAP values (bar chart) ---
    print("Generating SHAP bar plot...")
    fig, ax = plt.subplots(figsize=(10, 8))
    shap.plots.bar(shap_values, max_display=20, show=False)
    plt.title("Mean |SHAP Value| — Average Feature Impact on Prediction", fontsize=13)
    plt.tight_layout()
    plt.savefig(str(DATA_DIR / "shap_bar.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  Saved: data/shap_bar.png")

    # --- 3. Dependence plots for top features ---
    top_features = pd.DataFrame({
        "feature": X_test.columns,
        "importance": np.abs(shap_values.values).mean(0)
    }).sort_values("importance", ascending=False).head(4)["feature"].tolist()

    print(f"Generating dependence plots for top features: {top_features}")
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    for i, feat in enumerate(top_features):
        ax = axes[i // 2][i % 2]
        shap.plots.scatter(shap_values[:, feat], ax=ax, show=False)
        ax.set_title(f"SHAP Dependence: {feat}")
    plt.suptitle("How Feature Values Affect Churn Prediction", fontsize=14)
    plt.tight_layout()
    plt.savefig(str(DATA_DIR / "shap_dependence.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  Saved: data/shap_dependence.png")

    # --- 4. Individual explanations (waterfall) ---
    # Find a high-risk churner and a safe retained member
    y_prob = model.predict_proba(X_test)[:, 1]
    churned_mask = y_test.values == 1
    retained_mask = y_test.values == 0

    high_risk_idx = np.where(churned_mask)[0][np.argmax(y_prob[churned_mask])]
    safe_idx = np.where(retained_mask)[0][np.argmin(y_prob[retained_mask])]

    print(f"\nHigh-risk member (idx={high_risk_idx}, prob={y_prob[high_risk_idx]:.2%}):")
    fig, ax = plt.subplots(figsize=(12, 7))
    shap.plots.waterfall(shap_values[high_risk_idx], max_display=15, show=False)
    plt.title(f"Why This Member Churns (predicted prob: {y_prob[high_risk_idx]:.1%})", fontsize=13)
    plt.tight_layout()
    plt.savefig(str(DATA_DIR / "shap_waterfall_churner.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  Saved: data/shap_waterfall_churner.png")

    print(f"\nSafe member (idx={safe_idx}, prob={y_prob[safe_idx]:.2%}):")
    fig, ax = plt.subplots(figsize=(12, 7))
    shap.plots.waterfall(shap_values[safe_idx], max_display=15, show=False)
    plt.title(f"Why This Member Stays (predicted prob: {y_prob[safe_idx]:.1%})", fontsize=13)
    plt.tight_layout()
    plt.savefig(str(DATA_DIR / "shap_waterfall_retained.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  Saved: data/shap_waterfall_retained.png")

    # --- 5. Print summary ---
    print("\n" + "=" * 50)
    print("SHAP SUMMARY")
    print("=" * 50)
    importance_df = pd.DataFrame({
        "feature": X_test.columns,
        "mean_abs_shap": np.abs(shap_values.values).mean(0)
    }).sort_values("mean_abs_shap", ascending=False)

    print("\nFeature ranking by mean |SHAP|:")
    for i, (_, row) in enumerate(importance_df.iterrows(), 1):
        print(f"  {i:2d}. {row['feature']:25s} {row['mean_abs_shap']:.4f}")

    return shap_values


if __name__ == "__main__":
    df = pd.read_csv(DATA_DIR / "members.csv")
    df = engineer_features(df)
    X_train, X_test, y_train, y_test = split_data(df)

    model_path = DATA_DIR / "xgb_model.pkl"
    with open(model_path, "rb") as f:
        model = pickle.load(f)
    print(f"Loaded model from {model_path}\n")

    shap_values = explain_model(model, X_test, y_test)

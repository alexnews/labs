"""
Streamlit demo: Gym Member Churn Predictor

Interactive app where you can:
  1. See model performance overview
  2. Explore SHAP feature importance
  3. Pick any member and see WHY the model predicts churn/retain
  4. Adjust member attributes and see prediction change in real-time
"""

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st
import shap
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from features import engineer_features, DATA_DIR

st.set_page_config(page_title="Gym Churn Predictor", page_icon="🏋️", layout="wide")

DATA_PATH = DATA_DIR


@st.cache_resource
def load_model():
    with open(DATA_PATH / "xgb_model.pkl", "rb") as f:
        return pickle.load(f)


@st.cache_data
def load_data():
    raw = pd.read_csv(DATA_PATH / "members.csv")
    processed = engineer_features(raw)
    return raw, processed


model = load_model()
raw_df, processed_df = load_data()

X = processed_df.drop(columns=["churned"])
y = processed_df["churned"]
probs = model.predict_proba(X)[:, 1]
raw_df["churn_probability"] = probs

st.title("Gym Member Churn Predictor")
st.markdown("Predicts which gym members are about to cancel — and explains why.")

# Pre-compute risk segments
n_high = int((probs > 0.5).sum())
n_medium = int(((probs > 0.2) & (probs <= 0.5)).sum())
n_low = int((probs <= 0.2).sum())

raw_df["risk_level"] = pd.cut(
    probs,
    bins=[-0.01, 0.2, 0.5, 1.01],
    labels=["Low", "Medium", "High"],
)

tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "Who Will Churn?", "Feature Importance", "Member Lookup",
    "What-If Simulator", "Upload Your Data"
])

# --- Tab 1: Who Will Churn? ---
with tab1:
    st.subheader("Risk Summary")
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Members", f"{len(raw_df):,}")
    col2.metric("High Risk (>50%)", f"{n_high}", help="Likely to cancel within 30 days")
    col3.metric("Medium Risk (20-50%)", f"{n_medium}", help="Worth monitoring")
    col4.metric("Low Risk (<20%)", f"{n_low}", help="Likely to stay")

    # Risk distribution bar
    st.markdown("---")
    fig, ax = plt.subplots(figsize=(12, 1.5))
    total = len(raw_df)
    ax.barh([0], [n_low / total], color="#2ecc71", label=f"Low ({n_low})")
    ax.barh([0], [n_medium / total], left=[n_low / total], color="#f39c12", label=f"Medium ({n_medium})")
    ax.barh([0], [n_high / total], left=[(n_low + n_medium) / total], color="#e74c3c", label=f"High ({n_high})")
    ax.set_xlim(0, 1)
    ax.set_yticks([])
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.3), ncol=3, fontsize=10)
    ax.set_xlabel("Share of members")
    plt.tight_layout()
    st.pyplot(fig)
    plt.close()

    # Risk filter
    st.markdown("---")
    risk_filter = st.selectbox(
        "Show members by risk level",
        ["High Risk (>50%)", "Medium Risk (20-50%)", "Low Risk (<20%)", "All"],
        index=0,
    )

    if risk_filter == "High Risk (>50%)":
        filtered = raw_df[raw_df["risk_level"] == "High"]
    elif risk_filter == "Medium Risk (20-50%)":
        filtered = raw_df[raw_df["risk_level"] == "Medium"]
    elif risk_filter == "Low Risk (<20%)":
        filtered = raw_df[raw_df["risk_level"] == "Low"]
    else:
        filtered = raw_df

    filtered_sorted = filtered.sort_values("churn_probability", ascending=False)

    st.markdown(f"**Showing {len(filtered_sorted)} members** — sorted by churn risk (highest first)")
    st.markdown("Select a member ID from this table, then go to **Member Lookup** tab to see full profile and SHAP explanation, or **What-If Simulator** to test interventions.")

    display_cols = [
        "member_id", "churn_probability", "risk_level", "membership_type",
        "tenure_months", "visits_last_30d", "visit_trend",
        "days_since_last_visit", "late_payments",
    ]
    st.dataframe(
        filtered_sorted[display_cols].reset_index(drop=True),
        use_container_width=True,
        height=500,
    )

# --- Tab 2: Feature Importance ---
with tab2:
    st.subheader("SHAP Feature Importance")
    for img_name, title in [
        ("shap_beeswarm.png", "Beeswarm — How each feature pushes predictions"),
        ("shap_bar.png", "Bar — Average absolute impact"),
        ("shap_dependence.png", "Dependence — How feature values affect the prediction"),
    ]:
        img_path = DATA_PATH / img_name
        if img_path.exists():
            st.markdown(f"**{title}**")
            st.image(str(img_path))

# --- Tab 3: Member Lookup ---
with tab3:
    st.subheader("Explain Individual Prediction")
    member_id = st.number_input(
        "Enter Member ID", min_value=1, max_value=len(raw_df), value=1
    )
    idx = member_id - 1
    member = raw_df.iloc[idx]
    prob = probs[idx]

    # --- Prediction result ---
    risk_color = "#e74c3c" if prob > 0.5 else "#f39c12" if prob > 0.2 else "#2ecc71"
    risk_label = "HIGH RISK" if prob > 0.5 else "MEDIUM RISK" if prob > 0.2 else "LOW RISK"
    actual = "Churned" if member["churned"] else "Retained"

    col_r1, col_r2, col_r3 = st.columns(3)
    col_r1.metric("Predicted Churn Risk", f"{prob:.1%}")
    col_r2.metric("Risk Level", risk_label)
    col_r3.metric("Actual Outcome", actual)

    st.markdown("---")

    col1, col2 = st.columns([1, 2])
    with col1:
        st.markdown("#### Member Profile")
        st.markdown(
            f"""
            | Attribute | Value |
            |---|---|
            | **Age** | {member['age']} |
            | **Gender** | {member['gender']} |
            | **Membership** | {member['membership_type']} |
            | **Monthly Fee** | ${member['monthly_fee']:.0f} |
            | **Tenure** | {member['tenure_months']:.0f} months |
            | **Studio** | #{member['home_studio_id']} |
            | **Referral** | {'Yes' if member['has_referral'] else 'No'} |
            | **Distance** | {member['distance_miles']:.1f} mi |
            | | |
            | **Visits (30d)** | {member['visits_last_30d']} |
            | **Visits (60d)** | {member['visits_last_60d']} |
            | **Visits (90d)** | {member['visits_last_90d']} |
            | **Avg/week** | {member['avg_visits_per_week']:.1f} |
            | **Visit Trend** | {member['visit_trend']:+.2f} |
            | **Days Since Visit** | {member['days_since_last_visit']} |
            | **Morning Visits** | {member['pct_morning_visits']:.0%} |
            | **Class Types** | {member['unique_class_types']} |
            | **Late Payments** | {member['late_payments']} |
            """
        )

    with col2:
        st.markdown("#### Why This Prediction (SHAP)")
        explainer = shap.TreeExplainer(model)
        member_X = X.iloc[[idx]]
        sv = explainer(member_X)
        fig, ax = plt.subplots(figsize=(10, 7))
        shap.plots.waterfall(sv[0], max_display=15, show=False)
        plt.title(f"Each bar shows how one feature pushes the prediction up (red) or down (blue)")
        plt.tight_layout()
        st.pyplot(fig)
        plt.close()

# --- Tab 4: What-If Simulator ---
with tab4:
    st.subheader("What-If: Adjust Member Attributes")
    st.markdown("Move the sliders below — the prediction updates in real time.")

    member_id_sim = st.number_input(
        "Base member ID", min_value=1, max_value=len(raw_df), value=1, key="sim_id"
    )
    base = raw_df.iloc[member_id_sim - 1].copy()

    # --- Sliders ---
    col1, col2, col3 = st.columns(3)
    with col1:
        sim_visits = st.slider("Visits last 30d", 0, 30, int(base["visits_last_30d"]))
        sim_tenure = st.slider("Tenure (months)", 1, 72, int(base["tenure_months"]))
    with col2:
        sim_late = st.slider("Late payments", 0, 5, int(base["late_payments"]))
        sim_distance = st.slider("Distance (miles)", 0.5, 25.0, float(base["distance_miles"]))
    with col3:
        sim_morning = st.slider("Morning visit %", 0.0, 1.0, float(base["pct_morning_visits"]))
        sim_classes = st.slider("Unique class types", 1, 8, int(base["unique_class_types"]))

    # --- Compute simulated prediction ---
    sim_row = base.to_dict()
    sim_row.update({
        "visits_last_30d": sim_visits,
        "tenure_months": sim_tenure,
        "late_payments": sim_late,
        "distance_miles": sim_distance,
        "pct_morning_visits": sim_morning,
        "unique_class_types": sim_classes,
    })

    sim_df = pd.DataFrame([sim_row])
    sim_df = sim_df.drop(columns=[c for c in ["churn_probability", "risk_level"] if c in sim_df.columns])
    sim_processed = engineer_features(sim_df)
    sim_X = sim_processed.drop(columns=["churned"])
    sim_prob = float(model.predict_proba(sim_X)[0][1])
    orig_prob = float(probs[member_id_sim - 1])
    delta = sim_prob - orig_prob

    # --- Result ---
    st.markdown("---")
    col_a, col_b = st.columns(2)
    col_a.metric("Original Risk", f"{orig_prob:.1%}")
    col_b.metric(
        "Simulated Risk",
        f"{sim_prob:.1%}",
        delta=f"{delta:+.1%}",
        delta_color="inverse",
    )

# --- Tab 5: Upload Your Data ---
with tab5:
    st.subheader("Score Your Own Members")
    st.markdown(
        "Upload a CSV with your gym members and get churn predictions + SHAP explanations for each one. "
        "**Data is processed in memory only — nothing is stored on the server.**"
    )

    required_cols = [
        "age", "gender", "membership_type", "monthly_fee", "tenure_months",
        "home_studio_id", "has_referral", "distance_miles",
        "visits_last_30d", "visits_last_60d", "visits_last_90d",
        "avg_visits_per_week", "days_since_last_visit", "visit_trend",
        "pct_morning_visits", "unique_class_types", "late_payments",
    ]

    # Step 1: Download template
    st.markdown("### Step 1: Download the CSV template")
    st.markdown("Your CSV must match this format exactly. Download the template, fill in your data, then upload below.")
    template_df = raw_df[required_cols].head(10)
    st.download_button(
        label="Download CSV Template (10 sample rows)",
        data=template_df.to_csv(index=False),
        file_name="gym_churn_template.csv",
        mime="text/csv",
    )

    # Column reference (visible, not collapsed)
    st.markdown("**Required columns:**")
    col_a, col_b = st.columns(2)
    with col_a:
        st.markdown("""
| Column | Type | Example |
|---|---|---|
| `age` | int | 34 |
| `gender` | M / F | F |
| `membership_type` | basic / premium / unlimited | premium |
| `monthly_fee` | float | 99.00 |
| `tenure_months` | float | 8.2 |
| `home_studio_id` | int | 3 |
| `has_referral` | 0 or 1 | 1 |
| `distance_miles` | float | 3.5 |
        """)
    with col_b:
        st.markdown("""
| Column | Type | Example |
|---|---|---|
| `visits_last_30d` | int | 12 |
| `visits_last_60d` | int | 15 |
| `visits_last_90d` | int | 16 |
| `avg_visits_per_week` | float | 3.3 |
| `days_since_last_visit` | int | 3 |
| `visit_trend` | float | -0.25 |
| `pct_morning_visits` | float (0-1) | 0.6 |
| `unique_class_types` | int (1-8) | 5 |
| `late_payments` | int | 1 |
        """)

    # Step 2: Upload
    st.markdown("### Step 2: Upload your CSV")
    uploaded = st.file_uploader("Choose CSV file", type=["csv"])

    if uploaded is not None:
        try:
            user_df = pd.read_csv(uploaded)
        except Exception as e:
            st.error(f"Couldn't parse CSV: {e}")
            st.stop()

        required_set = {
            "age", "gender", "membership_type", "monthly_fee", "tenure_months",
            "home_studio_id", "has_referral", "distance_miles",
            "visits_last_30d", "visits_last_60d", "visits_last_90d",
            "avg_visits_per_week", "days_since_last_visit", "visit_trend",
            "pct_morning_visits", "unique_class_types", "late_payments",
        }
        missing = required_set - set(user_df.columns)
        if missing:
            st.error(f"Missing required columns: {sorted(missing)}")
            st.stop()

        st.success(f"Loaded {len(user_df)} members. Scoring...")

        try:
            user_processed = engineer_features(user_df.copy())
            feature_cols = [c for c in X.columns if c in user_processed.columns]
            missing_features = set(X.columns) - set(feature_cols)
            if missing_features:
                st.error(
                    f"Feature engineering produced mismatched columns. "
                    f"Missing: {sorted(missing_features)}"
                )
                st.stop()

            user_X = user_processed[X.columns]
            user_probs = model.predict_proba(user_X)[:, 1]

            # Per-member SHAP top reasons
            explainer = shap.TreeExplainer(model)
            shap_values = explainer(user_X)
            shap_arr = shap_values.values

            top_reasons = []
            for i in range(len(user_X)):
                row_shap = shap_arr[i]
                top_idx = np.argsort(np.abs(row_shap))[::-1][:3]
                reasons = [
                    f"{X.columns[j]} ({row_shap[j]:+.2f})"
                    for j in top_idx
                ]
                top_reasons.append(" | ".join(reasons))

            result = user_df.copy()
            result["churn_probability"] = user_probs.round(3)
            result["risk_level"] = pd.cut(
                user_probs,
                bins=[-0.01, 0.2, 0.5, 1.01],
                labels=["Low", "Medium", "High"],
            )
            result["top_3_reasons_shap"] = top_reasons
        except Exception as e:
            st.error(f"Prediction failed: {e}")
            st.stop()

        col1, col2, col3 = st.columns(3)
        col1.metric("Scored", f"{len(result):,}")
        col2.metric("High Risk (>50%)", f"{(user_probs > 0.5).sum()}")
        col3.metric("Avg Risk", f"{user_probs.mean():.1%}")

        st.markdown("### Top 20 Highest-Risk Members")
        top_risk = result.sort_values("churn_probability", ascending=False).head(20)
        display_cols = [
            "churn_probability", "risk_level", "membership_type",
            "tenure_months", "visits_last_30d", "late_payments",
            "top_3_reasons_shap",
        ]
        available = [c for c in display_cols if c in top_risk.columns]
        st.dataframe(top_risk[available], use_container_width=True)

        st.download_button(
            label="Download full scored CSV",
            data=result.to_csv(index=False),
            file_name="gym_churn_scored.csv",
            mime="text/csv",
        )

        st.markdown("---")
        st.caption(
            "Scored in memory. Data is never written to disk or shared. "
            "Close this tab to clear it."
        )

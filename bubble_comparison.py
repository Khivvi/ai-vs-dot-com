import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# ============================================================
# 0. Load data  (update paths/filenames as needed)
# ============================================================
dotcom_path = "Company-Metric-1996-1997-1998-1999-2000.csv"
ai_broad_path = "spreadsheet (3).xlsx"   # Pure-play / narrow AI cohort
ai_pure_path = "spreadsheet (4).xlsx"    # Big Tech AI cohort

dotcom = pd.read_csv(dotcom_path)
ai_broad = pd.read_excel(ai_broad_path)
ai_pure = pd.read_excel(ai_pure_path)


# ============================================================
# 1. Helper to reshape into panel format
#    Input: wide metric layout
#    Output: DataFrame with Company, Year, MarketCap, Revenue, ValRev
# ============================================================
def tidy_panel(df: pd.DataFrame, years):
    records = []
    i = 0
    while i < len(df):
        company = df.loc[i, "Company"]
        if pd.isna(company):
            i += 1
            continue

        # We assume each company is 3 rows: Market Cap, Revenue, Valuation/Revenue
        block = df.iloc[i : i + 3].reset_index(drop=True)
        mc_row = block[block["Metric"] == "Market Cap ($bn)"]
        rev_row = block[block["Metric"] == "Revenue ($bn)"]
        vr_row = block[block["Metric"] == "Valuation/Revenue"]

        for y in years:
            col = str(y)
            records.append(
                {
                    "Company": company,
                    "Year": int(y),
                    "MarketCap": float(mc_row[col]) if not mc_row.empty else np.nan,
                    "Revenue": float(rev_row[col]) if not rev_row.empty else np.nan,
                    "ValRev": float(vr_row[col]) if not vr_row.empty else np.nan,
                }
            )
        i += 3

    return pd.DataFrame(records)


# ============================================================
# 2. Build tidy datasets for each cohort
# ============================================================
dotcom_tidy = tidy_panel(dotcom, [1996, 1997, 1998, 1999, 2000])
ai_pure_tidy = tidy_panel(ai_pure, [2020, 2021, 2022, 2023, 2024, 2025])
ai_niche_tidy = tidy_panel(ai_broad, [2020, 2021, 2022, 2023, 2024, 2025])

dotcom_tidy["Era"] = "Dot-com (1996-2000)"
ai_pure_tidy["Era"] = "Big Tech AI (2020-2025)"
ai_niche_tidy["Era"] = "Pure-play AI (2020-2025)"

# Small helper to avoid taking log of non-positive values
def safe_log(series: pd.Series):
    series = series.dropna()
    series = series[series > 0]
    return np.log(series)


# ============================================================
# 3. LOG Normalised Average Valuation/Revenue (P/S) over time
# ============================================================
def plot_avg_log_ps_over_time():
    plt.figure(figsize=(10, 5))
    for df, label in [
        (dotcom_tidy, "Dot-com"),
        (ai_pure_tidy, "Big Tech AI"),
        (ai_niche_tidy, "Pure AI"),
    ]:
        grp = df.groupby("Year")["ValRev"].mean()
        grp = grp.dropna()
        grp = grp[grp > 0]
        plt.plot(
            grp.index,
            np.log(grp.values),
            marker="o",
            label=label,
        )

    plt.xlabel("Year")
    plt.ylabel("log(Valuation / Revenue)")
    plt.title("LOG Normalised Average Valuation/Revenue by Era")
    plt.legend()
    plt.tight_layout()
    plt.show()


# ============================================================
# 4. Log-normalised P/S boxplot at bubble peaks
#    Dot-com peak: 1999-2000
#    Big Tech AI peak: 2023-2025
#    Pure AI peak: 2023-2025
# ============================================================
def plot_peak_ps_boxplot():
    dotcom_peak = dotcom_tidy[dotcom_tidy["Year"].isin([1999, 2000])]
    ai_pure_peak = ai_pure_tidy[ai_pure_tidy["Year"].isin([2023, 2024, 2025])]
    ai_niche_peak = ai_niche_tidy[ai_niche_tidy["Year"].isin([2023, 2024, 2025])]

    data_box = [
        safe_log(dotcom_peak["ValRev"]),
        safe_log(ai_pure_peak["ValRev"]),
        safe_log(ai_niche_peak["ValRev"]),
    ]

    plt.figure(figsize=(10, 5))
    plt.boxplot(
        data_box,
        labels=["Dot-com peak (log)", "Big Tech AI peak (log)", "Pure AI peak (log)"],
    )
    plt.ylabel("log(Valuation / Revenue)")
    plt.title("Log-Normalized P/S Distribution at Bubble Peaks")
    plt.tight_layout()
    plt.show()


# ============================================================
# 5. Log-log Market Cap vs Revenue scatter, coloured by era
# ============================================================
def plot_loglog_marketcap_vs_revenue():
    combined = pd.concat([dotcom_tidy, ai_pure_tidy, ai_niche_tidy], ignore_index=True)

    plt.figure(figsize=(10, 6))
    markers = {
        "Dot-com (1996-2000)": "x",
        "Big Tech AI (2020-2025)": "o",
        "Pure-play AI (2020-2025)": "^",
    }

    for era, sub in combined.groupby("Era"):
        # Keep only positive values for log-log
        mask = (sub["Revenue"] > 0) & (sub["MarketCap"] > 0)
        sub_pos = sub[mask]
        plt.scatter(
            np.log(sub_pos["Revenue"]),
            np.log(sub_pos["MarketCap"]),
            label=era,
            marker=markers.get(era, "o"),
            alpha=0.8,
        )

    plt.xlabel("log(Revenue)")
    plt.ylabel("log(Market Cap)")
    plt.title("Log-Log Market Cap vs Revenue: Dot-com vs AI Cohorts")
    plt.legend()
    plt.tight_layout()
    plt.show()


# ============================================================
# 6. LOG Median Valuation/Revenue Across Eras (bar chart)
# ============================================================
def median_log_ps(df: pd.DataFrame, years):
    ps = df[df["Year"].isin(years)]["ValRev"]
    ps = ps.dropna()
    ps = ps[ps > 0]
    if len(ps) == 0:
        return np.nan
    return np.log(ps.median())


def plot_median_log_ps_bar():
    med_data = {
        "Dot-com peak": median_log_ps(dotcom_tidy, [1999, 2000]),
        "Big Tech AI peak": median_log_ps(ai_pure_tidy, [2023, 2024, 2025]),
        "Pure AI peak": median_log_ps(ai_niche_tidy, [2023, 2024, 2025]),
    }

    plt.figure(figsize=(8, 5))
    plt.bar(list(med_data.keys()), list(med_data.values()))
    plt.ylabel("log(Median Valuation / Revenue)")
    plt.title("LOG Median Valuation/Revenue Across Eras")
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    plot_avg_log_ps_over_time()
    plot_peak_ps_boxplot()
    plot_loglog_marketcap_vs_revenue()
    plot_median_log_ps_bar()

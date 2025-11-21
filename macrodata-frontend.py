import pathlib
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
import altair as alt
import streamlit as st


@st.cache_data(show_spinner=False)
def load_macrodata(csv_path: str) -> pd.DataFrame:
	"""Load macro data CSV and parse dates, sort, and de-duplicate by Date (keep last)."""
	df = pd.read_csv(csv_path)
	# Fix known header typo to standardize column names
	if "NASDAQ Yearly Growith" in df.columns and "NASDAQ Yearly Growth" not in df.columns:
		df = df.rename(columns={"NASDAQ Yearly Growith": "NASDAQ Yearly Growth"})
	df["Date"] = pd.to_datetime(df["Date"], errors="coerce", infer_datetime_format=True)
	df = df.dropna(subset=["Date"]).sort_values("Date")
	# In case of duplicate quarterly dates (some early rows), keep the last (more complete) row
	df = df.drop_duplicates(subset=["Date"], keep="last").reset_index(drop=True)
	return df


def get_macro_columns(df: pd.DataFrame) -> List[str]:
	"""Return the five macro columns to display if present in the dataframe."""
	candidate_columns = [
		"Inflation",
		"Unemployment",
		"Interest Rate",
		"GDP Yearly Growth",
		"NASDAQ Yearly Growth",
	]
	return [c for c in candidate_columns if c in df.columns]


def filter_by_date_range(df: pd.DataFrame, date_range: Tuple[pd.Timestamp, pd.Timestamp]) -> pd.DataFrame:
	"""Filter dataframe by inclusive date range tuple (start, end)."""
	start_date, end_date = date_range
	mask = (df["Date"] >= start_date) & (df["Date"] <= end_date)
	return df.loc[mask].reset_index(drop=True)


def normalize_dataframe(df: pd.DataFrame, columns: List[str], method: str, reference_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
	"""
	Normalize selected columns.
	- None: return unchanged
	- Index to 100: first non-null value in range becomes 100
	- Z-score: (x - mean) / std, computed against the reference_df if provided (global)
	"""
	if method == "None":
		return df

	out = df.copy()
	if method == "Index to 100":
		for col in columns:
			series = out[col].astype(float)
			first_valid = series.dropna()
			if first_valid.empty:
				continue
			base = first_valid.iloc[0]
			if base != 0:
				out[col] = (series / base) * 100.0
	elif method == "Z-score (standardize)":
		ref = reference_df if reference_df is not None else df
		for col in columns:
			ref_series = ref[col].astype(float)
			mean = ref_series.mean(skipna=True)
			std = ref_series.std(skipna=True)
			if pd.notna(std) and std != 0:
				out[col] = (out[col].astype(float) - mean) / std
	return out


def to_long_format(df: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
	"""Melt wide macro columns to long format for Altair."""
	long_df = df[["Date"] + columns].melt(id_vars="Date", value_vars=columns, var_name="Series", value_name="Value")
	return long_df.dropna(subset=["Value"])


def to_long_with_original(original_df: pd.DataFrame, normalized_df: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
	"""Return long format with both normalized value for plotting and original value for hover labels/tooltips."""
	long_norm = normalized_df[["Date"] + columns].melt(
		id_vars="Date", value_vars=columns, var_name="Series", value_name="Value"
	)
	long_orig = original_df[["Date"] + columns].melt(
		id_vars="Date", value_vars=columns, var_name="Series", value_name="OriginalValue"
	)
	long_df = pd.merge(long_norm, long_orig, on=["Date", "Series"], how="left")
	return long_df.dropna(subset=["Value"])


def build_chart(long_df: pd.DataFrame, y_title: str) -> alt.Chart:
	"""
	Plot normalized values; hovering anywhere along a date shows a vertical rule and,
	for that date, displays all series with tooltips/labels using actual values.
	"""
	# Invisible selector layer to robustly capture hover across the chart
	hover = alt.selection_point(fields=["Date"], nearest=True, on="mousemove", empty=False, name="hover_date")

	base = alt.Chart(long_df)

	# Lines (always visible)
	lines = base.mark_line().encode(
		x=alt.X("Date:T", title="Date"),
		y=alt.Y("Value:Q", title=y_title),
		color=alt.Color("Series:N", title="Macroeconomic Series"),
	)

	# Selector rules for each date (opacity 0) to capture hover reliably
	selectors = base.mark_rule(opacity=0).encode(x="Date:T").add_params(hover)

	# Vertical rule at hovered date
	rule = base.mark_rule(color="gray").encode(x="Date:T").transform_filter(hover)

	# Points at hovered date for all series
	points = base.mark_circle(size=45).encode(
		x="Date:T",
		y="Value:Q",
		color="Series:N",
		tooltip=[
			alt.Tooltip("Date:T", title="Date"),
			alt.Tooltip("Series:N", title="Series"),
			alt.Tooltip("OriginalValue:Q", title="Actual", format=",.2f"),
		],
	).transform_filter(hover)

	# Stacked label panel at the hovered date: show all actual values together
	labels_bg = base.mark_text(align="left", dx=6, fontSize=12, stroke="white", strokeWidth=3).encode(
		x="Date:T",
		y=alt.Y("Series:N", axis=None, sort=None),
		color=alt.Color("Series:N", legend=None),
		text=alt.Text("OriginalValue:Q", format=",.2f"),
	).transform_filter(hover)

	labels_fg = base.mark_text(align="left", dx=6, fontSize=12).encode(
		x="Date:T",
		y=alt.Y("Series:N", axis=None, sort=None),
		color=alt.Color("Series:N", legend=None),
		text=alt.Text("OriginalValue:Q", format=",.2f"),
	).transform_filter(hover)

	return alt.layer(lines, selectors, rule, points, labels_bg, labels_fg).properties(height=450)


def main() -> None:
	st.set_page_config(page_title="Macro Trends Overview", layout="wide")
	st.title("Macroeconomic Trends – Time Series")
	st.caption("Displays Inflation, Unemployment, Interest Rate, GDP Yearly Growth, and NASDAQ Yearly Growth on one chart.")

	data_path = pathlib.Path(__file__).parent / "data" / "combined-macrodata.csv"
	if not data_path.exists():
		st.error(f"Data file not found at: {data_path}")
		return

	df = load_macrodata(str(data_path))
	macro_columns = get_macro_columns(df)
	if len(macro_columns) < 1:
		st.error("No expected macroeconomic columns found in the dataset.")
		return

	# Controls on the left sidebar
	st.sidebar.header("Controls")
	min_date = pd.to_datetime(df["Date"].min())
	max_date = pd.to_datetime(df["Date"].max())
	date_range = st.sidebar.slider(
		"Date range",
		min_value=min_date.to_pydatetime(),
		max_value=max_date.to_pydatetime(),
		value=(min_date.to_pydatetime(), max_date.to_pydatetime()),
		format="YYYY-MM-DD",
	)

	normalization = st.sidebar.selectbox(
		"Normalization",
		options=["Z-score (standardize)", "Index to 100", "None"],
		index=0,
		help="Chart shows standardized (Z-score) values. Hover displays actual values.",
	)

	zoom_period = st.sidebar.selectbox(
		"Zoom period (second chart)",
		options=[
			"None",
			"AI Boom (2022–2025)",
			"Dot-com Bubble (1995–2002)",
			"Housing Bubble (2003–2009)",
			"Smartphone Era (2007–2015)",
			"Reaganomics (1981–1989)",
		],
		index=1,
		help="Select a predefined time window to show a zoomed chart below.",
	)

	st.sidebar.subheader("Series")
	selected = []
	for col in macro_columns:
		if st.sidebar.checkbox(col, True):
			selected.append(col)

	df_range = filter_by_date_range(df, (pd.to_datetime(date_range[0]), pd.to_datetime(date_range[1])))
	if not selected:
		st.warning("Select at least one series in the left sidebar to display the chart.")
		return

	df_norm = normalize_dataframe(df_range, selected, normalization, reference_df=df if normalization.startswith("Z-score") else None)
	long_df = to_long_with_original(df_range, df_norm, selected)

	# If normalization produced no plottable data (e.g., zero std within range), gracefully fall back
	if long_df.empty:
		st.info("Selected range/normalization yielded no data. Showing original values instead.")
		long_df = to_long_with_original(df_range, df_range, selected)
		normalization = "None"

	# Dynamic y-axis title based on normalization
	if normalization == "Index to 100":
		y_title = "Index (Base = 100)"
	elif normalization == "Z-score (standardize)":
		y_title = "Z-score"
	else:
		y_title = "Value (original units)"

	chart = build_chart(long_df, y_title)
	st.altair_chart(chart, use_container_width=True)

	# Optional second chart: zoomed view for a predefined period
	if zoom_period != "None":
		if zoom_period.startswith("AI Boom"):
			zoom_start, zoom_end = pd.to_datetime("2022-01-01"), pd.to_datetime("2025-12-31")
		elif zoom_period.startswith("Dot-com Bubble"):
			zoom_start, zoom_end = pd.to_datetime("1995-01-01"), pd.to_datetime("2002-12-31")
		elif zoom_period.startswith("Housing Bubble"):
			zoom_start, zoom_end = pd.to_datetime("2003-01-01"), pd.to_datetime("2009-12-31")
		elif zoom_period.startswith("Smartphone Era"):
			zoom_start, zoom_end = pd.to_datetime("2007-01-01"), pd.to_datetime("2015-12-31")
		elif zoom_period.startswith("Reaganomics"):
			zoom_start, zoom_end = pd.to_datetime("1981-01-01"), pd.to_datetime("1989-12-31")
		else:
			zoom_start, zoom_end = df["Date"].min(), df["Date"].max()

		df_zoom = filter_by_date_range(df, (zoom_start, zoom_end))
		df_zoom_norm = normalize_dataframe(df_zoom, selected, normalization, reference_df=df if normalization.startswith("Z-score") else None)
		long_zoom = to_long_with_original(df_zoom, df_zoom_norm, selected)

		if long_zoom.empty:
			long_zoom = to_long_with_original(df_zoom, df_zoom, selected)
			y_title_zoom = "Value (original units)"
		else:
			y_title_zoom = y_title

		st.markdown("#### Zoomed view")
		st.altair_chart(build_chart(long_zoom, y_title_zoom), use_container_width=True)


if __name__ == "__main__":
	main()


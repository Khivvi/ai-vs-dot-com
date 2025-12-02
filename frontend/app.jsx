const { useEffect, useRef, useState } = React;

// ============================================================
// 0. PATHS & THEME
// ============================================================

// All paths are relative to /frontend/index.html
const DATA_PATHS = {
  dotcom: "Dotcom.csv",          // lives in frontend/
  bigTech: "HighTech.xlsx",      // lives in frontend/
  pureAi: "PureAI.xlsx",         // lives in frontend/
  macro: "../data/combined-macrodata.csv", // lives in data/
};

const THEME = {
  text: "#94a3b8",
  grid: "rgba(255, 255, 255, 0.06)",
  tooltipBg: "rgba(15, 22, 41, 0.9)",
  tooltipBorder: "rgba(255, 255, 255, 0.1)",
};

const SERIES_COLORS = {
  dotcom: { solid: "#f472b6", fill: "rgba(244, 114, 182, 0.2)" },
  bigTech: { solid: "#22c55e", fill: "rgba(34, 197, 94, 0.2)" },
  pureAi: { solid: "#38bdf8", fill: "rgba(56, 189, 248, 0.2)" },
};

const MACRO_COLORS = [
  "#a78bfa",
  "#38bdf8",
  "#34d399",
  "#f472b6",
  "#fbbf24",
];

const MACRO_COLUMNS = [
  "Inflation",
  "Unemployment",
  "Interest Rate",
  "GDP Yearly Growth",
  "NASDAQ Yearly Growth",
];

// ============================================================
// 1. Data loading helpers
// ============================================================

// Strip BOM + outer quotes from a CSV token
function cleanCsvToken(s) {
  if (s == null) return "";
  let t = String(s).trim().replace(/^\uFEFF/, ""); // remove BOM if present
  if (t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1);
  }
  return t;
}

async function loadCsvAsObjects(path) {
  const res = await fetch(path);
  if (!res.ok) {
    console.error(`❌ Failed to load CSV at ${path}`, res.status, res.statusText);
    throw new Error(`Failed to load CSV: ${path}`);
  }
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) {
    console.warn(`⚠️ CSV at ${path} is empty`);
    return [];
  }

  const headers = lines[0].split(",").map((h) => cleanCsvToken(h));
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => cleanCsvToken(c));
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });

  console.log("First CSV row keys:", Object.keys(rows[0] || {}));
  return rows;
}

async function loadExcelAsObjects(path) {
  const res = await fetch(path);
  if (!res.ok) {
    console.error(`❌ Failed to load Excel at ${path}`, res.status, res.statusText);
    throw new Error(`Failed to load Excel: ${path}`);
  }
  const buffer = await res.arrayBuffer();
  const wb = XLSX.read(buffer);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows;
}

// Convert "Company/Metric/year columns" → tidy panel
function tidyPanelJS(rows, years) {
  const records = [];
  let i = 0;

  while (i < rows.length) {
    const base = rows[i];
    const company = base["Company"];
    if (!company) {
      i += 1;
      continue;
    }

    const block = rows.slice(i, i + 3);
    const mcRow = block.find((r) => r["Metric"] === "Market Cap ($bn)") || {};
    const revRow = block.find((r) => r["Metric"] === "Revenue ($bn)") || {};
    const vrRow = block.find((r) => r["Metric"] === "Valuation/Revenue") || {};

    years.forEach((y) => {
      const col = String(y);
      records.push({
        Company: company,
        Year: y,
        MarketCap: Number(mcRow[col]) || null,
        Revenue: Number(revRow[col]) || null,
        ValRev: Number(vrRow[col]) || null,
      });
    });

    i += 3;
  }

  return records;
}

// CSV → panel with strong logging
async function loadDotcomPanel() {
  try {
    const rows = await loadCsvAsObjects(DATA_PATHS.dotcom);
    console.log(`✅ Loaded Dotcom.csv, raw rows: ${rows.length}`);

    const panel = tidyPanelJS(rows, [1996, 1997, 1998, 1999, 2000]);
    console.log(`✅ Tidy dot-com panel records: ${panel.length}`);

    const usable = panel.filter((r) => r.ValRev != null && r.ValRev > 0);
    if (!usable.length) {
      console.warn(
        "⚠️ Dot-com data loaded but no positive ValRev values found. " +
          "Check that the CSV has a 'Valuation/Revenue' column with numeric values."
      );
    }
    return panel;
  } catch (e) {
    console.error("❌ Dot-com panel failed to load:", e);
    return [];
  }
}

// Excel → panel with logging
async function loadExcelPanel(path, years, label) {
  try {
    const rows = await loadExcelAsObjects(path);
    console.log(`✅ Loaded ${label}, raw rows: ${rows.length}`);
    const panel = tidyPanelJS(rows, years);
    console.log(`✅ Tidy ${label} panel records: ${panel.length}`);
    return panel;
  } catch (e) {
    console.error(`❌ Failed to load ${label}:`, e);
    return [];
  }
}

// ============================================================
// 2. Valuation helpers
// ============================================================

function safeLogArray(values) {
  return values
    .filter((v) => v != null && v > 0)
    .map((v) => Math.log(v));
}

function groupAvgLogPsByYear(records) {
  const byYear = new Map();
  records.forEach((r) => {
    if (r.ValRev != null && r.ValRev > 0) {
      if (!byYear.has(r.Year)) byYear.set(r.Year, []);
      byYear.get(r.Year).push(r.ValRev);
    }
  });

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const logVals = years.map((y) => {
    const arr = byYear.get(y);
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.log(avg);
  });

  return { years, logVals };
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = (sortedArr.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  return (
    sortedArr[lower] * (1 - (idx - lower)) +
    sortedArr[upper] * (idx - lower)
  );
}

function computeBoxStats(logValues) {
  if (!logValues.length) {
    return { min: null, q1: null, median: null, q3: null, max: null };
  }
  const sorted = [...logValues].sort((a, b) => a - b);
  return {
    min: sorted[0],
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    q3: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1],
  };
}

function medianLogPs(records, years) {
  const vals = records
    .filter((r) => years.includes(r.Year))
    .map((r) => r.ValRev)
    .filter((v) => v != null && v > 0);

  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const median =
    vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
  return Math.log(median);
}

// ============================================================
// 3. Macro helpers
// ============================================================

function parseMacroCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];

  const rawHeaders = lines[0].split(",").map((h) => cleanCsvToken(h));
  const headers = rawHeaders.map((h) =>
    h === "NASDAQ Yearly Growith" ? "NASDAQ Yearly Growth" : h
  );

  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => cleanCsvToken(c));
    const row = {};
    headers.forEach((h, i) => {
      const cell = cells[i];
      if (h === "Date") {
        const d = new Date(cell);
        row.Date = Number.isNaN(d.getTime()) ? null : d;
      } else {
        const num = Number(cell);
        row[h] = Number.isFinite(num) ? num : null;
      }
    });
    return row;
  });

  const valid = rows.filter(
    (r) => r.Date instanceof Date && !Number.isNaN(r.Date.getTime())
  );
  valid.sort((a, b) => a.Date - b.Date);

  const deduped = new Map();
  valid.forEach((r) => deduped.set(r.Date.toISOString(), r));
  return Array.from(deduped.values());
}

async function loadMacrodata() {
  try {
    const res = await fetch(DATA_PATHS.macro);
    if (!res.ok) {
      console.error(
        `❌ Failed to load macro CSV at ${DATA_PATHS.macro}`,
        res.status,
        res.statusText
      );
      throw new Error("Macro CSV load failed");
    }
    const text = await res.text();
    const parsed = parseMacroCsv(text);
    console.log(`✅ Macro rows: ${parsed.length}`);
    return parsed;
  } catch (e) {
    console.error("❌ Macro dataset failed to load:", e);
    return [];
  }
}

function normalizeMacro(rows, columns, method, referenceRows) {
  if (method === "None") return rows;
  const ref = referenceRows && referenceRows.length ? referenceRows : rows;
  const stats = {};

  if (method === "Index to 100") {
    columns.forEach((col) => {
      const firstValid = rows.map((r) => r[col]).find((v) => v != null);
      stats[col] = { base: firstValid ?? null };
    });
  } else if (method === "Z-score (standardize)") {
    columns.forEach((col) => {
      const values = ref
        .map((r) => r[col])
        .filter((v) => v != null);
      const mean =
        values.reduce((s, v) => s + v, 0) / (values.length || 1);
      const variance =
        values.reduce((s, v) => s + (v - mean) ** 2, 0) /
        (values.length || 1);
      stats[col] = { mean, std: Math.sqrt(variance) };
    });
  }

  return rows.map((row) => {
    const next = { ...row };
    columns.forEach((col) => {
      const val = row[col];
      if (val == null) {
        next[col] = null;
        return;
      }
      if (method === "Index to 100") {
        const base = stats[col].base;
        next[col] = base && base !== 0 ? (val / base) * 100 : null;
      } else if (method === "Z-score (standardize)") {
        const { mean, std } = stats[col];
        next[col] = std && std !== 0 ? (val - mean) / std : null;
      }
    });
    return next;
  });
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
  }).format(date);
}

// ============================================================
// 4. Chart glue
// ============================================================

Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.color = THEME.text;
Chart.defaults.borderColor = THEME.grid;

function useChart(canvasRef, configFactory, deps) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext("2d");
    const config = configFactory(ctx);
    chartRef.current = new Chart(ctx, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, deps);
}

// ================== Story charts ============================

function AvgPsLineChart({ dotcom, aiPure, aiBroad }) {
  const canvasRef = useRef(null);

  const dot = groupAvgLogPsByYear(dotcom);
  const pure = groupAvgLogPsByYear(aiPure);
  const broad = groupAvgLogPsByYear(aiBroad);

  const allYears = Array.from(
    new Set([...dot.years, ...pure.years, ...broad.years])
  ).sort((a, b) => a - b);

  const align = (series) => {
    const map = new Map(
      series.years.map((y, i) => [y, series.logVals[i]])
    );
    return allYears.map((y) => map.get(y) ?? null);
  };

  useChart(
    canvasRef,
    () => ({
      type: "line",
      data: {
        labels: allYears,
        datasets: [
          {
            label: "Dot-com",
            data: align(dot),
            borderColor: SERIES_COLORS.dotcom.solid,
            backgroundColor: SERIES_COLORS.dotcom.fill,
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
          {
            label: "Big Tech AI",
            data: align(pure),
            borderColor: SERIES_COLORS.bigTech.solid,
            backgroundColor: SERIES_COLORS.bigTech.fill,
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
          {
            label: "Pure-play AI",
            data: align(broad),
            borderColor: SERIES_COLORS.pureAi.solid,
            backgroundColor: SERIES_COLORS.pureAi.fill,
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { usePointStyle: true, boxWidth: 6 } },
          tooltip: {
            backgroundColor: THEME.tooltipBg,
            titleColor: "#fff",
            bodyColor: "#cbd5e1",
            borderColor: THEME.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (c) =>
                `${c.dataset.label}: ${Math.exp(c.raw).toFixed(1)}x P/S`,
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            title: {
              display: true,
              text: "log(Valuation / Revenue)",
            },
          },
        },
      },
    }),
    [JSON.stringify(allYears), dotcom.length, aiPure.length, aiBroad.length]
  );

  return <canvas ref={canvasRef} />;
}

function PeakBoxplotChart({ dotLog, pureLog, broadLog }) {
  const canvasRef = useRef(null);
  const realStats = [
    computeBoxStats(dotLog),
    computeBoxStats(pureLog),
    computeBoxStats(broadLog),
  ];

  const yBounds = (() => {
    const finiteStats = realStats.filter(
      (s) => Number.isFinite(s.min) && Number.isFinite(s.max)
    );
    if (!finiteStats.length) return { min: undefined, max: undefined };

    const minVal = Math.min(...finiteStats.map((s) => s.min));
    const maxVal = Math.max(...finiteStats.map((s) => s.max));
    const range = Math.max(1, maxVal - minVal);
    const pad = range * 0.15;

    return { min: minVal - pad, max: maxVal + pad };
  })();

  useChart(
    canvasRef,
    (ctx) => {
      const boxplotPlugin = {
        id: "customBoxplot",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          ctx.save();
          ctx.lineWidth = 2;

          chart.getDatasetMeta(0).data.forEach((bar, idx) => {
            const stat = realStats[idx];
            if (!stat || stat.median == null) return;

            const x = bar.x;
            const yScale = chart.scales.y;
            const yMin = yScale.getPixelForValue(stat.min);
            const yQ1 = yScale.getPixelForValue(stat.q1);
            const yMed = yScale.getPixelForValue(stat.median);
            const yQ3 = yScale.getPixelForValue(stat.q3);
            const yMax = yScale.getPixelForValue(stat.max);
            const w = 40;

            const color =
              idx === 0
                ? SERIES_COLORS.dotcom.solid
                : idx === 1
                ? SERIES_COLORS.bigTech.solid
                : SERIES_COLORS.pureAi.solid;
            const fill =
              idx === 0
                ? SERIES_COLORS.dotcom.fill
                : idx === 1
                ? SERIES_COLORS.bigTech.fill
                : SERIES_COLORS.pureAi.fill;

            ctx.strokeStyle = color;
            ctx.fillStyle = fill;

            // whiskers
            ctx.beginPath();
            ctx.moveTo(x, yMin);
            ctx.lineTo(x, yQ1);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x, yQ3);
            ctx.lineTo(x, yMax);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x - w / 4, yMin);
            ctx.lineTo(x + w / 4, yMin);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x - w / 4, yMax);
            ctx.lineTo(x + w / 4, yMax);
            ctx.stroke();

            // box
            ctx.beginPath();
            ctx.rect(x - w / 2, yQ3, w, yQ1 - yQ3);
            ctx.fill();
            ctx.stroke();

            // median
            ctx.beginPath();
            ctx.moveTo(x - w / 2, yMed);
            ctx.lineTo(x + w / 2, yMed);
            ctx.stroke();
          });

          ctx.restore();
        },
      };

      return {
        type: "bar",
        data: {
          labels: ["Dot-com Peak", "Big Tech AI Peak", "Pure AI Peak"],
          datasets: [
            {
              label: "Hidden",
              data: realStats.map((s) => s.median),
              backgroundColor: "transparent",
              borderWidth: 0,
            },
          ],
        },
        plugins: [boxplotPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              title: { display: true, text: "log(P/S Distribution)" },
              suggestedMin: yBounds.min,
              suggestedMax: yBounds.max,
            },
          },
        },
      };
    },
    [JSON.stringify(realStats)]
  );

  return <canvas ref={canvasRef} />;
}

function McRevScatterChart({ dotcom, aiPure, aiBroad }) {
  const canvasRef = useRef(null);

  const makePoints = (records) =>
    records
      .filter((r) => r.MarketCap > 0 && r.Revenue > 0)
      .map((r) => ({
        x: Math.log(r.Revenue),
        y: Math.log(r.MarketCap),
      }));

  useChart(
    canvasRef,
    () => ({
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Dot-com",
            data: makePoints(dotcom),
            backgroundColor: SERIES_COLORS.dotcom.fill,
            borderColor: SERIES_COLORS.dotcom.solid,
            borderWidth: 1,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: "Big Tech AI",
            data: makePoints(aiPure),
            backgroundColor: SERIES_COLORS.bigTech.fill,
            borderColor: SERIES_COLORS.bigTech.solid,
            borderWidth: 1,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: "Pure-play AI",
            data: makePoints(aiBroad),
            backgroundColor: SERIES_COLORS.pureAi.fill,
            borderColor: SERIES_COLORS.pureAi.solid,
            borderWidth: 1,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { usePointStyle: true } },
          tooltip: {
            backgroundColor: THEME.tooltipBg,
            borderColor: THEME.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              label: (c) =>
                `${c.dataset.label}: log(Rev)=${c.raw.x.toFixed(
                  2
                )}, log(MC)=${c.raw.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "log(Revenue)" },
            grid: { display: false },
          },
          y: {
            title: { display: true, text: "log(Market Cap)" },
          },
        },
      },
    }),
    [dotcom.length, aiPure.length, aiBroad.length]
  );

  return <canvas ref={canvasRef} />;
}

function MedianPsBarChart({ dotMed, pureMed, broadMed }) {
  const canvasRef = useRef(null);

  useChart(
    canvasRef,
    () => ({
      type: "bar",
      data: {
        labels: ["Dot-com Peak", "Big Tech AI Peak", "Pure AI Peak"],
        datasets: [
          {
            label: "Median log(P/S)",
            data: [dotMed, pureMed, broadMed],
            backgroundColor: [
              SERIES_COLORS.dotcom.fill,
              SERIES_COLORS.bigTech.fill,
              SERIES_COLORS.pureAi.fill,
            ],
            borderColor: [
              SERIES_COLORS.dotcom.solid,
              SERIES_COLORS.bigTech.solid,
              SERIES_COLORS.pureAi.solid,
            ],
            borderWidth: 2,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            title: { display: true, text: "Median log(P/S)" },
          },
        },
      },
    }),
    [dotMed, pureMed, broadMed]
  );

  return <canvas ref={canvasRef} />;
}

// ================== Macro chart ============================

function MacroLineChart({ series, yTitle }) {
  const canvasRef = useRef(null);

  useChart(
    canvasRef,
    () => ({
      type: "line",
      data: {
        datasets: series.map((s, idx) => ({
          label: s.label,
          data: s.data,
          borderColor: s.color || MACRO_COLORS[idx % MACRO_COLORS.length],
          backgroundColor:
            (s.color || MACRO_COLORS[idx % MACRO_COLORS.length]) + "20",
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { usePointStyle: true, boxWidth: 6 },
          },
          tooltip: {
            backgroundColor: THEME.tooltipBg,
            borderColor: THEME.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              title: (items) =>
                items[0]
                  ? formatDateLabel(new Date(items[0].raw.x))
                  : "",
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            ticks: {
              callback: (v) => formatDateLabel(new Date(v)),
              maxTicksLimit: 8,
            },
            grid: { display: false },
          },
          y: {
            title: { display: true, text: yTitle },
          },
        },
      },
    }),
    [JSON.stringify(series), yTitle]
  );

  return <canvas ref={canvasRef} />;
}

// ============================================================
// 5. Main Application
// ============================================================

function App() {
  const [dotcom, setDotcom] = useState([]);
  const [aiBroad, setAiBroad] = useState([]);
  const [aiPure, setAiPure] = useState([]);
  const [macroRows, setMacroRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  const [cohortToggles, setCohortToggles] = useState({
    dotcom: true,
    aiPure: true,
    aiBroad: true,
  });
  const [activeStory, setActiveStory] = useState("ps-trend");

  const [macroColsState, setMacroColumns] = useState([]);
  const [macroSelection, setMacroSelection] = useState({});
  const [macroRange, setMacroRange] = useState([0, 0]);
  const [macroNormalization, setMacroNormalization] = useState(
    "Z-score (standardize)"
  );
  const [macroZoom, setMacroZoom] = useState("AI Boom (2022–2025)");

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [dotPanel, purePanel, broadPanel, mRows] = await Promise.all([
          loadDotcomPanel(),
          loadExcelPanel(
            DATA_PATHS.bigTech,
            [2020, 2021, 2022, 2023, 2024, 2025],
            "HighTech.xlsx (Big Tech AI)"
          ),
          loadExcelPanel(
            DATA_PATHS.pureAi,
            [2020, 2021, 2022, 2023, 2024, 2025],
            "PureAI.xlsx (Pure-play AI)"
          ),
          loadMacrodata(),
        ]);

        if (dotPanel.length) setDotcom(dotPanel);
        if (purePanel.length) setAiPure(purePanel);
        if (broadPanel.length) setAiBroad(broadPanel);

        if (!dotPanel.length || !purePanel.length || !broadPanel.length) {
          setUsingFallback(true);
        }

        if (mRows && mRows.length) {
          const mCols = MACRO_COLUMNS.filter((c) => c in mRows[0]);
          setMacroRows(mRows);
          setMacroColumns(mCols);
          setMacroSelection(
            mCols.reduce((acc, c) => ({ ...acc, [c]: true }), {})
          );
          setMacroRange([0, Math.max(mRows.length - 1, 0)]);
        }
      } catch (e) {
        console.error("Data load failed:", e);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  const activeDotcom = cohortToggles.dotcom ? dotcom : [];
  const activeAiPure = cohortToggles.aiPure ? aiPure : [];
  const activeAiBroad = cohortToggles.aiBroad ? aiBroad : [];

  const dotPeak = activeDotcom.filter((r) => [1999, 2000].includes(r.Year));
  const aiPurePeak = activeAiPure.filter((r) =>
    [2023, 2024, 2025].includes(r.Year)
  );
  const aiBroadPeak = activeAiBroad.filter((r) =>
    [2023, 2024, 2025].includes(r.Year)
  );

  const dotPeakLog = safeLogArray(dotPeak.map((r) => r.ValRev));
  const aiPurePeakLog = safeLogArray(aiPurePeak.map((r) => r.ValRev));
  const aiBroadPeakLog = safeLogArray(aiBroadPeak.map((r) => r.ValRev));

  const dotMed = medianLogPs(activeDotcom, [1999, 2000]);
  const pureMed = medianLogPs(activeAiPure, [2023, 2024, 2025]);
  const broadMed = medianLogPs(activeAiBroad, [2023, 2024, 2025]);

  const macroFiltered = macroRows.slice(macroRange[0], macroRange[1] + 1);
  const macroSelectedCols = macroColsState.filter((c) => macroSelection[c]);
  const macroNormData = normalizeMacro(
    macroFiltered,
    macroSelectedCols,
    macroNormalization,
    macroRows
  );

  const buildSeries = (data, normData) =>
    macroSelectedCols.map((col, i) => ({
      label: col,
      color: MACRO_COLORS[i % MACRO_COLORS.length],
      data: data
        .map((row, idx) => {
          const y = normData[idx]?.[col];
          return y != null
            ? { x: row.Date.getTime(), y, original: row[col] }
            : null;
        })
        .filter(Boolean),
    }));

  const macroSeries = buildSeries(macroFiltered, macroNormData);

  const zoomRanges = {
    "AI Boom (2022–2025)": [
      new Date("2022-01-01"),
      new Date("2025-12-31"),
    ],
    "Dot-com Bubble (1995–2002)": [
      new Date("1995-01-01"),
      new Date("2002-12-31"),
    ],
    "Housing Bubble (2003–2009)": [
      new Date("2003-01-01"),
      new Date("2009-12-31"),
    ],
    "Smartphone Era (2007–2015)": [
      new Date("2007-01-01"),
      new Date("2015-12-31"),
    ],
    Reaganomics: [new Date("1981-01-01"), new Date("1989-12-31")],
  };

  const zoomDates = zoomRanges[macroZoom];
  const macroZoomRows =
    !macroZoom || macroZoom === "None" || !zoomDates
      ? []
      : macroRows.filter(
          (r) => r.Date >= zoomDates[0] && r.Date <= zoomDates[1]
        );
  const macroZoomNorm = normalizeMacro(
    macroZoomRows,
    macroSelectedCols,
    macroNormalization,
    macroRows
  );
  const macroZoomSeries = buildSeries(macroZoomRows, macroZoomNorm);

  const toggleCohort = (k) =>
    setCohortToggles((p) => ({ ...p, [k]: !p[k] }));
  const toggleMacroCol = (c) =>
    setMacroSelection((p) => ({ ...p, [c]: !p[c] }));

  const storyContent = {
    "ps-trend": {
      title: "Heat over time",
      body: "Dot-com valuations rocketed on top of single-product web ideas, often with fragile business models. Today's AI excitement sits on cash-generating platforms.",
      bullets: [
        "Dot-com: sharp spike as speculation decouples from fundamentals.",
        "Pure-play AI: averages rise faster than Big Tech AI thanks to narrow revenue bases.",
        "Big Tech AI: steadier climb because diversified platforms buffer hype swings.",
      ],
    },
    peaks: {
      title: "Peak distributions",
      body: "Peak windows show where cohorts cluster. Dot-com names piled up at extreme valuations, pure AI sits above Big Tech, but neither revisit 2000's mania.",
      bullets: [
        "Dot-com: box sits high with long whiskers—classic froth.",
        "Pure-play AI: higher medians than Big Tech but tighter than dot-com peaks.",
        "Big Tech AI: compact box thanks to diversified revenue cushions.",
      ],
    },
    scale: {
      title: "Scale vs. Revenue",
      body: "On the log–log scatter, Big Tech spans huge revenue bases with healthy market-cap alignment. Dot-com and pure AI points overlap across log values.",
      bullets: [
        "Dot-com vs. Pure AI: overlapping clouds show both chase value ahead of revenue.",
        "Big Tech AI: trends up and to the right with fewer outliers.",
        "Spread: pure AI and dot-com clusters sit at lower revenue scales, amplifying volatility.",
      ],
    },
    median: {
      title: "Typical peaks",
      body: "Median P/S at cohort peaks highlights cushion. Big Tech AI stays nearer sustainable bands, while pure AI floats higher—still calmer than dot-com extremes.",
      bullets: [
        "Dot-com: elevated medians underline the bubble's breadth.",
        "Pure-play AI: higher medians hint at optimism priced in before revenue catches up.",
        "Big Tech AI: lower medians signal investors reward proven engines.",
      ],
    },
  };

  return (
    <div className="page">
      <div className="hero">
        <div className="tag">Dot-com vs AI</div>
        <h1>Is the AI bubble real?</h1>
        <p>
          We contrast the late-1990s dot-com spike with today&apos;s AI
          surge. See why diversified giants are structurally safer than
          the narrow bets of the past.
        </p>
        <div className="controls-row">
          <label className="toggle-pill">
            <input
              type="checkbox"
              checked={cohortToggles.dotcom}
              onChange={() => toggleCohort("dotcom")}
            />{" "}
            Dot-com
          </label>
          <label className="toggle-pill">
            <input
              type="checkbox"
              checked={cohortToggles.aiPure}
              onChange={() => toggleCohort("aiPure")}
            />{" "}
            Big Tech AI
          </label>
          <label className="toggle-pill">
            <input
              type="checkbox"
              checked={cohortToggles.aiBroad}
              onChange={() => toggleCohort("aiBroad")}
            />{" "}
            Pure-play AI
          </label>
        </div>
      </div>

      <div className="story-section">
        <div className="section-header">
          <h2>The Data Story</h2>
        </div>

        <div className="story-grid">
          <div className="card story-content">
            <div className="story-tabs">
              {Object.keys(storyContent).map((k) => (
                <button
                  key={k}
                  className={`story-btn ${
                    activeStory === k ? "active" : ""
                  }`}
                  onClick={() => setActiveStory(k)}
                >
                  {storyContent[k].title}
                </button>
              ))}
            </div>
            <div className="info-box">
              <div className="info-headline">
                {storyContent[activeStory].title}
              </div>
              <p className="info-body">
                {storyContent[activeStory].body}
              </p>
              <ul>
                {storyContent[activeStory].bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card chart-card">
            <div className="chart-container">
              {loading && (
                <p
                  style={{
                    textAlign: "center",
                    marginTop: 100,
                    color: "var(--muted)",
                  }}
                >
                  Loading datasets...
                </p>
              )}
              {!loading && activeStory === "ps-trend" && (
                <AvgPsLineChart
                  dotcom={activeDotcom}
                  aiPure={activeAiPure}
                  aiBroad={activeAiBroad}
                />
              )}
              {!loading && activeStory === "peaks" && (
                <PeakBoxplotChart
                  dotLog={dotPeakLog}
                  pureLog={aiPurePeakLog}
                  broadLog={aiBroadPeakLog}
                />
              )}
              {!loading && activeStory === "scale" && (
                <McRevScatterChart
                  dotcom={activeDotcom}
                  aiPure={activeAiPure}
                  aiBroad={activeAiBroad}
                />
              )}
              {!loading && activeStory === "median" && (
                <MedianPsBarChart
                  dotMed={dotMed}
                  pureMed={pureMed}
                  broadMed={broadMed}
                />
              )}
            </div>
            <div className="chart-subtitle">
              {activeStory === "ps-trend" &&
                "Logarithmic scale showing valuation multiples over time. Dot-com bubble clearly visible on the left."}
              {activeStory === "peaks" &&
                "Distribution of Valuation/Revenue ratios at market peaks. Dot-com outliers sit much higher."}
              {activeStory === "scale" &&
                "Comparing Market Cap vs Revenue on a log-log scale. Big Tech aligns with scale; Dot-com scattered."}
              {activeStory === "median" &&
                "Median Price-to-Sales ratio at the height of each era. Big Tech valuations remain grounded."}
              {usingFallback && (
                <span
                  style={{
                    display: "block",
                    color: "#fde047",
                    fontSize: "0.8rem",
                    marginTop: 8,
                  }}
                >
                  Note: Some cohorts are missing or partially loaded. Check
                  file paths and CSV headers if something looks off.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="macro-section">
        <div className="section-header">
          <h2>Macroeconomic Context</h2>
        </div>

        <div className="macro-layout">
          <div className="card macro-controls">
            <h3>Configuration</h3>
            <div className="control-group">
              <div className="field">
                <label>Normalization</label>
                <select
                  value={macroNormalization}
                  onChange={(e) =>
                    setMacroNormalization(e.target.value)
                  }
                >
                  <option>Z-score (standardize)</option>
                  <option>Index to 100</option>
                  <option>None</option>
                </select>
              </div>

              <div className="field">
                <label>Date Range</label>
                <div className="badges">
                  <span>
                    {macroRows[macroRange[0]]?.Date
                      ? formatDateLabel(
                          macroRows[macroRange[0]].Date
                        )
                      : "Start"}
                  </span>
                  <span>
                    {macroRows[macroRange[1]]?.Date
                      ? formatDateLabel(
                          macroRows[macroRange[1]].Date
                        )
                      : "End"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(macroRows.length - 1, 0)}
                  value={macroRange[0]}
                  onChange={(e) =>
                    setMacroRange([
                      Math.min(
                        Number(e.target.value),
                        macroRange[1]
                      ),
                      macroRange[1],
                    ])
                  }
                />
                <input
                  type="range"
                  min={0}
                  max={Math.max(macroRows.length - 1, 0)}
                  value={macroRange[1]}
                  onChange={(e) =>
                    setMacroRange([
                      macroRange[0],
                      Math.max(
                        Number(e.target.value),
                        macroRange[0]
                      ),
                    ])
                  }
                />
              </div>

              <div className="field">
                <label>Indicators</label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {macroColsState.map((c) => (
                    <label
                      key={c}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "0.9rem",
                        color: "#cbd5e1",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!macroSelection[c]}
                        onChange={() => toggleMacroCol(c)}
                        style={{
                          width: 16,
                          height: 16,
                          accentColor: "var(--accent)",
                        }}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Compare Era</label>
                <select
                  value={macroZoom}
                  onChange={(e) => setMacroZoom(e.target.value)}
                >
                  {Object.keys(zoomRanges).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                  <option>None</option>
                </select>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
            }}
          >
            <div className="card chart-card">
              <h3
                style={{
                  margin: "0 0 10px 0",
                  fontSize: "1rem",
                  color: "var(--muted)",
                }}
              >
                Full History
              </h3>
              <div className="chart-container">
                <MacroLineChart
                  series={macroSeries}
                  yTitle={macroNormalization}
                />
              </div>
            </div>

            {macroZoom !== "None" && (
              <div className="card chart-card">
                <h3
                  style={{
                    margin: "0 0 10px 0",
                    fontSize: "1rem",
                    color: "var(--muted)",
                  }}
                >
                  Zoom: {macroZoom}
                </h3>
                <div
                  className="chart-container"
                  style={{ height: 320 }}
                >
                  <MacroLineChart
                    series={macroZoomSeries}
                    yTitle={macroNormalization}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

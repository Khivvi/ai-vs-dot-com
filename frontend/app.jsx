const { useEffect, useRef, useState } = React;

// ============================================================
// 0. Data loading helpers (files live one level above /frontend)
// ============================================================

async function loadCsvAsObjects(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load CSV: ${path}`);
  }
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

async function loadExcelAsObjects(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load Excel: ${path}`);
  }
  const buffer = await res.arrayBuffer();
  const wb = XLSX.read(buffer);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// ============================================================
// 1. JS version of tidy_panel + helpers
// ============================================================

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

function safeLogArray(values) {
  return values.filter((v) => v != null && v > 0).map((v) => Math.log(v));
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

// simple percentile helper for boxplot
function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = (sortedArr.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  const frac = idx - lower;
  return sortedArr[lower] * (1 - frac) + sortedArr[upper] * frac;
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

// median log P/S for given years (for bar chart)
function medianLogPs(records, years) {
  const vals = records
    .filter((r) => years.includes(r.Year))
    .map((r) => r.ValRev)
    .filter((v) => v != null && v > 0);
  if (!vals.length) return null;
  const sorted = vals.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return Math.log(median);
}

// ============================================================
// 1b. Macro data helpers (port of macrodata-frontend.py)
// ============================================================

const MACRO_COLUMNS = [
  "Inflation",
  "Unemployment",
  "Interest Rate",
  "GDP Yearly Growth",
  "NASDAQ Yearly Growth",
];

const MACRO_COLORS = [
  "#f97316",
  "#22c55e",
  "#3b82f6",
  "#eab308",
  "#a855f7",
];

function parseMacroCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];

  const rawHeaders = lines[0].split(",").map((h) => h.trim());
  const headers = rawHeaders.map((h) =>
    h === "NASDAQ Yearly Growith" ? "NASDAQ Yearly Growth" : h
  );

  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      const value = cells[i];
      if (h === "Date") {
        const parsed = new Date(value);
        row.Date = Number.isNaN(parsed.getTime()) ? null : parsed;
      } else {
        const num = Number(value);
        row[h] = Number.isFinite(num) ? num : null;
      }
    });
    return row;
  });

  const valid = rows.filter(
    (r) => r.Date instanceof Date && !Number.isNaN(r.Date.getTime())
  );
  valid.sort((a, b) => a.Date - b.Date);

  // De-duplicate by date (keep the last occurrence, matching the Python version)
  const deduped = new Map();
  valid.forEach((r) => {
    const key = r.Date.toISOString();
    deduped.set(key, r);
  });

  return Array.from(deduped.values());
}

async function loadMacrodata(paths) {
  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseMacroCsv(text);
      if (parsed.length) return parsed;
    } catch (e) {
      console.warn("Macrodata fetch failed for", path, e);
    }
  }
  throw new Error("Unable to load macro dataset from any known path.");
}

function getMacroColumns(rows) {
  if (!rows.length) return [];
  return MACRO_COLUMNS.filter((c) => c in rows[0]);
}

function filterMacroByRange(rows, startIdx, endIdx) {
  return rows.slice(startIdx, endIdx + 1);
}

function filterMacroByDate(rows, startDate, endDate) {
  return rows.filter((r) => r.Date >= startDate && r.Date <= endDate);
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
      const values = ref.map((r) => r[col]).filter((v) => v != null);
      const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
      const variance =
        values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length || 1);
      const std = Math.sqrt(variance);
      stats[col] = { mean, std };
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
    day: "numeric",
  }).format(date);
}

// ============================================================
// 2. Generic Chart hook
// ============================================================

function useChart(canvasRef, configFactory, deps) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext("2d");
    const config = configFactory(ctx);
    chartRef.current = new Chart(ctx, config);

    return () => chartRef.current && chartRef.current.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ============================================================
// 3. Individual chart components
// ============================================================

// 3.1 Line: log average P/S by era
function AvgPsLineChart({ dotcom, aiPure, aiNiche }) {
  const canvasRef = useRef(null);

  const dot = groupAvgLogPsByYear(dotcom);
  const pure = groupAvgLogPsByYear(aiPure);
  const niche = groupAvgLogPsByYear(aiNiche);

  const allYears = Array.from(
    new Set([...dot.years, ...pure.years, ...niche.years])
  ).sort((a, b) => a - b);

  const align = (series) => {
    const map = new Map(series.years.map((y, i) => [y, series.logVals[i]]));
    return allYears.map((y) => (map.has(y) ? map.get(y) : null));
  };

  const dotData = align(dot);
  const pureData = align(pure);
  const nicheData = align(niche);

  useChart(
    canvasRef,
    () => ({
      type: "line",
      data: {
        labels: allYears,
        datasets: [
          {
            label: "Dot-com (avg log P/S)",
            data: dotData,
            borderColor: "#f97316",
            backgroundColor: "rgba(249,115,22,0.2)",
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 3,
            spanGaps: true,
          },
          {
            label: "Big Tech AI (avg log P/S)",
            data: pureData,
            borderColor: "#22c55e",
            backgroundColor: "rgba(34,197,94,0.2)",
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 3,
            spanGaps: true,
          },
          {
            label: "Pure-play AI (avg log P/S)",
            data: nicheData,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.2)",
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 3,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#e5e7eb", usePointStyle: true },
          },
          tooltip: {
            backgroundColor: "#020617",
            borderColor: "#1f2937",
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const logVal = ctx.raw;
                if (logVal == null) return `${ctx.dataset.label}: n/a`;
                const ps = Math.exp(logVal);
                return `${ctx.dataset.label}: log(P/S)=${logVal.toFixed(
                  2
                )},  P/S≈${ps.toFixed(1)}×`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Year", color: "#cbd5e1" },
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(148,163,184,0.15)" },
          },
          y: {
            title: {
              display: true,
              text: "log(Valuation / Revenue)",
              color: "#cbd5e1",
            },
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(148,163,184,0.15)" },
          },
        },
      },
    }),
    [
      JSON.stringify(allYears),
      JSON.stringify(dotData),
      JSON.stringify(pureData),
      JSON.stringify(nicheData),
    ]
  );

  return <canvas ref={canvasRef} height="340" />;
}

// 3.2 Custom boxplot (drawn on top of a dummy bar chart)
function PeakBoxplotChart({ dotLog, pureLog, nicheLog }) {
  const canvasRef = useRef(null);

  const labels = ["Dot-com peak", "Big Tech AI peak", "Pure AI peak"];
  const stats = [
    computeBoxStats(dotLog),
    computeBoxStats(pureLog),
    computeBoxStats(nicheLog),
  ];

  useChart(
    canvasRef,
    (ctx) => {
      const data = {
        labels,
        datasets: [
          {
            // invisible bars – we draw boxplots with a plugin
            label: "P/S distribution (log)",
            data: stats.map((s) => s.median ?? null),
            backgroundColor: "rgba(15,23,42,0.0)",
            borderWidth: 0,
          },
        ],
      };

      const boxplotPlugin = {
        id: "customBoxplot",
        afterDatasetsDraw(chart) {
          const { ctx, chartArea } = chart;
          ctx.save();
          ctx.strokeStyle = "#cbd5e1";
          ctx.fillStyle = "rgba(148,163,184,0.2)";
          ctx.lineWidth = 2;

          chart.getDatasetMeta(0).data.forEach((bar, idx) => {
            const stat = stats[idx];
            if (!stat || stat.median == null) return;

            const x = bar.x;
            const yScale = chart.scales.y;

            const yMin = yScale.getPixelForValue(stat.min);
            const yQ1 = yScale.getPixelForValue(stat.q1);
            const yMed = yScale.getPixelForValue(stat.median);
            const yQ3 = yScale.getPixelForValue(stat.q3);
            const yMax = yScale.getPixelForValue(stat.max);

            const boxWidth = 40;

            // whiskers
            ctx.beginPath();
            ctx.moveTo(x, yMin);
            ctx.lineTo(x, yQ1);
            ctx.moveTo(x, yQ3);
            ctx.lineTo(x, yMax);
            ctx.stroke();

            // whisker caps
            ctx.beginPath();
            ctx.moveTo(x - boxWidth / 4, yMin);
            ctx.lineTo(x + boxWidth / 4, yMin);
            ctx.moveTo(x - boxWidth / 4, yMax);
            ctx.lineTo(x + boxWidth / 4, yMax);
            ctx.stroke();

            // box
            ctx.beginPath();
            ctx.rect(x - boxWidth / 2, yQ3, boxWidth, yQ1 - yQ3);
            ctx.fill();
            ctx.stroke();

            // median line
            ctx.beginPath();
            ctx.moveTo(x - boxWidth / 2, yMed);
            ctx.lineTo(x + boxWidth / 2, yMed);
            ctx.stroke();
          });

          ctx.restore();
        },
      };

      return {
        type: "bar",
        data,
        plugins: [boxplotPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#020617",
              borderColor: "#1f2937",
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const stat = stats[ctx.dataIndex];
                  if (!stat || stat.median == null) return "No data";
                  const toText = (v) =>
                    `log=${v.toFixed(2)},  P/S≈${Math.exp(v).toFixed(1)}×`;
                  return [
                    `min:   ${toText(stat.min)}`,
                    `Q1:    ${toText(stat.q1)}`,
                    `median:${toText(stat.median)}`,
                    `Q3:    ${toText(stat.q3)}`,
                    `max:   ${toText(stat.max)}`,
                  ];
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: "#cbd5e1" },
              grid: { display: false },
            },
            y: {
              title: {
                display: true,
                text: "log(Valuation / Revenue)",
                color: "#cbd5e1",
              },
              ticks: { color: "#cbd5e1" },
              grid: { color: "rgba(148,163,184,0.15)" },
            },
          },
        },
      };
    },
    [JSON.stringify(stats)]
  );

  return <canvas ref={canvasRef} height="340" />;
}

// 3.3 Scatter: log–log Market Cap vs Revenue
function McRevScatterChart({ dotcom, aiPure, aiNiche }) {
  const canvasRef = useRef(null);

  const makePoints = (records) =>
    records
      .filter((r) => r.MarketCap > 0 && r.Revenue > 0)
      .map((r) => ({
        x: Math.log(r.Revenue),
        y: Math.log(r.MarketCap),
      }));

  const dotPts = makePoints(dotcom);
  const purePts = makePoints(aiPure);
  const nichePts = makePoints(aiNiche);

  useChart(
    canvasRef,
    () => ({
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Dot-com (log-log)",
            data: dotPts,
            backgroundColor: "rgba(249,115,22,0.6)",
            pointRadius: 3,
            pointStyle: "cross",
          },
          {
            label: "Big Tech AI (log-log)",
            data: purePts,
            backgroundColor: "rgba(34,197,94,0.6)",
            pointRadius: 3,
            pointStyle: "circle",
          },
          {
            label: "Pure-play AI (log-log)",
            data: nichePts,
            backgroundColor: "rgba(59,130,246,0.6)",
            pointRadius: 3,
            pointStyle: "triangle",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { color: "#e5e7eb" } },
          tooltip: {
            backgroundColor: "#020617",
            borderColor: "#1f2937",
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: log(Rev)=${ctx.raw.x.toFixed(
                  2
                )}, log(MktCap)=${ctx.raw.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "log(Revenue)", color: "#cbd5e1" },
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(148,163,184,0.15)" },
          },
          y: {
            title: { display: true, text: "log(Market Cap)", color: "#cbd5e1" },
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(148,163,184,0.15)" },
          },
        },
      },
    }),
    [JSON.stringify(dotPts), JSON.stringify(purePts), JSON.stringify(nichePts)]
  );

  return <canvas ref={canvasRef} height="340" />;
}

// 3.4 Bar: log median P/S by era at peaks
function MedianPsBarChart({ dotMed, pureMed, nicheMed }) {
  const canvasRef = useRef(null);

  const labels = ["Dot-com peak", "Big Tech AI peak", "Pure AI peak"];
  const values = [dotMed, pureMed, nicheMed];

  useChart(
    canvasRef,
    () => ({
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Median log(P/S) at peaks",
            data: values,
            backgroundColor: [
              "rgba(249,115,22,0.8)",
              "rgba(34,197,94,0.8)",
              "rgba(59,130,246,0.8)",
            ],
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#020617",
            borderColor: "#1f2937",
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const logVal = ctx.raw;
                if (logVal == null) return "n/a";
                const ps = Math.exp(logVal);
                return `log(P/S)=${logVal.toFixed(2)},  P/S≈${ps.toFixed(1)}×`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#cbd5e1" },
            grid: { display: false },
          },
          y: {
            title: {
              display: true,
              text: "log(Median Valuation / Revenue)",
              color: "#cbd5e1",
            },
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(148,163,184,0.15)" },
          },
        },
      },
    }),
    [JSON.stringify(values)]
  );

  return <canvas ref={canvasRef} height="320" />;
}

// 3.5 Macro time-series chart (main + zoom)
function MacroLineChart({ series, yTitle, height = 420 }) {
  const canvasRef = useRef(null);

  useChart(
    canvasRef,
    () => ({
      type: "line",
      data: {
        datasets: series.map((s, idx) => ({
          label: s.label,
          data: s.data,
          parsing: false,
          spanGaps: true,
          tension: 0.25,
          borderWidth: 3,
          pointRadius: 0,
          borderColor: s.color || MACRO_COLORS[idx % MACRO_COLORS.length],
          backgroundColor: (s.color || MACRO_COLORS[idx % MACRO_COLORS.length]) + "55",
        })),
      },
      plugins: [
        {
          id: "macroHoverLine",
          afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const active = chart.tooltip?.getActiveElements?.();
            if (!active || !active.length) return;
            const x = active[0].element.x;
            ctx.save();
            ctx.strokeStyle = "rgba(148,163,184,0.45)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, chart.scales.y.top);
            ctx.lineTo(x, chart.scales.y.bottom);
            ctx.stroke();
            ctx.restore();
          },
        },
      ],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { color: "#e5e7eb" } },
          tooltip: {
            backgroundColor: "#020617",
            borderColor: "#1f2937",
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: (items) =>
                items?.length ? formatDateLabel(new Date(items[0].raw.x)) : "",
              label: (ctx) => {
                const val = ctx.raw.y;
                const original = ctx.raw.original;
                const normText = val == null ? "n/a" : val.toFixed(2);
                const origText =
                  original == null ? "n/a" : original.toLocaleString(undefined, { maximumFractionDigits: 2 });
                return `${ctx.dataset.label}: ${normText} (actual ${origText})`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            ticks: {
              color: "#cbd5e1",
              callback: (value) => formatDateLabel(new Date(value)),
              maxTicksLimit: 8,
            },
            grid: { color: "rgba(148,163,184,0.12)" },
          },
          y: {
            title: { display: true, text: yTitle, color: "#cbd5e1" },
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(148,163,184,0.15)" },
          },
        },
      },
    }),
    [JSON.stringify(series), yTitle]
  );

  return <canvas ref={canvasRef} height={height} />;
}

// ============================================================
// 4. Main App – only the four charts from Python
// ============================================================

function App() {
  const [dotcom, setDotcom] = useState([]);
  const [aiBroad, setAiBroad] = useState([]); // Pure-play AI (PureAI.xlsx)
  const [aiPure, setAiPure] = useState([]);   // Big Tech AI (HighTech.xlsx)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usedFallback, setUsedFallback] = useState(false);
  const [cohortToggles, setCohortToggles] = useState({
    dotcom: true,
    aiPure: true,
    aiBroad: true,
  });
  const [macroRows, setMacroRows] = useState([]);
  const [macroColumns, setMacroColumns] = useState([]);
  const [macroSelection, setMacroSelection] = useState({});
  const [macroRange, setMacroRange] = useState([0, 0]);
  const [macroNormalization, setMacroNormalization] = useState(
    "Z-score (standardize)"
  );
  const [macroZoom, setMacroZoom] = useState("AI Boom (2022–2025)");
  const [macroLoading, setMacroLoading] = useState(true);
  const [macroError, setMacroError] = useState("");

  useEffect(() => {
    async function loadAll() {
      let dotRows = [];
      let pureRows = [];
      let highTechRows = [];

      try {
        setLoading(true);
        setError("");
        setUsedFallback(false);

        // Data files live alongside index.html in /frontend for easy hosting
        dotRows = await loadCsvAsObjects("./Dotcom.csv");
        pureRows = await loadExcelAsObjects("./PureAI.xlsx");
        highTechRows = await loadExcelAsObjects("./HighTech.xlsx");
      } catch (e) {
        console.error(e);
        setError(
          (e && e.message ? `${e.message}. ` : "") +
            "Falling back to the embedded copies of the datasets."
        );
      }

      let dotTidy = [];
      let pureTidy = [];
      let highTechTidy = [];

      try {
        if (dotRows.length) {
          dotTidy = tidyPanelJS(dotRows, [1996, 1997, 1998, 1999, 2000]);
        }
        if (pureRows.length) {
          pureTidy = tidyPanelJS(pureRows, [2020, 2021, 2022, 2023, 2024, 2025]);
        }
        if (highTechRows.length) {
          highTechTidy = tidyPanelJS(highTechRows, [2020, 2021, 2022, 2023, 2024, 2025]);
        }
      } catch (parseErr) {
        console.error(parseErr);
        setError(
          "Ran into an issue parsing the uploaded spreadsheets; showing the embedded data instead."
        );
      }

      if (
        (!dotTidy.length || !pureTidy.length || !highTechTidy.length) &&
        window.EMBEDDED_TIDY
      ) {
        dotTidy = window.EMBEDDED_TIDY.dotcom || [];
        pureTidy = window.EMBEDDED_TIDY.pureAi || [];
        highTechTidy = window.EMBEDDED_TIDY.highTech || [];
        setUsedFallback(true);
      }

      setDotcom(dotTidy);
      setAiBroad(pureTidy);
      setAiPure(highTechTidy);
      setLoading(false);
    }

    loadAll();
  }, []);

  useEffect(() => {
    async function loadMacro() {
      try {
        setMacroLoading(true);
        setMacroError("");
        // The macro CSV lives in /data/combined-macrodata.csv at the repo root.
        // Try both relative and absolute paths so it works whether the site is
        // hosted from /frontend or from the repo root.
        const paths = [
          "../data/combined-macrodata.csv",
          "./data/combined-macrodata.csv",
          "data/combined-macrodata.csv",
          "/data/combined-macrodata.csv",
        ];
        const rows = await loadMacrodata(paths);
        const cols = getMacroColumns(rows);
        const selection = cols.reduce((acc, c) => ({ ...acc, [c]: true }), {});
        setMacroRows(rows);
        setMacroColumns(cols);
        setMacroSelection(selection);
        setMacroRange([0, Math.max(rows.length - 1, 0)]);
      } catch (e) {
        console.error(e);
        setMacroError(
          (e && e.message ? e.message : "") +
            " Unable to load macro dataset from the data directory (data/combined-macrodata.csv)."
        );
      } finally {
        setMacroLoading(false);
      }
    }

    loadMacro();
  }, []);

  useEffect(() => {
    if (!macroRows.length) return;
    setMacroRange(([start, end]) => {
      const maxIdx = macroRows.length - 1;
      const safeStart = Math.max(0, Math.min(start, maxIdx));
      const safeEnd = Math.max(safeStart, Math.min(end, maxIdx));
      return [safeStart, safeEnd];
    });
  }, [macroRows.length]);

  const ready = !loading && (dotcom.length || aiBroad.length || aiPure.length);

  const macroSelected = macroColumns.filter((c) => macroSelection[c]);
  const macroFiltered =
    macroRows.length && macroRange[1] >= macroRange[0]
      ? filterMacroByRange(macroRows, macroRange[0], macroRange[1])
      : [];
  const macroReference =
    macroNormalization.startsWith("Z-score") && macroRows.length
      ? macroRows
      : macroFiltered;

  const macroNormalized = normalizeMacro(
    macroFiltered,
    macroSelected,
    macroNormalization,
    macroReference
  );

  const macroYTitle =
    macroNormalization === "Index to 100"
      ? "Index (Base = 100)"
      : macroNormalization === "Z-score (standardize)"
        ? "Z-score"
        : "Value (original units)";

  const activeDotcom = cohortToggles.dotcom ? dotcom : [];
  const activeAiPure = cohortToggles.aiPure ? aiPure : [];
  const activeAiBroad = cohortToggles.aiBroad ? aiBroad : [];

  // Peak windows
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

  const updateToggle = (key) => {
    setCohortToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleRangeChange = (idx, value) => {
    const maxIdx = Math.max(macroRows.length - 1, 0);
    const clamped = Math.min(Math.max(0, value), maxIdx);
    setMacroRange(([start, end]) => {
      if (idx === 0) {
        const nextStart = Math.min(clamped, end);
        return [nextStart, Math.max(nextStart, end)];
      }
      const nextEnd = Math.max(clamped, start);
      return [Math.min(start, nextEnd), nextEnd];
    });
  };

  const toggleMacroColumn = (col) => {
    setMacroSelection((prev) => ({ ...prev, [col]: !prev[col] }));
  };

  const buildMacroSeries = (rows, normalizedRows) =>
    macroSelected.map((col, idx) => ({
      label: col,
      color: MACRO_COLORS[idx % MACRO_COLORS.length],
      data: rows
        .map((row, i) => {
          const norm = normalizedRows[i]?.[col];
          if (norm == null) return null;
          return { x: row.Date.getTime(), y: norm, original: row[col] };
        })
        .filter(Boolean),
    }));

  let macroSeries = buildMacroSeries(macroFiltered, macroNormalized);
  let macroChartYTitle = macroYTitle;

  if (
    !macroSeries.some((s) => s.data.length) &&
    macroFiltered.length &&
    macroSelected.length
  ) {
    const fallbackNorm = normalizeMacro(
      macroFiltered,
      macroSelected,
      "None",
      macroFiltered
    );
    macroSeries = buildMacroSeries(macroFiltered, fallbackNorm);
    macroChartYTitle = "Value (original units)";
  }

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
    "Reaganomics (1981–1989)": [
      new Date("1981-01-01"),
      new Date("1989-12-31"),
    ],
  };

  const zoomDates = zoomRanges[macroZoom];
  const macroZoomRows =
    macroZoom === "None" || !zoomDates
      ? []
      : filterMacroByDate(macroRows, zoomDates[0], zoomDates[1]);
  const macroZoomNorm = normalizeMacro(
    macroZoomRows,
    macroSelected,
    macroNormalization,
    macroReference
  );

  let macroZoomSeries = buildMacroSeries(macroZoomRows, macroZoomNorm);
  let macroZoomYTitle = macroYTitle;

  if (
    macroZoomRows.length &&
    macroSelected.length &&
    !macroZoomSeries.some((s) => s.data.length)
  ) {
    const fallbackNorm = normalizeMacro(
      macroZoomRows,
      macroSelected,
      "None",
      macroZoomRows
    );
    macroZoomSeries = buildMacroSeries(macroZoomRows, fallbackNorm);
    macroZoomYTitle = "Value (original units)";
  }

  const macroStartLabel =
    macroRows[macroRange[0]] && macroRows[macroRange[0]].Date
      ? formatDateLabel(macroRows[macroRange[0]].Date)
      : "—";
  const macroEndLabel =
    macroRows[macroRange[1]] && macroRows[macroRange[1]].Date
      ? formatDateLabel(macroRows[macroRange[1]].Date)
      : "—";

  return (
    <div className="page">
      <div className="hero">
        <div>
          <div className="tag">Dot-com vs AI · Valuation / Revenue</div>
          <h1>Compare real P/S multiples across bubbles</h1>
          <p>
            These charts are generated directly from the CSV and Excel files in
            this repo using the same transformation logic as the Python script.
            The valuation cards mirror the original Matplotlib figures, and the
            macro section ports the Streamlit macrodata dashboard (date ranges,
            normalization, and zoom presets) into the React front end.
          </p>
          {loading && (
            <p
              style={{
                marginTop: 8,
                color: "var(--muted)",
                fontSize: "0.9rem",
              }}
            >
              Loading datasets&hellip;
            </p>
          )}
          {error && (
            <p
              style={{
                marginTop: 8,
                color: "#fecaca",
                fontSize: "0.9rem",
              }}
            >
              {error}
            </p>
          )}
          {usedFallback && (
            <p
              style={{
                marginTop: 8,
                color: "#fde68a",
                fontSize: "0.9rem",
              }}
            >
              Showing the bundled copy of the datasets so the charts stay visible
              even if your browser blocks local fetches.
            </p>
          )}
          <div className="controls">
            <label className="toggle-pill">
              <input
                type="checkbox"
                checked={cohortToggles.dotcom}
                onChange={() => updateToggle("dotcom")}
              />
              Dot-com cohort
            </label>
            <label className="toggle-pill">
              <input
                type="checkbox"
                checked={cohortToggles.aiPure}
                onChange={() => updateToggle("aiPure")}
              />
              Big Tech AI cohort
            </label>
            <label className="toggle-pill">
              <input
                type="checkbox"
                checked={cohortToggles.aiBroad}
                onChange={() => updateToggle("aiBroad")}
              />
              Pure-play AI cohort
            </label>
          </div>
        </div>
      </div>

      <div className="macro-section">
        <div className="tag">Macroeconomic trends</div>
        <h2 style={{ marginBottom: 6 }}>Inflation, unemployment, rates, GDP, NASDAQ</h2>
        <p className="chart-subtitle" style={{ maxWidth: 820, marginTop: 0 }}>
          Mirrors the macrodata Streamlit app: choose a date window, normalization
          method (Z-score or index to 100), toggle series, and optionally zoom into
          a predefined era for a second chart.
        </p>
        {macroLoading && (
          <p style={{ color: "var(--muted)", marginTop: 8 }}>
            Loading macro dataset&hellip;
          </p>
        )}
        {macroError && (
          <p style={{ color: "#fecaca", marginTop: 8 }}>{macroError}</p>
        )}
        <div className="macro-layout">
          <div className="card macro-controls">
            <h3 style={{ marginTop: 0 }}>Controls</h3>
            <div className="control-group">
              <div className="field">
                <label>Date range</label>
                <div className="range-row">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(macroRows.length - 1, 0)}
                    value={macroRange[0]}
                    onChange={(e) => handleRangeChange(0, Number(e.target.value))}
                    disabled={!macroRows.length}
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(macroRows.length - 1, 0)}
                    value={macroRange[1]}
                    onChange={(e) => handleRangeChange(1, Number(e.target.value))}
                    disabled={!macroRows.length}
                  />
                </div>
                <div className="badges" style={{ marginTop: 6 }}>
                  <span className="badge">Start: {macroStartLabel}</span>
                  <span className="badge">End: {macroEndLabel}</span>
                </div>
              </div>

              <div className="field">
                <label>Normalization</label>
                <select
                  value={macroNormalization}
                  onChange={(e) => setMacroNormalization(e.target.value)}
                  disabled={!macroRows.length}
                >
                  <option>Z-score (standardize)</option>
                  <option>Index to 100</option>
                  <option>None</option>
                </select>
              </div>

              <div className="field">
                <label>Zoom period (second chart)</label>
                <select
                  value={macroZoom}
                  onChange={(e) => setMacroZoom(e.target.value)}
                  disabled={!macroRows.length}
                >
                  <option>AI Boom (2022–2025)</option>
                  <option>Dot-com Bubble (1995–2002)</option>
                  <option>Housing Bubble (2003–2009)</option>
                  <option>Smartphone Era (2007–2015)</option>
                  <option>Reaganomics (1981–1989)</option>
                  <option>None</option>
                </select>
              </div>

              <div className="field">
                <label>Series</label>
                <div className="controls">
                  {macroColumns.map((col) => (
                    <label key={col} className="toggle-pill">
                      <input
                        type="checkbox"
                        checked={!!macroSelection[col]}
                        onChange={() => toggleMacroColumn(col)}
                      />
                      {col}
                    </label>
                  ))}
                  {!macroColumns.length && (
                    <span style={{ color: "var(--muted)" }}>
                      Waiting for macro columns&hellip;
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="card chart-card macro-chart-card">
            <h3 style={{ marginTop: 0 }}>Macroeconomic trends (full range)</h3>
            <p className="chart-subtitle">
              Hover to see actual values; y-axis follows the selected normalization.
            </p>
            {macroSelected.length && macroSeries.some((s) => s.data.length) ? (
              <MacroLineChart series={macroSeries} yTitle={macroChartYTitle} />
            ) : (
              <p style={{ color: "var(--muted)", marginTop: 12 }}>
                Choose at least one macro series and make sure the date range
                contains data.
              </p>
            )}
          </div>

          {macroZoom !== "None" && (
            <div className="card chart-card macro-chart-card full-span">
              <h3 style={{ marginTop: 0 }}>Zoomed view: {macroZoom}</h3>
              <p className="chart-subtitle">
                Uses the same normalization as the main chart, scoped to the
                selected historical window.
              </p>
              {macroSelected.length && macroZoomSeries.some((s) => s.data.length) ? (
                <MacroLineChart
                  series={macroZoomSeries}
                  yTitle={macroZoomYTitle}
                  height={360}
                />
              ) : (
                <p style={{ color: "var(--muted)", marginTop: 12 }}>
                  No zoom data available for the chosen period/series.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {ready ? (
        <>
          <div className="layout">
            <div className="card chart-card">
              <h3 style={{ marginTop: 0 }}>1. Average log P/S over time</h3>
              <p className="chart-subtitle">
                Mean valuation / revenue (P/S) for each cohort, transformed with
                a natural log to make extreme ratios comparable.
              </p>
              <AvgPsLineChart
                dotcom={activeDotcom}
                aiPure={activeAiPure}
                aiNiche={activeAiBroad}
              />
            </div>

            <div className="card chart-card">
              <h3 style={{ marginTop: 0 }}>
                2. P/S distribution at bubble peaks
              </h3>
              <p className="chart-subtitle">
                Boxplot-style view of log(P/S) at each cohort&apos;s bubble
                window (Dot-com 1999–2000, AI 2023–2025).
              </p>
              <PeakBoxplotChart
                dotLog={dotPeakLog}
                pureLog={aiPurePeakLog}
                nicheLog={aiBroadPeakLog}
              />
            </div>

            <div className="card chart-card">
              <h3 style={{ marginTop: 0 }}>
                3. Log–log Market Cap vs Revenue by era
              </h3>
              <p className="chart-subtitle">
                Each point is a company-year. Both axes are log-transformed to
                show how valuations scaled relative to revenue in each regime.
              </p>
              <McRevScatterChart
                dotcom={activeDotcom}
                aiPure={activeAiPure}
                aiNiche={activeAiBroad}
              />
            </div>

            <div className="card chart-card">
              <h3 style={{ marginTop: 0 }}>
                4. Median log P/S at bubble peaks
              </h3>
              <p className="chart-subtitle">
                Direct comparison of typical (median) valuation / revenue
                multiples at the peak periods of each cohort.
              </p>
              <MedianPsBarChart
                dotMed={dotMed}
                pureMed={pureMed}
                nicheMed={broadMed}
              />
            </div>
          </div>
        </>
      ) : (
        !loading && (
          <p style={{ color: "var(--muted)", marginTop: 32 }}>
            Waiting for data. Check that <code>Dotcom.csv</code>,{" "}
            <code>PureAI.xlsx</code> and <code>HighTech.xlsx</code> sit next to
            <code>frontend/index.html</code> when you host the page.
          </p>
        )
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

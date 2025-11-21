const { useEffect, useMemo, useRef, useState } = React;

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------

const palette = [
  "#7c3aed",
  "#22d3ee",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#60a5fa",
  "#c084fc",
];

function movingAverage(values, window) {
  if (window <= 1) return values;
  return values.map((val, idx, arr) => {
    if (val == null) return null;
    const start = Math.max(0, idx - Math.floor(window / 2));
    const end = Math.min(arr.length, idx + Math.ceil(window / 2));
    const slice = arr.slice(start, end).filter((v) => v != null);
    if (!slice.length) return null;
    const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
    return Number(avg.toFixed(4));
  });
}

// Used for the CSV upload in the controls
function parseCsv(text) {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());
  const yearIndex = headers.findIndex((h) => h.includes("year"));
  const valueIndex = headers.findIndex(
    (h) => h.includes("value") || h.includes("index")
  );
  if (yearIndex === -1 || valueIndex === -1) return [];

  return rows
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .map((cells) => ({
      year: Number(cells[yearIndex]),
      value: Number(cells[valueIndex]),
    }))
    .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.value));
}

// ------ Load root-level CSV (dot-com) --------------------------------
async function loadCsvAsObjects(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load CSV: ${path}`);
  }
  const text = await response.text();
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

// ------ Load root-level Excel (AI cohorts) ---------------------------
async function loadExcelAsObjects(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load Excel: ${path}`);
  }
  const buffer = await response.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// ------ JS version of tidy_panel from Python -------------------------
function tidyPanelJS(rows, years) {
  const records = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    const company = row["Company"];
    if (!company) {
      i += 1;
      continue;
    }

    const block = rows.slice(i, i + 3); // Market Cap, Revenue, ValRev
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

// Average log(P/S) by year
function computeAvgLogPsByYear(records) {
  const byYear = new Map();
  records.forEach((r) => {
    if (r.ValRev && r.ValRev > 0) {
      if (!byYear.has(r.Year)) byYear.set(r.Year, []);
      byYear.get(r.Year).push(r.ValRev);
    }
  });

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const values = years.map((y) => {
    const arr = byYear.get(y);
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.log(avg);
  });

  return { years, values };
}

// ----------------------------------------------------
// Chart component
// ----------------------------------------------------
function TrendChart({ labels, datasets, chartType }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: chartType,
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: "index",
        },
        plugins: {
          legend: {
            labels: {
              color: "#e5e7eb",
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: "#0b1222",
            borderColor: "#1f2937",
            borderWidth: 1,
            titleColor: "#fff",
            bodyColor: "#cbd5e1",
            padding: 12,
            callbacks: {
              label: (ctx) => {
                const val = ctx.raw;
                if (val == null) return `${ctx.dataset.label}: n/a`;
                const ps = Math.exp(val); // convert back to P/S multiple
                return `${ctx.dataset.label}: log(P/S)=${val.toFixed(
                  2
                )}, P/S≈${ps.toFixed(1)}x`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
          y: {
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(255,255,255,0.06)" },
            title: {
              display: true,
              text: "log(Valuation / Revenue)",
              color: "#cbd5e1",
            },
          },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [labels, datasets, chartType]);

  return <canvas ref={canvasRef} height="420" />;
}

// ----------------------------------------------------
// Controls
// ----------------------------------------------------
function DataControls({
  chartType,
  setChartType,
  smooth,
  setSmooth,
  range,
  setRange,
  customGrowth,
  setCustomGrowth,
  onReset,
  onUpload,
}) {
  return (
    <div className="panel">
      <h3>Controls</h3>
      <div className="control-group">
        <div className="field">
          <label>Chart style</label>
          <select value={chartType} onChange={(e) => setChartType(e.target.value)}>
            <option value="line">Smooth line</option>
            <option value="bar">Stacked bars</option>
          </select>
        </div>

        <div className="field">
          <label>Smoothing window ({smooth} points)</label>
          <input
            type="range"
            min="1"
            max="5"
            value={smooth}
            onChange={(e) => setSmooth(Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label>Year focus</label>
          <div className="small-row">
            <div className="field">
              <span className="badge">From {range[0]}</span>
              <input
                type="range"
                min="1996"
                max="2025"
                value={range[0]}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setRange([Math.min(next, range[1]), range[1]]);
                }}
              />
            </div>
            <div className="field">
              <span className="badge">To {range[1]}</span>
              <input
                type="range"
                min="1996"
                max="2025"
                value={range[1]}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setRange([range[0], Math.max(next, range[0])]);
                }}
              />
            </div>
          </div>
        </div>

        <fieldset
          style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}
        >
          <legend>Scenario builder</legend>
          <div className="field">
            <label>Hypothetical Big Tech AI CAGR ({customGrowth}%)</label>
            <input
              type="range"
              min="5"
              max="40"
              value={customGrowth}
              onChange={(e) => setCustomGrowth(Number(e.target.value))}
            />
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Applies to Big Tech AI median P/S from 2025 out to 2032, plotted in log space.
            </p>
          </div>
        </fieldset>

        <div className="field">
          <label>Upload CSV (Year, Value)</label>
          <div className="upload-area">
            <input
              className="file-input"
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                  const text = event.target?.result;
                  if (typeof text === "string") {
                    const parsed = parseCsv(text);
                    onUpload(parsed, file.name.replace(/\.csv$/i, ""));
                  }
                };
                reader.readAsText(file);
              }}
            />
            <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
              Overlay your own time series. Only two columns are needed: year and value/index.
            </p>
          </div>
        </div>

        <button className="button-secondary" onClick={onReset}>
          Reset selections
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Meta stats and table work off log(P/S) series
// ----------------------------------------------------
function MetaStats({ series, filteredIndices }) {
  if (!series || !filteredIndices.length) return null;

  const firstIdx = filteredIndices[0].idx;
  const lastIdx = filteredIndices[filteredIndices.length - 1].idx;

  const startAiLog = series.bigTech[firstIdx];
  const endAiLog = series.bigTech[lastIdx];
  const startDcLog = series.dotcom[firstIdx];
  const endDcLog = series.dotcom[lastIdx];

  if (
    startAiLog == null ||
    endAiLog == null ||
    startDcLog == null ||
    endDcLog == null
  ) {
    return null;
  }

  const startAi = Math.exp(startAiLog);
  const endAi = Math.exp(endAiLog);
  const startDc = Math.exp(startDcLog);
  const endDc = Math.exp(endDcLog);

  const periods = Math.max(1, filteredIndices.length - 1);
  const aiCagr = ((endAi / startAi) ** (1 / periods) - 1) * 100;
  const dcCagr = ((endDc / startDc) ** (1 / periods) - 1) * 100;

  return (
    <div className="meta">
      <div className="stat">
        <span className="stat-label">Big Tech AI P/S change</span>
        <span className="stat-value">{(endAi - startAi).toFixed(1)}×</span>
        <span className="pill pill-good">Run-up</span>
      </div>
      <div className="stat">
        <span className="stat-label">Dot-com P/S change</span>
        <span className="stat-value">{(endDc - startDc).toFixed(1)}×</span>
        <span className="pill pill-warn">Bubble hangover</span>
      </div>
      <div className="stat">
        <span className="stat-label">Big Tech AI P/S CAGR</span>
        <span className="stat-value">{aiCagr.toFixed(1)}%</span>
        <span className="pill pill-good">Momentum</span>
      </div>
      <div className="stat">
        <span className="stat-label">Dot-com P/S CAGR</span>
        <span className="stat-value">{dcCagr.toFixed(1)}%</span>
        <span className="pill pill-neutral">Historical</span>
      </div>
    </div>
  );
}

function DataTable({ rows }) {
  return (
    <div className="table card">
      <h3>Average P/S snapshot (by year)</h3>
      <table>
        <thead>
          <tr>
            <th>Year</th>
            <th>Dot-com P/S (avg)</th>
            <th>Big Tech AI P/S (avg)</th>
            <th>Pure-play AI P/S (avg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <td>{row.year}</td>
              <td>{row.dotcom ?? "–"}</td>
              <td>{row.bigTech ?? "–"}</td>
              <td>{row.pureAI ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------
// Main App
// ----------------------------------------------------
function App() {
  const [chartType, setChartType] = useState("line");
  const [smooth, setSmooth] = useState(2);
  const [range, setRange] = useState([1996, 2025]);
  const [customGrowth, setCustomGrowth] = useState(18);
  const [uploads, setUploads] = useState([]);
  const [dotcom, setDotcom] = useState([]);
  const [aiPure, setAiPure] = useState([]); // Big Tech AI (spreadsheet (4))
  const [aiNiche, setAiNiche] = useState([]); // Pure-play AI (spreadsheet (3))
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load real files from the repo root
  useEffect(() => {
    async function loadAll() {
      try {
        setLoading(true);
        setError("");

        const dotRows = await loadCsvAsObjects(
          "../Company-Metric-1996-1997-1998-1999-2000.csv"
        );
        const nicheRows = await loadExcelAsObjects("../spreadsheet (3).xlsx");
        const pureRows = await loadExcelAsObjects("../spreadsheet (4).xlsx");

        setDotcom(tidyPanelJS(dotRows, [1996, 1997, 1998, 1999, 2000]));
        setAiNiche(tidyPanelJS(nicheRows, [2020, 2021, 2022, 2023, 2024, 2025]));
        setAiPure(tidyPanelJS(pureRows, [2020, 2021, 2022, 2023, 2024, 2025]));
      } catch (e) {
        console.error(e);
        setError(e.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, []);

  // Build average log(P/S) series per era and align by year
  const series = useMemo(() => {
    if (!dotcom.length && !aiPure.length && !aiNiche.length) return null;

    const dot = computeAvgLogPsByYear(dotcom);
    const big = computeAvgLogPsByYear(aiPure);
    const niche = computeAvgLogPsByYear(aiNiche);

    const allYearSet = new Set([...dot.years, ...big.years, ...niche.years]);
    const allYears = Array.from(allYearSet).sort((a, b) => a - b);

    const makeAligned = (years, values) => {
      const map = new Map(years.map((y, i) => [y, values[i]]));
      return allYears.map((y) => (map.has(y) ? map.get(y) : null));
    };

    return {
      years: allYears,
      dotcom: makeAligned(dot.years, dot.values),
      bigTech: makeAligned(big.years, big.values),
      pureAI: makeAligned(niche.years, niche.values),
    };
  }, [dotcom, aiPure, aiNiche]);

  // Indices within the current year range
  const filteredIndices = useMemo(() => {
    if (!series) return [];
    return series.years
      .map((year, idx) => ({ year, idx }))
      .filter(({ year }) => year >= range[0] && year <= range[1]);
  }, [series, range]);

  // Smoothing
  const smoothed = useMemo(() => {
    if (!series) return null;
    return {
      dotcom: movingAverage(series.dotcom, smooth),
      bigTech: movingAverage(series.bigTech, smooth),
      pureAI: movingAverage(series.pureAI, smooth),
    };
  }, [series, smooth]);

  // Scenario: extend Big Tech AI P/S from 2025 to 2032 using CAGR
  const scenario = useMemo(() => {
    if (!series) return { years: [], data: [] };
    const bigVals = series.bigTech.filter((v) => v != null);
    if (!bigVals.length) return { years: [], data: [] };

    const lastLog = bigVals[bigVals.length - 1];
    let currentPs = Math.exp(lastLog); // back to P/S multiple

    const years = [];
    const data = [];
    for (let year = 2025; year <= 2032; year += 1) {
      currentPs *= 1 + customGrowth / 100;
      years.push(year);
      data.push(Math.log(currentPs));
    }
    return { years, data };
  }, [series, customGrowth]);

  // Full label set: historical + scenario
  const allLabels = useMemo(() => {
    if (!series) return [];
    const set = new Set([...series.years, ...scenario.years]);
    return Array.from(set).sort((a, b) => a - b);
  }, [series, scenario]);

  // Align historical series + scenario to the unified label axis
  const alignedData = useMemo(() => {
    if (!series || !smoothed) return null;
    const align = (years, values) => {
      const map = new Map(years.map((y, i) => [y, values[i]]));
      return allLabels.map((y) => (map.has(y) ? map.get(y) : null));
    };

    return {
      dotcom: align(series.years, smoothed.dotcom),
      bigTech: align(series.years, smoothed.bigTech),
      pureAI: align(series.years, smoothed.pureAI),
      scenario: align(scenario.years, scenario.data),
    };
  }, [series, smoothed, scenario, allLabels]);

  const uploadDatasets = uploads.map((entry, idx) => {
    const lookup = new Map(entry.data.map((item) => [item.year, item.value]));
    return {
      label: entry.label,
      data: allLabels.map((label) => {
        const val = lookup.get(label);
        if (val == null || !Number.isFinite(val)) return null;
        return Math.log(val); // treat uploaded values as P/S and log them
      }),
      borderColor: palette[idx % palette.length],
      backgroundColor: palette[idx % palette.length] + "55",
      tension: 0.35,
      fill: false,
      type: chartType,
      borderWidth: 3,
    };
  });

  const datasets = useMemo(() => {
    if (!alignedData) return [];

    const baseSets = [
      {
        label: "Dot-com avg log(P/S)",
        data: alignedData.dotcom,
        borderColor: "#ef4444",
        backgroundColor: "rgba(239, 68, 68, 0.25)",
        fill: chartType === "line",
        tension: 0.35,
      },
      {
        label: "Big Tech AI avg log(P/S)",
        data: alignedData.bigTech,
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.25)",
        fill: chartType === "line",
        tension: 0.35,
      },
      {
        label: "Pure-play AI avg log(P/S)",
        data: alignedData.pureAI,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.25)",
        fill: chartType === "line",
        tension: 0.35,
      },
      {
        label: `Big Tech AI ${customGrowth}% CAGR scenario`,
        data: alignedData.scenario,
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245, 158, 11, 0.25)",
        borderDash: [6, 6],
        pointRadius: 4,
        pointStyle: "rectRot",
        spanGaps: true,
        tension: 0.2,
      },
    ].map((ds) => ({
      ...ds,
      type: chartType,
      borderWidth: 3,
    }));

    return [...baseSets, ...uploadDatasets];
  }, [alignedData, chartType, customGrowth, uploadDatasets]);

  const reset = () => {
    setChartType("line");
    setSmooth(2);
    setRange([1996, 2025]);
    setCustomGrowth(18);
    setUploads([]);
  };

  const addUpload = (data, label) => {
    if (!data.length) return;
    setUploads((prev) => [
      ...prev,
      { label: label || `Upload ${prev.length + 1}`, data },
    ]);
  };

  // Table rows in the visible year range
  const tableRows = useMemo(() => {
    if (!series) return [];
    return filteredIndices.map(({ year, idx }) => {
      const dc = series.dotcom[idx];
      const bt = series.bigTech[idx];
      const pa = series.pureAI[idx];
      const toDisplay = (v) =>
        v == null ? "–" : Math.exp(v).toFixed(1) + "×"; // back to P/S multiple
      return {
        year,
        dotcom: toDisplay(dc),
        bigTech: toDisplay(bt),
        pureAI: toDisplay(pa),
      };
    });
  }, [series, filteredIndices]);

  return (
    <div className="page">
      <div className="hero">
        <div>
          <div className="tag">Dot-com vs AI: valuation / revenue</div>
          <h1>Compare real P/S multiples across bubbles</h1>
          <p>
            This chart is built directly from your CSV and Excel files in the repo root using
            the same logic as your Python script. Explore how average log(P/S) for dot-com
            names, Big Tech AI, and pure-play AI evolve over time, then extend Big Tech AI with
            a hypothetical growth scenario.
          </p>
          <div className="badges" style={{ marginTop: 10 }}>
            <span className="badge">Real CSV / XLSX data</span>
            <span className="badge">Live smoothing</span>
            <span className="badge">Custom AI CAGR</span>
            <span className="badge">CSV overlay</span>
          </div>
          {loading && (
            <p style={{ marginTop: 8, color: "var(--muted)", fontSize: "0.9rem" }}>
              Loading dot-com and AI cohorts from root files…
            </p>
          )}
          {error && (
            <p style={{ marginTop: 8, color: "#fca5a5", fontSize: "0.9rem" }}>
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="layout">
        <DataControls
          chartType={chartType}
          setChartType={setChartType}
          smooth={smooth}
          setSmooth={setSmooth}
          range={range}
          setRange={setRange}
          customGrowth={customGrowth}
          setCustomGrowth={setCustomGrowth}
          onReset={reset}
          onUpload={addUpload}
        />

        <div className="card chart-card">
          <h3 style={{ marginTop: 0 }}>Valuation / revenue trajectory explorer</h3>
          {series ? (
            <>
              <TrendChart labels={allLabels} datasets={datasets} chartType={chartType} />
              <MetaStats series={series} filteredIndices={filteredIndices} />
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>
              Waiting for data. Make sure the root files are accessible:
              <code> Company-Metric-1996-1997-1998-1999-2000.csv</code>,{" "}
              <code>spreadsheet (3).xlsx</code>, <code>spreadsheet (4).xlsx</code>.
            </p>
          )}
        </div>
      </div>

      <DataTable rows={tableRows} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

const { useEffect, useMemo, useRef, useState } = React;

const palette = ['#7c3aed', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#60a5fa', '#c084fc'];

const DATA_FILES = {
  dotcom: '../Company-Metric-1996-1997-1998-1999-2000.csv',
  aiBroad: '../spreadsheet (3).xlsx',
  aiPure: '../spreadsheet (4).xlsx',
};

const DOTCOM_YEARS = [1996, 1997, 1998, 1999, 2000];
const AI_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const clean = String(value).replace(/,/g, '').replace(/"/g, '').trim();
  if (!clean || clean.toLowerCase() === 'n/a') return null;
  const num = Number(clean);
  return Number.isFinite(num) ? num : null;
}

function parseCsvRows(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')));
}

function tidyPanel(rows, years) {
  if (!rows.length) return [];
  const header = rows[0];
  const yearIndex = new Map(years.map((year) => [String(year), header.indexOf(String(year))]));
  const records = [];

  for (let i = 1; i < rows.length; i += 1) {
    const company = rows[i]?.[0];
    if (!company) continue;
    const mcRow = rows[i];
    const revRow = rows[i + 1] || [];
    const vrRow = rows[i + 2] || [];

    years.forEach((year) => {
      const colIndex = yearIndex.get(String(year));
      const mc = parseNumber(mcRow[colIndex]);
      const rev = parseNumber(revRow[colIndex]);
      const vr = parseNumber(vrRow[colIndex]);
      records.push({ Company: mcRow[0] || company, Year: year, MarketCap: mc, Revenue: rev, ValRev: vr });
    });

    i += 2;
  }

  return records;
}

function safeLog(series) {
  return series.filter((n) => n > 0).map((n) => Math.log(n));
}

function groupMeanByYear(data) {
  const map = new Map();
  data.forEach((row) => {
    if (!row.ValRev || row.ValRev <= 0) return;
    const arr = map.get(row.Year) || [];
    arr.push(row.ValRev);
    map.set(row.Year, arr);
  });

  const labels = Array.from(map.keys()).sort((a, b) => a - b);
  const values = labels.map((year) => {
    const nums = map.get(year);
    const avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
    return Math.log(avg);
  });
  return { labels, values };
}

function medianLog(series) {
  const filtered = safeLog(series);
  if (!filtered.length) return null;
  const sorted = [...filtered].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function useBubbleData() {
  const [data, setData] = useState({ loading: true, error: null, dotcom: [], aiPure: [], aiNiche: [] });

  useEffect(() => {
    async function loadData() {
      try {
        const [dotcomResp, aiBroadResp, aiPureResp] = await Promise.all([
          fetch(DATA_FILES.dotcom),
          fetch(DATA_FILES.aiBroad),
          fetch(DATA_FILES.aiPure),
        ]);

        if (!dotcomResp.ok || !aiBroadResp.ok || !aiPureResp.ok) {
          throw new Error('Unable to load source files');
        }

        const [dotcomText, aiBroadBuffer, aiPureBuffer] = await Promise.all([
          dotcomResp.text(),
          aiBroadResp.arrayBuffer(),
          aiPureResp.arrayBuffer(),
        ]);

        const dotcomRows = parseCsvRows(dotcomText);
        const aiBroadBook = XLSX.read(aiBroadBuffer, { type: 'array' });
        const aiPureBook = XLSX.read(aiPureBuffer, { type: 'array' });

        const aiBroadRows = XLSX.utils.sheet_to_json(aiBroadBook.Sheets[aiBroadBook.SheetNames[0]], {
          header: 1,
          blankrows: false,
        });
        const aiPureRows = XLSX.utils.sheet_to_json(aiPureBook.Sheets[aiPureBook.SheetNames[0]], {
          header: 1,
          blankrows: false,
        });

        const dotcomTidy = tidyPanel(dotcomRows, DOTCOM_YEARS).map((row) => ({ ...row, Era: 'Dot-com (1996-2000)' }));
        const aiPureTidy = tidyPanel(aiPureRows, AI_YEARS).map((row) => ({ ...row, Era: 'Big Tech AI (2020-2025)' }));
        const aiNicheTidy = tidyPanel(aiBroadRows, AI_YEARS).map((row) => ({ ...row, Era: 'Pure-play AI (2020-2025)' }));

        setData({ loading: false, error: null, dotcom: dotcomTidy, aiPure: aiPureTidy, aiNiche: aiNicheTidy });
      } catch (err) {
        setData({ loading: false, error: err.message, dotcom: [], aiPure: [], aiNiche: [] });
      }
    }

    loadData();
  }, []);

  return data;
}

function ChartCard({ title, description, buildChart }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !buildChart) return undefined;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = buildChart(canvasRef.current.getContext('2d'));
    return () => chartRef.current?.destroy();
  }, [buildChart]);

  return (
    <div className="card chart-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
      </div>
      <canvas ref={canvasRef} height="320" />
    </div>
  );
}

function Dashboard({ dotcom, aiPure, aiNiche }) {
  const averagePlot = useMemo(() => {
    const tracks = [
      { data: dotcom, label: 'Dot-com', color: palette[0] },
      { data: aiPure, label: 'Big Tech AI', color: palette[1] },
      { data: aiNiche, label: 'Pure AI', color: palette[2] },
    ].map((entry) => ({ ...groupMeanByYear(entry.data), label: entry.label, color: entry.color }));

    const labels = Array.from(new Set(tracks.flatMap((t) => t.labels))).sort((a, b) => a - b);
    const datasets = tracks.map((track) => ({
      label: track.label,
      data: labels.map((year) => {
        const idx = track.labels.indexOf(year);
        return idx >= 0 ? track.values[idx] : null;
      }),
      borderColor: track.color,
      backgroundColor: `${track.color}44`,
      spanGaps: true,
      tension: 0.25,
      pointRadius: 4,
    }));

    return { labels, datasets };
  }, [dotcom, aiPure, aiNiche]);

  const boxPlotData = useMemo(() => {
    const dotcomPeak = dotcom.filter((row) => row.Year === 1999 || row.Year === 2000).map((row) => row.ValRev);
    const aiPurePeak = aiPure.filter((row) => [2023, 2024, 2025].includes(row.Year)).map((row) => row.ValRev);
    const aiNichePeak = aiNiche.filter((row) => [2023, 2024, 2025].includes(row.Year)).map((row) => row.ValRev);

    return {
      labels: ['Dot-com peak (log)', 'Big Tech AI peak (log)', 'Pure AI peak (log)'],
      datasets: [
        {
          label: 'Log P/S distribution',
          backgroundColor: palette[3],
          borderColor: '#ffffff',
          borderWidth: 1,
          outlierColor: '#cbd5e1',
          padding: 12,
          itemRadius: 2,
          data: [safeLog(dotcomPeak), safeLog(aiPurePeak), safeLog(aiNichePeak)],
        },
      ],
    };
  }, [dotcom, aiPure, aiNiche]);

  const scatterData = useMemo(() => {
    const combined = [...dotcom, ...aiPure, ...aiNiche];
    const markers = {
      'Dot-com (1996-2000)': { color: palette[0], shape: 'rect' },
      'Big Tech AI (2020-2025)': { color: palette[1], shape: 'circle' },
      'Pure-play AI (2020-2025)': { color: palette[2], shape: 'triangle' },
    };

    return Object.entries(
      combined.reduce((acc, row) => {
        if (!row.Revenue || !row.MarketCap || row.Revenue <= 0 || row.MarketCap <= 0) return acc;
        const entry = acc[row.Era] || [];
        entry.push({ x: Math.log(row.Revenue), y: Math.log(row.MarketCap) });
        acc[row.Era] = entry;
        return acc;
      }, {}),
    ).map(([label, points]) => ({ label, points, ...markers[label] }));
  }, [dotcom, aiPure, aiNiche]);

  const medianBars = useMemo(() => {
    const entries = [
      { label: 'Dot-com peak', data: dotcom.filter((row) => [1999, 2000].includes(row.Year)).map((r) => r.ValRev) },
      { label: 'Big Tech AI peak', data: aiPure.filter((row) => [2023, 2024, 2025].includes(row.Year)).map((r) => r.ValRev) },
      { label: 'Pure AI peak', data: aiNiche.filter((row) => [2023, 2024, 2025].includes(row.Year)).map((r) => r.ValRev) },
    ];

    return {
      labels: entries.map((e) => e.label),
      values: entries.map((e) => medianLog(e.data)),
    };
  }, [dotcom, aiPure, aiNiche]);

  return (
    <div className="grid">
      <ChartCard
        title="LOG Normalised Average Valuation/Revenue"
        description="Mean P/S by year for each cohort with natural log transform"
        buildChart={(ctx) =>
          new Chart(ctx, {
            type: 'line',
            data: { labels: averagePlot.labels, datasets: averagePlot.datasets },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
                y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
              },
              plugins: {
                legend: { labels: { color: '#e5e7eb' } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}` } },
              },
            },
          })
        }
      />

      <ChartCard
        title="Log-normalised P/S boxplot at peaks"
        description="Distribution of log valuation/revenue at peak bubble periods"
        buildChart={(ctx) =>
          new Chart(ctx, {
            type: 'boxplot',
            data: boxPlotData,
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
                y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
              },
            },
          })
        }
      />

      <ChartCard
        title="Log-Log Market Cap vs Revenue"
        description="Scatter of log market cap against log revenue, colored by era"
        buildChart={(ctx) =>
          new Chart(ctx, {
            type: 'scatter',
            data: {
              datasets: scatterData.map((entry) => ({
                label: entry.label,
                data: entry.points,
                borderColor: entry.color,
                backgroundColor: `${entry.color}88`,
                pointStyle: entry.shape,
                pointRadius: 5,
              })),
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { title: { display: true, text: 'log(Revenue)', color: '#cbd5e1' }, ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
                y: { title: { display: true, text: 'log(Market Cap)', color: '#cbd5e1' }, ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
              },
              plugins: { legend: { labels: { color: '#e5e7eb' } } },
            },
          })
        }
      />

      <ChartCard
        title="LOG Median Valuation/Revenue"
        description="Median P/S at each bubble peak across cohorts"
        buildChart={(ctx) =>
          new Chart(ctx, {
            type: 'bar',
            data: {
              labels: medianBars.labels,
              datasets: [
                {
                  label: 'log(median P/S)',
                  data: medianBars.values,
                  backgroundColor: palette[4],
                  borderRadius: 8,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { ticks: { color: '#cbd5e1' }, grid: { display: false } },
                y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
              },
              plugins: { legend: { display: false } },
            },
          })
        }
      />
    </div>
  );
}

function App() {
  const { loading, error, dotcom, aiPure, aiNiche } = useBubbleData();

  return (
    <div className="page">
      <div className="hero">
        <div>
          <div className="tag">Bubble comparison</div>
          <h1>Plot the dot-com and AI fever charts side-by-side</h1>
          <p>
            The four visuals below mirror the views scripted in <code>bubble_comparison.py</code> without touching the
            Python file: average log P/S by year, peak-period boxplots, log-log scale market cap vs revenue, and the
            median log P/S bars.
          </p>
          <div className="badges" style={{ marginTop: 10 }}>
            <span className="badge">Data sourced from project files</span>
            <span className="badge">Natural log scaling</span>
            <span className="badge">Cohorts aligned by year</span>
          </div>
        </div>
      </div>

      {loading && <div className="card" style={{ marginTop: 18 }}>Loading bubble data…</div>}
      {error && !loading && <div className="card" style={{ marginTop: 18, color: '#fca5a5' }}>{error}</div>}

      {!loading && !error && <Dashboard dotcom={dotcom} aiPure={aiPure} aiNiche={aiNiche} />}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

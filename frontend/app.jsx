const { useEffect, useMemo, useRef, useState } = React;

const baseData = [
  { year: 1995, aiIndex: 12, dotcomIndex: 30 },
  { year: 1997, aiIndex: 16, dotcomIndex: 54 },
  { year: 1999, aiIndex: 24, dotcomIndex: 120 },
  { year: 2001, aiIndex: 28, dotcomIndex: 64 },
  { year: 2005, aiIndex: 40, dotcomIndex: 52 },
  { year: 2010, aiIndex: 70, dotcomIndex: 80 },
  { year: 2015, aiIndex: 110, dotcomIndex: 140 },
  { year: 2017, aiIndex: 170, dotcomIndex: 170 },
  { year: 2019, aiIndex: 260, dotcomIndex: 220 },
  { year: 2021, aiIndex: 430, dotcomIndex: 290 },
  { year: 2023, aiIndex: 640, dotcomIndex: 330 },
  { year: 2025, aiIndex: 900, dotcomIndex: 370 },
];

const palette = [
  '#7c3aed',
  '#22d3ee',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#60a5fa',
  '#c084fc',
];

function movingAverage(values, window) {
  if (window <= 1) return values;
  return values.map((val, idx, arr) => {
    const start = Math.max(0, idx - Math.floor(window / 2));
    const end = Math.min(arr.length, idx + Math.ceil(window / 2));
    const slice = arr.slice(start, end);
    const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
    return Number(avg.toFixed(2));
  });
}

function parseCsv(text) {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  const yearIndex = headers.findIndex((h) => h.includes('year'));
  const valueIndex = headers.findIndex((h) => h.includes('value') || h.includes('index'));
  if (yearIndex === -1 || valueIndex === -1) return [];

  return rows
    .map((line) => line.split(',').map((cell) => cell.trim()))
    .map((cells) => ({
      year: Number(cells[yearIndex]),
      value: Number(cells[valueIndex]),
    }))
    .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.value));
}

function TrendChart({ labels, datasets, chartType }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
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
          mode: 'index',
        },
        plugins: {
          legend: {
            labels: {
              color: '#e5e7eb',
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#0b1222',
            borderColor: '#1f2937',
            borderWidth: 1,
            titleColor: '#fff',
            bodyColor: '#cbd5e1',
            padding: 12,
          },
        },
        scales: {
          x: {
            ticks: { color: '#cbd5e1' },
            grid: { color: 'rgba(255,255,255,0.06)' },
          },
          y: {
            ticks: { color: '#cbd5e1' },
            grid: { color: 'rgba(255,255,255,0.06)' },
          },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [labels, datasets, chartType]);

  return <canvas ref={canvasRef} height="420" />;
}

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
                min="1995"
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
                min="1995"
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

        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
          <legend>Scenario builder</legend>
          <div className="field">
            <label>Hypothetical AI CAGR ({customGrowth}%)</label>
            <input
              type="range"
              min="5"
              max="40"
              value={customGrowth}
              onChange={(e) => setCustomGrowth(Number(e.target.value))}
            />
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Adjust the assumed annual growth rate for AI between 2025 and 2032 to compare
              trajectories.
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
                  if (typeof text === 'string') {
                    const parsed = parseCsv(text);
                    onUpload(parsed, file.name.replace(/\.csv$/i, ''));
                  }
                };
                reader.readAsText(file);
              }}
            />
            <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Drop in historical data to overlay your own scenario. Only two columns are needed:
              year and value/index.
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

function MetaStats({ filtered }) {
  const start = filtered[0];
  const end = filtered[filtered.length - 1];
  const periods = Math.max(1, filtered.length - 1);
  const aiCagr = (((end.aiIndex / start.aiIndex) ** (1 / periods)) - 1) * 100;
  const dcCagr = (((end.dotcomIndex / start.dotcomIndex) ** (1 / periods)) - 1) * 100;

  return (
    <div className="meta">
      <div className="stat">
        <span className="stat-label">AI run-up</span>
        <span className="stat-value">{Math.round(end.aiIndex - start.aiIndex)} pts</span>
        <span className="pill pill-good">Faster than Dot-Com</span>
      </div>
      <div className="stat">
        <span className="stat-label">Dot-Com comedown</span>
        <span className="stat-value">{Math.round(start.dotcomIndex - end.dotcomIndex)} pts</span>
        <span className="pill pill-warn">Bubble hangover</span>
      </div>
      <div className="stat">
        <span className="stat-label">AI CAGR</span>
        <span className="stat-value">{aiCagr.toFixed(1)}%</span>
        <span className="pill pill-good">Momentum</span>
      </div>
      <div className="stat">
        <span className="stat-label">Dot-Com CAGR</span>
        <span className="stat-value">{dcCagr.toFixed(1)}%</span>
        <span className="pill pill-neutral">Historical</span>
      </div>
    </div>
  );
}

function DataTable({ rows }) {
  return (
    <div className="table card">
      <h3>Data snapshot</h3>
      <table>
        <thead>
          <tr>
            <th>Year</th>
            <th>AI Index</th>
            <th>Dot-Com Index</th>
            <th>Spread</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <td>{row.year}</td>
              <td>{row.aiIndex}</td>
              <td>{row.dotcomIndex}</td>
              <td>{(row.aiIndex - row.dotcomIndex).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [chartType, setChartType] = useState('line');
  const [smooth, setSmooth] = useState(2);
  const [range, setRange] = useState([1995, 2025]);
  const [customGrowth, setCustomGrowth] = useState(18);
  const [uploads, setUploads] = useState([]);

  const filtered = useMemo(
    () => baseData.filter((point) => point.year >= range[0] && point.year <= range[1]),
    [range],
  );

  const derivedLabels = filtered.map((point) => point.year);
  const aiSeries = filtered.map((point) => point.aiIndex);
  const dcSeries = filtered.map((point) => point.dotcomIndex);

  const smoothedAi = movingAverage(aiSeries, smooth);
  const smoothedDc = movingAverage(dcSeries, smooth);

  const scenario = useMemo(() => {
    const startYear = 2025;
    const endYear = 2032;
    const startValue = baseData[baseData.length - 1].aiIndex;
    const years = [];
    const data = [];
    let current = startValue;
    for (let year = startYear; year <= endYear; year += 1) {
      years.push(year);
      data.push(Number(current.toFixed(1)));
      current *= 1 + customGrowth / 100;
    }
    return { years, data };
  }, [customGrowth]);

  const allLabels = Array.from(new Set([...derivedLabels, ...scenario.years])).sort((a, b) => a - b);

  const aiSeriesAligned = allLabels.map((label) => {
    const idx = derivedLabels.indexOf(label);
    return idx >= 0 ? smoothedAi[idx] : null;
  });

  const dcSeriesAligned = allLabels.map((label) => {
    const idx = derivedLabels.indexOf(label);
    return idx >= 0 ? smoothedDc[idx] : null;
  });

  const uploadDatasets = uploads.map((entry, idx) => {
    const lookup = new Map(entry.data.map((item) => [item.year, item.value]));
    return {
      label: entry.label,
      data: allLabels.map((label) => lookup.get(label) ?? null),
      borderColor: palette[idx % palette.length],
      backgroundColor: palette[idx % palette.length] + '55',
      tension: 0.35,
      fill: false,
    };
  });

  const datasets = [
    {
      label: 'AI Momentum',
      data: aiSeriesAligned,
      borderColor: '#7c3aed',
      backgroundColor: 'rgba(124, 58, 237, 0.3)',
      fill: chartType === 'line',
      tension: 0.4,
    },
    {
      label: 'Dot-Com Echo',
      data: dcSeriesAligned,
      borderColor: '#22d3ee',
      backgroundColor: 'rgba(34, 211, 238, 0.2)',
      fill: chartType === 'line',
      tension: 0.3,
    },
    {
      label: `AI ${customGrowth}% CAGR scenario`,
      data: allLabels.map((label) => {
        const idx = scenario.years.indexOf(label);
        return idx >= 0 ? scenario.data[idx] : null;
      }),
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.2)',
      borderDash: [6, 6],
      pointRadius: 4,
      pointStyle: 'rectRot',
      spanGaps: true,
      tension: 0.2,
    },
    ...uploadDatasets,
  ].map((dataset) => ({
    ...dataset,
    type: chartType,
    borderWidth: 3,
  }));

  const reset = () => {
    setChartType('line');
    setSmooth(2);
    setRange([1995, 2025]);
    setCustomGrowth(18);
    setUploads([]);
  };

  const addUpload = (data, label) => {
    if (!data.length) return;
    setUploads((prev) => [...prev, { label: label || `Upload ${prev.length + 1}`, data }]);
  };

  return (
    <div className="page">
      <div className="hero">
        <div>
          <div className="tag">AI market fever vs. dot-com hangover</div>
          <h1>Compare hype cycles in one interactive chart</h1>
          <p>
            Tune smoothing, focus years, and add your own CSV data to stress test the narrative.
            The chart updates instantly so you can explore how AI momentum stacks up against the
            dot-com bubble.
          </p>
          <div className="badges" style={{ marginTop: 10 }}>
            <span className="badge">Live smoothing</span>
            <span className="badge">Custom CAGR scenario</span>
            <span className="badge">CSV overlay</span>
          </div>
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
          <h3 style={{ marginTop: 0 }}>Trajectory explorer</h3>
          <TrendChart labels={allLabels} datasets={datasets} chartType={chartType} />
          <MetaStats filtered={filtered} />
        </div>
      </div>

      <DataTable rows={filtered} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

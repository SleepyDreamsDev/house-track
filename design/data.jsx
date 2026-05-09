// Mock data shaped like the real API responses

const NOW = new Date('2026-05-03T09:14:00').getTime();
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const daysAgo = (d) => new Date(NOW - d * 86400 * 1000).toISOString();

window.MOCK_LISTINGS = [
  {
    id: '76654301',
    title: 'Casă cu 4 camere, sector Buiucani — finisaj recent',
    priceEur: 168000,
    priceWas: 179000,
    areaSqm: 142,
    landSqm: 480,
    rooms: 4,
    floors: 2,
    yearBuilt: 2014,
    district: 'Buiucani',
    street: 'str. Sucevița',
    firstSeenAt: hoursAgo(3),
    seenCount: 1,
    snapshots: 1,
    isNew: true,
    priceDrop: true,
    flags: ['below median €/m²'],
  },
  {
    id: '76651872',
    title: 'Casă în 2 nivele, Durlești, teren 6 ari',
    priceEur: 142000,
    areaSqm: 156,
    landSqm: 600,
    rooms: 5,
    floors: 2,
    yearBuilt: 2008,
    district: 'Durlești',
    street: 'str. Tudor Strișcă',
    firstSeenAt: hoursAgo(11),
    seenCount: 1,
    snapshots: 1,
    isNew: true,
    flags: ['agent listing'],
  },
  {
    id: '76612040',
    title: 'Casă Telecentru, 3 dormitoare, garaj inclus',
    priceEur: 195000,
    priceWas: 215000,
    areaSqm: 178,
    landSqm: 450,
    rooms: 4,
    floors: 2,
    yearBuilt: 2017,
    district: 'Centru',
    street: 'str. Drumul Viilor',
    firstSeenAt: daysAgo(2),
    seenCount: 36,
    snapshots: 4,
    priceDrop: true,
  },
  {
    id: '76598114',
    title: 'Vilă Botanica, finisaj premium, piscină',
    priceEur: 245000,
    areaSqm: 198,
    landSqm: 720,
    rooms: 5,
    floors: 2,
    yearBuilt: 2021,
    district: 'Botanica',
    street: 'str. Grenoble',
    firstSeenAt: daysAgo(5),
    seenCount: 88,
    snapshots: 1,
  },
  {
    id: '76512908',
    title: 'Casă veche, lot mare în Râșcani — necesită reparație',
    priceEur: 89000,
    areaSqm: 84,
    landSqm: 540,
    rooms: 3,
    floors: 1,
    yearBuilt: 1976,
    district: 'Râșcani',
    street: 'str. Petricani',
    firstSeenAt: daysAgo(9),
    seenCount: 142,
    snapshots: 2,
    flags: ['needs renovation'],
  },
  {
    id: '76499820',
    title: 'Casă nouă Ciocana, 4 camere',
    priceEur: 178000,
    areaSqm: 165,
    landSqm: 380,
    rooms: 4,
    floors: 2,
    yearBuilt: 2023,
    district: 'Ciocana',
    street: 'str. Mircea cel Bătrân',
    firstSeenAt: daysAgo(11),
    seenCount: 188,
    snapshots: 1,
  },
  {
    id: '76481200',
    title: 'Casă Buiucani sector vechi, 3 niveluri',
    priceEur: 220000,
    areaSqm: 192,
    landSqm: 510,
    rooms: 5,
    floors: 3,
    yearBuilt: 1998,
    district: 'Buiucani',
    street: 'str. Ion Creangă',
    firstSeenAt: daysAgo(14),
    seenCount: 244,
    snapshots: 3,
  },
  {
    id: '76410012',
    title: 'Vilă Durlești, finisaj, două intrări',
    priceEur: 199000,
    priceWas: 209000,
    areaSqm: 175,
    landSqm: 700,
    rooms: 4,
    floors: 2,
    yearBuilt: 2019,
    district: 'Durlești',
    street: 'str. Calea Ieșilor',
    firstSeenAt: daysAgo(18),
    seenCount: 312,
    snapshots: 6,
    priceDrop: true,
  },
  {
    id: '76344112',
    title: 'Casă mică Centru, ideală pentru investiție',
    priceEur: 115000,
    areaSqm: 72,
    landSqm: 210,
    rooms: 2,
    floors: 1,
    yearBuilt: 1985,
    district: 'Centru',
    street: 'str. Bucuresti',
    firstSeenAt: daysAgo(23),
    seenCount: 408,
    snapshots: 1,
  },
];

window.MOCK_SWEEPS = [
  { id: 's-481', startedAt: hoursAgo(0.2), durationMs: 312_000, status: 'running', pagesFetched: 4, detailsFetched: 0, newListings: 0, updatedListings: 0, errorCount: 0 },
  { id: 's-480', startedAt: hoursAgo(1), durationMs: 487_240, status: 'success', pagesFetched: 8, detailsFetched: 2, newListings: 2, updatedListings: 7, errorCount: 0 },
  { id: 's-479', startedAt: hoursAgo(2), durationMs: 412_110, status: 'success', pagesFetched: 8, detailsFetched: 0, newListings: 0, updatedListings: 4, errorCount: 0 },
  { id: 's-478', startedAt: hoursAgo(3), durationMs: 521_002, status: 'success', pagesFetched: 8, detailsFetched: 1, newListings: 1, updatedListings: 6, errorCount: 0 },
  { id: 's-477', startedAt: hoursAgo(4), durationMs: 96_400, status: 'failed', pagesFetched: 2, detailsFetched: 0, newListings: 0, updatedListings: 0, errorCount: 3 },
  { id: 's-476', startedAt: hoursAgo(5), durationMs: 466_800, status: 'success', pagesFetched: 8, detailsFetched: 0, newListings: 0, updatedListings: 5, errorCount: 0 },
  { id: 's-475', startedAt: hoursAgo(6), durationMs: 449_300, status: 'success', pagesFetched: 8, detailsFetched: 1, newListings: 1, updatedListings: 6, errorCount: 0 },
  { id: 's-474', startedAt: hoursAgo(7), durationMs: 503_120, status: 'success', pagesFetched: 8, detailsFetched: 3, newListings: 2, updatedListings: 9, errorCount: 1 },
  { id: 's-473', startedAt: hoursAgo(8), durationMs: 478_900, status: 'success', pagesFetched: 8, detailsFetched: 0, newListings: 0, updatedListings: 3, errorCount: 0 },
  { id: 's-472', startedAt: hoursAgo(9), durationMs: 441_120, status: 'success', pagesFetched: 8, detailsFetched: 0, newListings: 0, updatedListings: 4, errorCount: 0 },
  { id: 's-471', startedAt: hoursAgo(10), durationMs: 482_330, status: 'success', pagesFetched: 8, detailsFetched: 1, newListings: 1, updatedListings: 5, errorCount: 0 },
  { id: 's-470', startedAt: hoursAgo(11), durationMs: 519_220, status: 'success', pagesFetched: 8, detailsFetched: 4, newListings: 3, updatedListings: 8, errorCount: 0 },
];

// 7-day sparkline of new listings/day (oldest → newest)
window.MOCK_NEW_PER_DAY = [3, 5, 4, 7, 2, 6, 4];
window.MOCK_SUCCESS_RATE_24H = 0.95;

window.MOCK_SETTINGS = [
  { key: 'politeness.baseDelayMs', label: 'Base request delay', group: 'Politeness', value: 8000, default: 8000, kind: 'number', unit: 'ms', hint: 'Gap between index requests.' },
  { key: 'politeness.jitterMs', label: 'Jitter', group: 'Politeness', value: 2000, default: 2000, kind: 'number', unit: 'ms', hint: 'Random ± on top of base delay.' },
  { key: 'sweep.maxPagesPerSweep', label: 'Max index pages / sweep', group: 'Sweep', value: 8, default: 2, kind: 'number', unit: 'pages' },
  { key: 'sweep.backfillPerSweep', label: 'Backfill per sweep', group: 'Sweep', value: 10, default: 10, kind: 'number', unit: 'listings' },
  { key: 'sweep.cronSchedule', label: 'Cron schedule', group: 'Sweep', value: '0 * * * *', default: '0 * * * *', kind: 'text', hint: 'Restart crawler container after editing.' },
  { key: 'circuit.consecutiveFailureThreshold', label: 'Failures before open', group: 'Circuit breaker', value: 3, default: 3, kind: 'number', unit: 'failures' },
  { key: 'circuit.pauseDurationMs', label: 'Pause duration', group: 'Circuit breaker', value: 86_400_000, default: 86_400_000, kind: 'number', unit: 'ms', hint: '24h by default.' },
  { key: 'filter.maxPriceEur', label: 'Max price', group: 'Filter', value: 250000, default: 250000, kind: 'number', unit: '€' },
  { key: 'filter.maxAreaSqm', label: 'Max area', group: 'Filter', value: 200, default: 200, kind: 'number', unit: 'm²' },
  { key: 'log.level', label: 'Log level', group: 'Logging', value: 'info', default: 'info', kind: 'select', options: ['debug', 'info', 'warn', 'error'] },
];

// ---- Per-sweep detail (events + page timing + http log)
window.MOCK_SWEEP_DETAILS = {
  // Live, in-progress sweep
  's-481': {
    id: 's-481',
    status: 'running',
    startedAt: hoursAgo(0.2),
    source: '999.md',
    trigger: 'cron · 0 * * * *',
    config: {
      'politeness.baseDelayMs': 8000,
      'politeness.jitterMs': 2000,
      'sweep.maxPagesPerSweep': 8,
      'filter.maxPriceEur': 250000,
      'filter.maxAreaSqm': 200,
    },
    progress: { phase: 'index', pagesDone: 4, pagesTotal: 8, detailsDone: 0, detailsQueued: 2, newCount: 0, updatedCount: 5 },
    pages: [
      { n: 1, url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=1', status: 200, bytes: 184_201, parseMs: 87, found: 32, took: 8421 },
      { n: 2, url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=2', status: 200, bytes: 181_440, parseMs: 92, found: 32, took: 8112 },
      { n: 3, url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=3', status: 200, bytes: 178_902, parseMs: 81, found: 32, took: 8930 },
      { n: 4, url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=4', status: 200, bytes: 179_450, parseMs: 88, found: 32, took: 8210 },
    ],
    currentlyFetching: { url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=5', startedAt: 1200 /* ms ago */ },
    logTail: [
      { t: '09:13:42.218', lvl: 'info', msg: 'sweep.start', meta: 'id=s-481 source=999md' },
      { t: '09:13:50.911', lvl: 'info', msg: 'index.fetch ok', meta: 'page=1 status=200 found=32 took=8421ms' },
      { t: '09:13:59.323', lvl: 'info', msg: 'index.fetch ok', meta: 'page=2 status=200 found=32 took=8112ms' },
      { t: '09:14:08.521', lvl: 'info', msg: 'index.fetch ok', meta: 'page=3 status=200 found=32 took=8930ms' },
      { t: '09:14:17.001', lvl: 'info', msg: 'diff.computed', meta: 'new=0 seen=128 gone=0' },
      { t: '09:14:17.412', lvl: 'info', msg: 'index.fetch ok', meta: 'page=4 status=200 found=32 took=8210ms' },
      { t: '09:14:25.628', lvl: 'debug', msg: 'fetch.start', meta: 'url=…?page=5' },
    ],
    errors: [],
  },
  // Completed success sweep
  's-480': {
    id: 's-480',
    status: 'success',
    startedAt: hoursAgo(1),
    finishedAt: hoursAgo(1 - 0.135),
    source: '999.md',
    trigger: 'cron · 0 * * * *',
    config: {
      'politeness.baseDelayMs': 8000,
      'politeness.jitterMs': 2000,
      'sweep.maxPagesPerSweep': 8,
      'filter.maxPriceEur': 250000,
      'filter.maxAreaSqm': 200,
    },
    summary: { pagesFetched: 8, detailsFetched: 2, newListings: 2, updatedListings: 7, snapshotsWritten: 2, errors: 0, durationMs: 487_240 },
    pages: Array.from({ length: 8 }, (_, i) => ({
      n: i + 1,
      url: `https://999.md/ro/list/real-estate/houses-and-villas?page=${i + 1}`,
      status: 200,
      bytes: 175_000 + Math.round(Math.random() * 12000),
      parseMs: 80 + Math.round(Math.random() * 25),
      found: 32,
      took: 7800 + Math.round(Math.random() * 1500),
    })),
    details: [
      { id: '76654301', url: 'https://999.md/ro/76654301', status: 200, bytes: 92_004, parseMs: 41, action: 'new', priceEur: 168000 },
      { id: '76651872', url: 'https://999.md/ro/76651872', status: 200, bytes: 88_220, parseMs: 38, action: 'new', priceEur: 142000 },
    ],
    logTail: [
      { t: '08:13:42', lvl: 'info', msg: 'sweep.start', meta: 'id=s-480 source=999md' },
      { t: '08:13:50', lvl: 'info', msg: 'index.fetch ok', meta: 'page=1 found=32' },
      { t: '08:14:00', lvl: 'info', msg: 'index.fetch ok', meta: 'page=2 found=32' },
      { t: '08:14:09', lvl: 'info', msg: 'index.fetch ok', meta: 'page=3 found=32' },
      { t: '08:14:18', lvl: 'info', msg: 'index.fetch ok', meta: 'page=4 found=32' },
      { t: '08:14:26', lvl: 'info', msg: 'index.fetch ok', meta: 'page=5 found=32' },
      { t: '08:14:35', lvl: 'info', msg: 'index.fetch ok', meta: 'page=6 found=32' },
      { t: '08:14:43', lvl: 'info', msg: 'index.fetch ok', meta: 'page=7 found=32' },
      { t: '08:14:51', lvl: 'info', msg: 'index.fetch ok', meta: 'page=8 found=29' },
      { t: '08:14:55', lvl: 'info', msg: 'diff.computed', meta: 'new=2 seen=251 gone=0' },
      { t: '08:15:05', lvl: 'info', msg: 'detail.fetch ok', meta: 'id=76654301 status=200' },
      { t: '08:15:16', lvl: 'info', msg: 'snapshot.write', meta: 'id=76654301 hashChanged=true' },
      { t: '08:15:26', lvl: 'info', msg: 'detail.fetch ok', meta: 'id=76651872 status=200' },
      { t: '08:15:38', lvl: 'info', msg: 'snapshot.write', meta: 'id=76651872 hashChanged=true' },
      { t: '08:15:42', lvl: 'info', msg: 'sweep.done', meta: 'status=ok duration=487240ms' },
    ],
    errors: [],
  },
  // Failed sweep
  's-477': {
    id: 's-477',
    status: 'failed',
    startedAt: hoursAgo(4),
    finishedAt: hoursAgo(4 - 0.027),
    source: '999.md',
    trigger: 'cron · 0 * * * *',
    config: { 'politeness.baseDelayMs': 8000, 'sweep.maxPagesPerSweep': 8 },
    summary: { pagesFetched: 2, detailsFetched: 0, newListings: 0, updatedListings: 0, snapshotsWritten: 0, errors: 3, durationMs: 96_400 },
    pages: [
      { n: 1, url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=1', status: 200, bytes: 182_000, parseMs: 86, found: 32, took: 8231 },
      { n: 2, url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=2', status: 429, bytes: 0, parseMs: 0, found: 0, took: 412 },
    ],
    logTail: [
      { t: '05:13:42', lvl: 'info', msg: 'sweep.start', meta: 'id=s-477 source=999md' },
      { t: '05:13:50', lvl: 'info', msg: 'index.fetch ok', meta: 'page=1 status=200' },
      { t: '05:13:58', lvl: 'warn', msg: 'index.fetch fail', meta: 'page=2 status=429 retry=1' },
      { t: '05:14:09', lvl: 'warn', msg: 'index.fetch fail', meta: 'page=2 status=429 retry=2' },
      { t: '05:14:31', lvl: 'error', msg: 'index.fetch fail', meta: 'page=2 status=429 retry=3 giving up' },
      { t: '05:14:31', lvl: 'error', msg: 'circuit.trip', meta: 'consecutive_failures=3 pause=24h' },
      { t: '05:14:31', lvl: 'error', msg: 'sweep.abort', meta: 'reason=circuit_open' },
    ],
    errors: [
      { url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=2', status: 429, msg: 'rate limit', attempts: 3 },
      { url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=2', status: 429, msg: 'rate limit', attempts: 3 },
      { url: 'https://999.md/ro/list/real-estate/houses-and-villas?page=2', status: 429, msg: 'rate limit', attempts: 3 },
    ],
  },
};

window.MOCK_SOURCES = [
  { id: 'src-1', name: '999.md', baseUrl: 'https://999.md/ro/list/real-estate/houses-and-villas', adapterKey: '999md', enabled: true, lastSeen: hoursAgo(1) },
  { id: 'src-2', name: 'makler.md', baseUrl: 'https://makler.md', adapterKey: 'makler', enabled: false, placeholder: true },
  { id: 'src-3', name: 'lara.md', baseUrl: 'https://lara.md', adapterKey: 'lara', enabled: false, placeholder: true },
];

window.fmt = {
  eur: (n) => '€' + Math.round(n).toLocaleString('en-US'),
  num: (n) => n.toLocaleString('en-US'),
  ms: (ms) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  },
  rel: (iso) => {
    const diffMin = Math.round((NOW - new Date(iso).getTime()) / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const h = Math.round(diffMin / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  },
  date: (iso) => {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  },
};

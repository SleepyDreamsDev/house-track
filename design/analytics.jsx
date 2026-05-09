// Analytics — single page with tabs:
//   • Overview (= old "Trends deep-dive" mock B)
//   • Best Buys (full ranked list, 50)
//   • Price Drops (full ranked list, 50)
// Top-N previews on Overview drill into the Best Buys / Price Drops tab.

const { useState: aUseState, useMemo: aUseMemo } = React;

// --- shared analytics data --------------------------------------------------
const A_DISTRICTS = ['Buiucani', 'Botanica', 'Centru', 'Ciocana', 'Durlești', 'Râșcani'];
const A_ROOMS = ['1–2', '3', '4', '5+'];
const A_TYPES = ['House', 'Villa', 'Townhouse'];

const TREND_BY_DISTRICT = {
  'Buiucani': [1180,1190,1205,1212,1228,1240,1255,1268,1282,1290,1305,1320],
  'Botanica': [1080,1085,1092,1100,1118,1125,1140,1148,1160,1168,1175,1180],
  'Centru':   [1620,1635,1650,1670,1700,1720,1740,1760,1790,1810,1830,1850],
  'Ciocana':  [990,1000,1010,1020,1035,1045,1055,1065,1075,1080,1085,1090],
  'Durlești': [820,830,840,850,860,870,880,890,900,910,915,920],
  'Râșcani':  [1050,1060,1070,1080,1090,1100,1110,1120,1130,1135,1138,1140],
};
const MONTHS = ['Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May'];

const HEATMAP = {
  'Buiucani': { '1–2': 1480, '3': 1320, '4': 1280, '5+': 1240 },
  'Botanica': { '1–2': 1310, '3': 1180, '4': 1150, '5+': 1100 },
  'Centru':   { '1–2': 2050, '3': 1850, '4': 1820, '5+': 1780 },
  'Ciocana':  { '1–2': 1180, '3': 1090, '4': 1060, '5+': 1020 },
  'Durlești': { '1–2': 1010, '3': 920,  '4': 880,  '5+': 850  },
  'Râșcani':  { '1–2': 1240, '3': 1140, '4': 1100, '5+': 1080 },
};

const DOM_BUCKETS = [
  { label: '0–7d',   count: 38, hot: true },
  { label: '8–14d',  count: 52 },
  { label: '15–30d', count: 71 },
  { label: '31–60d', count: 48 },
  { label: '61–90d', count: 26, stale: true },
  { label: '90+d',   count: 12, stale: true },
];

const INVENTORY_12W = [218,224,229,231,236,240,244,247,243,246,247,247];
const NEW_PER_WEEK   = [12,15,18,14,21,17,19,22,16,18,20,23];
const GONE_PER_WEEK  = [9, 11,13,12,15,14,16,18,11,15,17,19];

const SCATTER = [
  { id:'76654301',a:142,p:168, dist:'Buiucani'},
  { id:'76651872',a:156,p:142, dist:'Durlești'},
  { id:'76612040',a:178,p:195, dist:'Centru'},
  { id:'76598114',a:198,p:245, dist:'Botanica'},
  { id:'76512908',a:84, p:89,  dist:'Râșcani'},
  { id:'76499820',a:165,p:178, dist:'Ciocana'},
  { id:'76481200',a:192,p:220, dist:'Buiucani'},
  { id:'76410012',a:175,p:199, dist:'Durlești'},
  { id:'76344112',a:72, p:115, dist:'Centru'},
  { id:'76389112',a:164,p:189, dist:'Buiucani'},
  { id:'76321119',a:140,p:162, dist:'Botanica'},
  { id:'76288911',a:232,p:295, dist:'Buiucani'},
  { id:'76360118',a:160,p:168, dist:'Durlești'},
  { id:'76358200',a:138,p:155, dist:'Râșcani'},
  { id:'76301044',a:160,p:192, dist:'Centru'},
  { id:'76290818',a:148,p:162, dist:'Ciocana'},
  { id:'76244001',a:215,p:259, dist:'Centru'},
  { id:'76234187',a:206,p:245, dist:'Botanica'},
  { id:'76224812',a:175,p:179, dist:'Ciocana'},
  { id:'76219004',a:142,p:162, dist:'Râșcani'},
];

const DIST_COLORS = {
  'Buiucani':'#0f766e','Botanica':'#6366f1','Centru':'#dc2626',
  'Ciocana':'#d97706','Durlești':'#059669','Râșcani':'#7c3aed',
};

// ---- 50 best-value rows ----------------------------------------------------
const BEST_BUYS_BASE = [
  ['76654301','Casă 4 cam · finisaj recent',         'Buiucani','House',  168000,142,2014, 3,  -1.6, true,  -0.06],
  ['76651872','Casă în 2 nivele · 6 ari',            'Durlești','Villa',  142000,156,2008, 11, -1.5, false,    0],
  ['76612040','Casă 3 dorm · garaj inclus',          'Centru',  'House',  195000,178,2017, 48, -1.3, true,  -0.09],
  ['76499820','Casă nouă · 4 camere',                'Ciocana', 'House',  178000,165,2023, 264,-1.2, false,    0],
  ['76410012','Vilă · două intrări',                 'Durlești','Villa',  199000,175,2019, 432,-1.0, true,  -0.05],
  ['76344112','Casă mică · investiție',              'Centru',  'House',  115000,72, 1985, 552,-1.0, false,    0],
  ['76512908','Casă veche · lot mare',               'Râșcani', 'House',  89000, 84, 1976, 216,-0.9, false,    0],
  ['76481200','Casă · sector vechi 3 niv',           'Buiucani','House',  220000,192,1998, 336,-0.8, false,    0],
  ['76401991','Vilă Botanica · piscină',             'Botanica','Villa',  238000,196,2020, 168,-0.8, false,    0],
  ['76389112','Casă luminoasă · 3 dormitoare',       'Buiucani','House',  189000,164,2016, 96, -0.7, true,  -0.04],
  ['76377004','Casă Telecentru · garaj subteran',    'Centru',  'House',  225000,206,2018, 240,-0.7, false,    0],
  ['76360118','Casă Durlești · finisaj',             'Durlești','Villa',  168000,160,2017, 192,-0.6, false,    0],
  ['76358200','Casă Râșcani · 4 dorm',               'Râșcani', 'House',  155000,138,2010, 312,-0.6, false,    0],
  ['76344002','Vilă Buiucani · sauna',               'Buiucani','Villa',  248000,210,2022, 144,-0.5, false,    0],
  ['76321119','Townhouse Botanica',                  'Botanica','Townhouse',162000,140,2015,408,-0.5,true, -0.03],
  ['76301044','Casă Centru · curte mică',            'Centru',  'House',  192000,160,2008, 528,-0.4, false,    0],
  ['76290818','Casă Ciocana · 3 niveluri',           'Ciocana', 'House',  162000,148,2014, 216,-0.4, false,    0],
  ['76288911','Vilă · piscină · sauna',              'Buiucani','Villa',  295000,232,2024, 72, -0.4, false,    0],
  ['76271882','Casă Durlești · livadă',              'Durlești','Villa',  149000,134,2009, 360,-0.3, true,  -0.02],
  ['76260003','Casă Centru · zona istorică',         'Centru',  'House',  235000,176,1992, 576,-0.3, false,    0],
  ['76251142','Casă Buiucani · curte 4 ari',         'Buiucani','House',  205000,175,2012, 384,-0.3, false,    0],
  ['76244881','Vilă Botanica · finisaj nordic',      'Botanica','Villa',  225000,194,2018, 240,-0.3, false,    0],
  ['76238019','Casă Râșcani · investiție',           'Râșcani', 'House',  98000, 88, 1979, 720,-0.3, false,    0],
  ['76231711','Casă · 4 cam · garaj',                'Ciocana', 'House',  171000,152,2013, 312,-0.2, false,    0],
  ['76224812','Casă Ciocana · finisaj',              'Ciocana', 'House',  179000,175,2017, 192,-0.2, true,  -0.07],
  ['76219004','Casă Râșcani · 3 niv',                'Râșcani', 'House',  162000,142,2014, 264,-0.2, true,  -0.06],
  ['76211118','Casă Buiucani · garaj',               'Buiucani','House',  218000,182,2015, 144,-0.2, true,  -0.05],
  ['76200442','Casă Durlești · cărămidă',            'Durlești','Villa',  131000,138,2007, 336,-0.1, true,  -0.06],
  ['76188207','Casă Centru · curte mică',            'Centru',  'House',  192000,165,2010, 240,-0.1, true,  -0.06],
  ['76174330','Casă veche · investiție',             'Râșcani', 'House',  89000, 78, 1972, 432,-0.1, true,  -0.06],
  ['76170010','Vilă Buiucani · grădină',             'Buiucani','Villa',  255000,206,2021, 168,-0.1, false,    0],
  ['76161188','Vilă Buiucani · sauna',               'Buiucani','Villa',  248000,201,2020, 192, 0.0, true,  -0.04],
  ['76155002','Casă Telecentru · garaj subteran',    'Centru',  'House',  225000,184,2017, 312, 0.0, true,  -0.06],
  ['76150019','Casă Botanica · curte mare',          'Botanica','House',  172000,142,2011, 384, 0.0, true,  -0.05],
  ['76144110','Casă · 4 dormitoare',                 'Ciocana', 'House',  161000,138,2014, 240, 0.1, true,  -0.05],
  ['76132201','Casă Râșcani · garaj dublu',          'Râșcani', 'House',  150000,128,2009, 480, 0.1, true,  -0.05],
  ['76122118','Casă Centru · zonă liniștită',        'Centru',  'House',  208000,170,2008, 336, 0.1, true,  -0.05],
  ['76112007','Casă Durlești · veche, lot mare',     'Durlești','House',  108000,98, 1988, 552, 0.1, false,    0],
  ['76101998','Casă Buiucani · sector nou',          'Buiucani','House',  235000,180,2019, 264, 0.2, false,    0],
  ['76094127','Vilă Botanica · 5 cam',               'Botanica','Villa',  259000,200,2018, 312, 0.2, false,    0],
  ['76088311','Casă Ciocana · garaj',                'Ciocana', 'House',  168000,140,2010, 408, 0.2, false,    0],
  ['76079002','Casă Centru · 5 cam',                 'Centru',  'House',  259000,196,2014, 240, 0.2, true,  -0.07],
  ['76070118','Casă Râșcani · 3 cam',                'Râșcani', 'House',  118000,98, 1992, 600, 0.3, false,    0],
  ['76061114','Casă Durlești · livadă mare',         'Durlești','Villa',  165000,140,2013, 360, 0.3, false,    0],
  ['76055210','Vilă Buiucani · sauna',               'Buiucani','Villa',  278000,210,2022, 192, 0.3, false,    0],
  ['76046009','Casă Botanica · 4 dorm',              'Botanica','House',  185000,150,2012, 432, 0.3, true,  -0.04],
  ['76038112','Casă Ciocana · curte 3 ari',          'Ciocana', 'House',  176000,142,2015, 288, 0.4, false,    0],
  ['76029118','Casă Centru · 3 dorm + birou',        'Centru',  'House',  235000,178,2016, 312, 0.4, false,    0],
  ['76022004','Casă Râșcani · finisaj',              'Râșcani', 'House',  148000,118,2011, 264, 0.4, true,  -0.03],
  ['76015011','Casă Durlești · finisaj nordic',      'Durlești','Villa',  192000,160,2018, 240, 0.4, false,    0],
];
const BEST_BUYS = BEST_BUYS_BASE.map(([id, title, dist, type, price, area, year, daysOnMkt, z, drop, dropPct]) => ({
  id, title, district: dist, type, priceEur: price, areaSqm: area, yearBuilt: year,
  daysOnMkt, eurPerSqm: Math.round(price/area),
  medianEurPerSqm: HEATMAP[dist]['3'],
  discount: Math.round((1 - (price/area) / HEATMAP[dist]['3']) * 100),
  z, score: Math.round((-z + (daysOnMkt < 24 ? 0.4 : daysOnMkt < 168 ? 0.2 : 0) + Math.abs(dropPct)*4) * 10) / 10,
  priceDrop: drop, dropPct,
}));

// ---- 50 price-drop rows ----------------------------------------------------
const PRICE_DROPS_BASE = [
  ['76654301','Casă 4 cam · finisaj recent','Buiucani','House',179000,168000, 11, '3h'],
  ['76612040','Casă 3 dorm · garaj inclus','Centru','House',215000,195000, 9, '2d'],
  ['76410012','Vilă · două intrări','Durlești','Villa',209000,199000, 5, '8d'],
  ['76389112','Casă luminoasă · 3 dorm','Buiucani','House',198000,189000, 5, '4d'],
  ['76321119','Townhouse Botanica','Botanica','Townhouse',168000,162000, 4, '17d'],
  ['76271882','Casă Durlești · livadă','Durlești','Villa',155000,149000, 4, '15d'],
  ['76244001','Casă Centru · 5 cam','Centru','House',278000,259000, 7, '12d'],
  ['76234187','Vilă Botanica · piscină','Botanica','Villa',261000,245000, 6, '5d'],
  ['76224812','Casă Ciocana · finisaj','Ciocana','House',192000,179000, 7, '9d'],
  ['76219004','Casă Râșcani · 3 niv','Râșcani','House',172000,162000, 6, '11d'],
  ['76211118','Casă Buiucani · garaj','Buiucani','House',229000,218000, 5, '6d'],
  ['76200442','Casă Durlești · cărămidă','Durlești','Villa',139000,131000, 6, '14d'],
  ['76188207','Casă Centru · curte mică','Centru','House',205000,192000, 6, '10d'],
  ['76174330','Casă veche · investiție','Râșcani','House',95000,89000, 6, '18d'],
  ['76161188','Vilă Buiucani · sauna','Buiucani','Villa',259000,248000, 4, '7d'],
  ['76155002','Casă Telecentru · garaj subteran','Centru','House',239000,225000, 6, '13d'],
  ['76150019','Casă Botanica · curte mare','Botanica','House',182000,172000, 5, '16d'],
  ['76144110','Casă · 4 dormitoare','Ciocana','House',169000,161000, 5, '8d'],
  ['76132201','Casă Râșcani · garaj dublu','Râșcani','House',158000,150000, 5, '20d'],
  ['76122118','Casă Centru · zonă liniștită','Centru','House',218000,208000, 5, '14d'],
  ['76118007','Vilă Buiucani · sauna','Buiucani','Villa',289000,275000, 5, '21d'],
  ['76112002','Casă Durlești · 5 cam','Durlești','Villa',182000,172000, 5, '19d'],
  ['76104881','Casă Botanica · 3 cam','Botanica','House',169000,161000, 5, '22d'],
  ['76098110','Casă Centru · 4 cam','Centru','House',248000,235000, 5, '23d'],
  ['76092002','Casă Râșcani · garaj','Râșcani','House',132000,126000, 5, '17d'],
  ['76088012','Casă Ciocana · 3 niv','Ciocana','House',184000,176000, 4, '24d'],
  ['76081119','Vilă Buiucani · grădină','Buiucani','Villa',262000,251000, 4, '11d'],
  ['76074002','Casă Durlești · finisaj','Durlești','Villa',158000,151000, 4, '25d'],
  ['76067112','Casă Botanica · 4 dorm','Botanica','House',192000,184000, 4, '13d'],
  ['76061224','Casă Centru · investiție','Centru','House',158000,151000, 4, '20d'],
  ['76055118','Casă Râșcani · 3 cam','Râșcani','House',122000,117000, 4, '15d'],
  ['76048007','Casă Ciocana · 4 cam','Ciocana','House',172000,165000, 4, '12d'],
  ['76042002','Casă Buiucani · 4 cam','Buiucani','House',218000,209000, 4, '26d'],
  ['76036118','Vilă Durlești · livadă','Durlești','Villa',192000,184000, 4, '18d'],
  ['76029002','Casă Botanica · curte','Botanica','House',158000,152000, 4, '8d'],
  ['76024110','Casă Centru · 3 dorm','Centru','House',229000,220000, 4, '27d'],
  ['76018004','Casă Râșcani · 4 cam','Râșcani','House',148000,142000, 4, '10d'],
  ['76011007','Casă Ciocana · finisaj','Ciocana','House',162000,155000, 4, '15d'],
  ['76004118','Casă Buiucani · vechi','Buiucani','House',172000,165000, 4, '28d'],
  ['75998002','Casă Durlești · 5 cam','Durlești','Villa',172000,165000, 4, '21d'],
  ['75991110','Casă Botanica · 4 cam','Botanica','House',182000,175000, 4, '11d'],
  ['75984007','Casă Centru · 4 dorm','Centru','House',265000,255000, 4, '13d'],
  ['75978002','Casă Râșcani · 4 cam','Râșcani','House',138000,133000, 4, '24d'],
  ['75972118','Casă Ciocana · 4 dorm','Ciocana','House',179000,172000, 4, '18d'],
  ['75965004','Casă Buiucani · garaj','Buiucani','House',225000,217000, 4, '9d'],
  ['75959007','Vilă Botanica · piscină','Botanica','Villa',285000,275000, 4, '17d'],
  ['75952118','Casă Centru · 5 cam','Centru','House',272000,262000, 4, '22d'],
  ['75946002','Casă Râșcani · curte','Râșcani','House',125000,121000, 3, '25d'],
  ['75940110','Casă Durlești · finisaj','Durlești','Villa',168000,162000, 4, '12d'],
  ['75934007','Casă Ciocana · 3 niv','Ciocana','House',172000,166000, 3, '20d'],
];
const PRICE_DROPS = PRICE_DROPS_BASE.map(r => ({
  id: r[0], title: r[1], district: r[2], type: r[3],
  priceWas: r[4], priceEur: r[5], dropPct: r[6], when: r[7],
  dropEur: r[4] - r[5],
}));

// ============================================================================
// Charts
// ============================================================================
function MultiLineChart({ series, w = 640, h = 220 }) {
  const padL = 44, padR = 12, padT = 12, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const all = Object.values(series).flat();
  const yMax = Math.ceil(Math.max(...all) / 100) * 100;
  const yMin = Math.floor(Math.min(...all) / 100) * 100;
  const span = Math.max(yMax - yMin, 1);
  const len = MONTHS.length;
  const xs = MONTHS.map((_, i) => padL + (i / (len - 1)) * innerW);
  const yScale = (v) => padT + (1 - (v - yMin) / span) * innerH;
  const yTicks = [yMin, yMin + span/4, yMin + span/2, yMin + (3*span)/4, yMax];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={yScale(t)} x2={w - padR} y2={yScale(t)} stroke="#f3f4f6" strokeWidth="1"/>
          <text x={padL - 6} y={yScale(t) + 3} fontSize="10" fill="#9ca3af" textAnchor="end" className="tabular-nums">€{Math.round(t)}</text>
        </g>
      ))}
      {MONTHS.map((m, i) => i % 2 === 0 ? (
        <text key={m} x={xs[i]} y={h - 8} fontSize="10" fill="#9ca3af" textAnchor="middle">{m}</text>
      ) : null)}
      {Object.entries(series).map(([name, vals]) => {
        const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i]},${yScale(v)}`).join(' ');
        return (
          <g key={name}>
            <path d={d} fill="none" stroke={DIST_COLORS[name] || '#0f766e'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx={xs[len-1]} cy={yScale(vals[len-1])} r="3" fill={DIST_COLORS[name] || '#0f766e'}/>
          </g>
        );
      })}
    </svg>
  );
}

function Heatmap({ data = HEATMAP }) {
  const all = A_DISTRICTS.flatMap(d => A_ROOMS.map(r => data[d][r]));
  const min = Math.min(...all), max = Math.max(...all);
  const tone = (v) => {
    const t = (v - min) / (max - min);
    return `oklch(${(0.97 - t*0.32).toFixed(3)} ${0.04 + t*0.10} 195)`;
  };
  return (
    <div className="overflow-hidden rounded-md ring-1 ring-neutral-200">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-neutral-50">
            <th className="px-3 py-2 text-left font-semibold text-neutral-500 text-[10.5px] uppercase tracking-wider">District</th>
            {A_ROOMS.map(r => (
              <th key={r} className="px-2 py-2 text-right font-semibold text-neutral-500 text-[10.5px] uppercase tracking-wider">{r} rooms</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {A_DISTRICTS.map(d => (
            <tr key={d} className="border-t border-neutral-200">
              <td className="px-3 py-2 font-medium text-neutral-700">{d}</td>
              {A_ROOMS.map(r => (
                <td key={r} className="px-2 py-2 text-right tabular-nums" style={{ background: tone(data[d][r]) }}>
                  €{data[d][r]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Scatter({ data = SCATTER, w = 460, h = 240 }) {
  const padL = 40, padR = 12, padT = 10, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const xMax = 250, xMin = 50, yMax = 320, yMin = 50;
  const xScale = (v) => padL + ((v - xMin) / (xMax - xMin)) * innerW;
  const yScale = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;
  const medianAt = (a) => Math.round(a * 1.3);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {[100,150,200,250,300].map(t => (
        <g key={t}>
          <line x1={padL} y1={yScale(t)} x2={w-padR} y2={yScale(t)} stroke="#f3f4f6" strokeWidth="1"/>
          <text x={padL-6} y={yScale(t)+3} fontSize="10" fill="#9ca3af" textAnchor="end">€{t}k</text>
        </g>
      ))}
      {[75,125,175,225].map(t => (
        <text key={t} x={xScale(t)} y={h-8} fontSize="10" fill="#9ca3af" textAnchor="middle">{t}m²</text>
      ))}
      <path d={`M${xScale(50)},${yScale(medianAt(50)*1.15)} L${xScale(250)},${yScale(medianAt(250)*1.15)} L${xScale(250)},${yScale(medianAt(250)*0.85)} L${xScale(50)},${yScale(medianAt(50)*0.85)} Z`}
            fill="#0f766e" fillOpacity="0.07"/>
      <line x1={xScale(50)} y1={yScale(medianAt(50))} x2={xScale(250)} y2={yScale(medianAt(250))} stroke="#0f766e" strokeWidth="1" strokeDasharray="3 3"/>
      {data.map(pt => (
        <circle key={pt.id} cx={xScale(pt.a)} cy={yScale(pt.p)} r="4"
                fill={DIST_COLORS[pt.dist] || '#0f766e'} fillOpacity="0.85"
                stroke="#fff" strokeWidth="1"/>
      ))}
      <text x={xScale(60)} y={yScale(medianAt(60))-6} fontSize="10" fill="#0f766e">market median ±15%</text>
    </svg>
  );
}

function DOMHistogram() {
  const max = Math.max(...DOM_BUCKETS.map(b => b.count));
  return (
    <div className="space-y-2">
      {DOM_BUCKETS.map(b => (
        <div key={b.label} className="flex items-center gap-3 text-[12px]">
          <span className="w-14 text-neutral-600 tabular-nums">{b.label}</span>
          <div className="flex-1 h-4 rounded bg-neutral-100 overflow-hidden">
            <div className={cx('h-full rounded',
              b.hot ? 'bg-teal-600' : b.stale ? 'bg-amber-500' : 'bg-neutral-400')}
              style={{width: `${(b.count/max)*100}%`}}/>
          </div>
          <span className="w-8 text-right tabular-nums text-neutral-700">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

function FlowChart() {
  const w = 380, h = 180, padL = 36, padR = 8, padT = 10, padB = 24;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const yMax = Math.max(...INVENTORY_12W) + 10, yMin = 0;
  const span = yMax - yMin;
  const xs = INVENTORY_12W.map((_, i) => padL + (i / (INVENTORY_12W.length - 1)) * innerW);
  const yScale = (v) => padT + (1 - (v - yMin) / span) * innerH;
  const barW = innerW / INVENTORY_12W.length / 2.4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {[0,80,160,240].map(t => (
        <g key={t}>
          <line x1={padL} y1={yScale(t)} x2={w-padR} y2={yScale(t)} stroke="#f3f4f6" strokeWidth="1"/>
          <text x={padL-6} y={yScale(t)+3} fontSize="10" fill="#9ca3af" textAnchor="end">{t}</text>
        </g>
      ))}
      {INVENTORY_12W.map((_, i) => (
        <g key={i}>
          <rect x={xs[i]-barW-1} y={yScale(NEW_PER_WEEK[i])} width={barW} height={yScale(0) - yScale(NEW_PER_WEEK[i])} fill="#0f766e" rx="1"/>
          <rect x={xs[i]+1} y={yScale(GONE_PER_WEEK[i])} width={barW} height={yScale(0) - yScale(GONE_PER_WEEK[i])} fill="#f59e0b" rx="1"/>
        </g>
      ))}
      <path d={INVENTORY_12W.map((v,i)=>`${i===0?'M':'L'}${xs[i]},${yScale(v)}`).join(' ')}
            fill="none" stroke="#111827" strokeWidth="1.6"/>
      {INVENTORY_12W.map((v,i) => <circle key={i} cx={xs[i]} cy={yScale(v)} r="2" fill="#111827"/>)}
      <g transform={`translate(${padL}, ${h-6})`}>
        <rect x="0" y="-10" width="8" height="8" fill="#0f766e"/>
        <text x="12" y="-3" fontSize="10" fill="#525252">new</text>
        <rect x="50" y="-10" width="8" height="8" fill="#f59e0b"/>
        <text x="62" y="-3" fontSize="10" fill="#525252">gone</text>
        <line x1="100" y1="-6" x2="115" y2="-6" stroke="#111827" strokeWidth="1.6"/>
        <text x="120" y="-3" fontSize="10" fill="#525252">active</text>
      </g>
    </svg>
  );
}

// ============================================================================
// Filter primitives
// ============================================================================
function FilterGroupVertical({ label, value, setValue, options }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map(o => (
          <button key={o} onClick={()=>setValue(o)}
            className={cx('rounded-md px-2 py-1 text-[12px] ring-1 ring-inset',
              value === o ? 'bg-neutral-900 text-white ring-neutral-900' : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50')}>
            {o === 'all' ? 'All' : o}
          </button>
        ))}
      </div>
    </div>
  );
}
function Segmented({ options, value, setValue }) {
  return (
    <div className="inline-flex rounded-md bg-neutral-100 p-0.5">
      {options.map(o => (
        <button key={o} onClick={()=>setValue(o)}
          className={cx('rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium',
            value === o ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200/60' : 'text-neutral-500 hover:text-neutral-900')}>
          {o}
        </button>
      ))}
    </div>
  );
}
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      {A_DISTRICTS.map(d => (
        <span key={d} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{background: DIST_COLORS[d]}}/>
          <span className="text-neutral-600">{d}</span>
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// Tables
// ============================================================================
function ScoreBar({ score }) {
  const pct = Math.min(Math.max(score, 0), 3) / 3 * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-neutral-100 overflow-hidden">
        <div className="h-full rounded-full bg-teal-600" style={{width: `${pct}%`}}/>
      </div>
      <span className="font-mono tabular-nums text-[11px] text-neutral-700">{score.toFixed(1)}</span>
    </div>
  );
}

function BestBuysTable({ rows, compact, fullCols, startRank = 1, onRowClick }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
          <th className="py-2 w-8">Rank</th>
          <th className="py-2">Listing</th>
          {!compact && <th className="py-2">Type</th>}
          <th className="py-2">District</th>
          <th className="py-2 text-right">Price</th>
          <th className="py-2 text-right">€/m²</th>
          <th className="py-2 text-right">vs median</th>
          {fullCols && <th className="py-2 text-right">Year</th>}
          {fullCols && <th className="py-2 text-right">DOM</th>}
          {fullCols && <th className="py-2 text-right">Drop</th>}
          <th className="py-2 w-32">Score</th>
          {fullCols && <th className="py-2 w-6"></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {rows.map((r, i) => (
          <tr key={r.id} className={cx('hover:bg-neutral-50', onRowClick && 'cursor-pointer')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            <td className="py-1.5 tabular-nums text-neutral-400">#{startRank + i}</td>
            <td className="py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[11px] text-neutral-400">{r.id.slice(-4)}</span>
                <span className="truncate text-neutral-800 max-w-[220px]">{r.title}</span>
                {r.priceDrop && <Badge variant="warning">drop</Badge>}
              </div>
            </td>
            {!compact && <td className="py-1.5"><Badge variant="outline">{r.type}</Badge></td>}
            <td className="py-1.5 text-neutral-600">{r.district}</td>
            <td className="py-1.5 text-right tabular-nums font-medium">{fmt.eur(r.priceEur)}</td>
            <td className="py-1.5 text-right tabular-nums text-neutral-600">€{r.eurPerSqm}</td>
            <td className="py-1.5 text-right">
              <span className={cx('tabular-nums font-medium', r.discount >= 15 ? 'text-emerald-700' : r.discount >= 8 ? 'text-teal-700' : 'text-neutral-600')}>
                {r.discount}% under
              </span>
            </td>
            {fullCols && <td className="py-1.5 text-right tabular-nums text-neutral-500">{r.yearBuilt}</td>}
            {fullCols && <td className="py-1.5 text-right tabular-nums text-neutral-500">{r.daysOnMkt < 24 ? `${r.daysOnMkt}h` : `${Math.round(r.daysOnMkt/24)}d`}</td>}
            {fullCols && <td className="py-1.5 text-right">{r.priceDrop ? <span className="tabular-nums text-amber-700">{Math.round(r.dropPct*-100)}%</span> : <span className="text-neutral-300">—</span>}</td>}
            <td className="py-1.5"><ScoreBar score={r.score}/></td>
            {fullCols && <td className="py-1.5 text-neutral-300">›</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PriceDropsTable({ rows, compact, fullCols, startRank = 1, onRowClick }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
          <th className="py-2 w-8">Rank</th>
          <th className="py-2">Listing</th>
          {!compact && <th className="py-2">Type</th>}
          <th className="py-2">District</th>
          <th className="py-2 text-right">Was</th>
          <th className="py-2 text-right">Now</th>
          <th className="py-2 text-right">Drop</th>
          {fullCols && <th className="py-2 text-right">Δ €</th>}
          {fullCols && <th className="py-2 text-right">When</th>}
          {fullCols && <th className="py-2 w-6"></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {rows.map((r, i) => (
          <tr key={r.id} className={cx('hover:bg-neutral-50', onRowClick && 'cursor-pointer')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            <td className="py-1.5 tabular-nums text-neutral-400">#{startRank + i}</td>
            <td className="py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-neutral-400">{r.id.slice(-4)}</span>
                <span className="truncate text-neutral-800 max-w-[220px]">{r.title}</span>
              </div>
            </td>
            {!compact && <td className="py-1.5"><Badge variant="outline">{r.type}</Badge></td>}
            <td className="py-1.5 text-neutral-600">{r.district}</td>
            <td className="py-1.5 text-right tabular-nums text-neutral-400 line-through">{fmt.eur(r.priceWas)}</td>
            <td className="py-1.5 text-right tabular-nums font-medium">{fmt.eur(r.priceEur)}</td>
            <td className="py-1.5 text-right">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700 text-[11px] font-semibold tabular-nums">
                ↓ {r.dropPct}%
              </span>
            </td>
            {fullCols && <td className="py-1.5 text-right tabular-nums text-neutral-500">−€{(r.dropEur/1000).toFixed(0)}k</td>}
            {fullCols && <td className="py-1.5 text-right tabular-nums text-neutral-500">{r.when}</td>}
            {fullCols && <td className="py-1.5 text-neutral-300">›</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// Tabs bar — sits under the page header
// ============================================================================
function Tabs({ tab, setTab }) {
  const tabs = [
    { id: 'overview',   label: 'Overview',     count: null },
    { id: 'best-buys',  label: 'Best buys',    count: BEST_BUYS.length },
    { id: 'price-drops',label: 'Price drops',  count: PRICE_DROPS.length },
  ];
  return (
    <div className="-mt-2 mb-5 border-b border-neutral-200">
      <div className="flex gap-1">
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={cx('relative px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                active ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-800')}>
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                {t.count != null && (
                  <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    active ? 'bg-teal-50 text-teal-700' : 'bg-neutral-100 text-neutral-500')}>
                    {t.count}
                  </span>
                )}
              </span>
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neutral-900"/>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// OVERVIEW (= old "trends deep-dive" mock B, plus drillable Top-N previews)
// ============================================================================
function AnalyticsOverview({ region, setRegion, type, setType, rooms, setRooms, onTab }) {
  return (
    <div>
      <Card padding={false} className="mb-5">
        <div className="grid grid-cols-5 divide-x divide-neutral-200">
          <div className="p-4"><KStat label="Median €/m²" value="€1,310" hint="all active · +6.2% YoY" tone="accent"/></div>
          <div className="p-4"><KStat label="Active inventory" value="247" hint="+4 this week"/></div>
          <div className="p-4"><KStat label="Median DOM" value="22d" hint="−3d MoM"/></div>
          <div className="p-4"><KStat label="Best deals" value={BEST_BUYS.filter(r=>r.discount>=15).length} hint="≥ 15% under district median"/></div>
          <div className="p-4"><KStat label="Recent drops" value={PRICE_DROPS.length} hint="last 30 days"/></div>
        </div>
      </Card>

      <div className="grid grid-cols-[260px_1fr] gap-5 mb-5">
        <Card className="self-start">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Filters</div>
          <div className="space-y-4 text-[13px]">
            <FilterGroupVertical label="Region" value={region} setValue={setRegion} options={['all', ...A_DISTRICTS]}/>
            <FilterGroupVertical label="Property type" value={type} setValue={setType} options={['all', ...A_TYPES]}/>
            <FilterGroupVertical label="Rooms" value={rooms} setValue={setRooms} options={['all', ...A_ROOMS]}/>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Price range</div>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="tabular-nums text-neutral-600">€50k</span>
                <input type="range" className="flex-1 accent-teal-600" defaultValue="250"/>
                <span className="tabular-nums text-neutral-600">€250k</span>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Year built</div>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="tabular-nums text-neutral-600">1970</span>
                <input type="range" className="flex-1 accent-teal-600" defaultValue="1990"/>
                <span className="tabular-nums text-neutral-600">2024</span>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionHeader title="€/m² trend by district" hint="last 12 months"
              right={<Legend/>}/>
            <MultiLineChart series={region === 'all' ? TREND_BY_DISTRICT : { [region]: TREND_BY_DISTRICT[region] }}/>
          </Card>

          <div className="grid grid-cols-2 gap-5">
            <Card>
              <SectionHeader title="Inventory & flow" hint="new vs gone, weekly"/>
              <FlowChart/>
            </Card>
            <Card>
              <SectionHeader title="Days on market"/>
              <DOMHistogram/>
            </Card>
          </div>

          <Card>
            <SectionHeader title="Price vs area" hint="active listings · median band ±15%"/>
            <Scatter/>
            <p className="mt-2 text-[11px] text-neutral-500">Points well below the dashed line are candidates — find them ranked under <button onClick={()=>onTab('best-buys')} className="underline text-teal-700 hover:text-teal-800">Best buys</button>.</p>
          </Card>

          <Card>
            <SectionHeader title="€/m² heatmap" hint="district × room count · current"/>
            <Heatmap/>
          </Card>
        </div>
      </div>

      {/* Drill-down previews */}
      <div className="grid grid-cols-2 gap-5">
        <Card>
          <SectionHeader title="Top 20 best options to buy now" hint="ranked by composite score"
            right={<button onClick={()=>onTab('best-buys')} className="text-[12px] font-medium text-teal-700 hover:text-teal-800">View all 50 →</button>}/>
          <BestBuysTable rows={BEST_BUYS.slice(0,10)} compact onRowClick={()=>onTab('best-buys')}/>
          <div className="mt-3 text-center">
            <button onClick={()=>onTab('best-buys')} className="text-[12px] font-medium text-neutral-600 hover:text-neutral-900">
              + 40 more · open Best buys tab →
            </button>
          </div>
        </Card>
        <Card>
          <SectionHeader title="Top 20 recent price drops" hint="last 30 days"
            right={<button onClick={()=>onTab('price-drops')} className="text-[12px] font-medium text-teal-700 hover:text-teal-800">View all 50 →</button>}/>
          <PriceDropsTable rows={PRICE_DROPS.slice(0,10)} compact onRowClick={()=>onTab('price-drops')}/>
          <div className="mt-3 text-center">
            <button onClick={()=>onTab('price-drops')} className="text-[12px] font-medium text-neutral-600 hover:text-neutral-900">
              + 40 more · open Price drops tab →
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// BEST BUYS TAB — full ranked list, paged-feel
// ============================================================================
function AnalyticsBestBuys({ region, setRegion, type, setType, rooms, setRooms }) {
  const [sort, setSort] = aUseState('Score');
  const filtered = aUseMemo(() => {
    let r = BEST_BUYS;
    if (region !== 'all') r = r.filter(x => x.district === region);
    if (type !== 'all')   r = r.filter(x => x.type === type);
    const s = [...r];
    if (sort === 'Discount') s.sort((a,b)=>b.discount-a.discount);
    else if (sort === '€/m²') s.sort((a,b)=>a.eurPerSqm-b.eurPerSqm);
    else if (sort === 'Newest') s.sort((a,b)=>a.daysOnMkt-b.daysOnMkt);
    else s.sort((a,b)=>b.score-a.score);
    return s;
  }, [region, type, sort]);

  return (
    <div>
      <Card padding={false} className="mb-5">
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-4"><KStat label="Below median" value={BEST_BUYS.filter(r=>r.discount>=5).length} hint="discount ≥ 5%"/></div>
          <div className="p-4"><KStat label="Strong candidates" value={BEST_BUYS.filter(r=>r.discount>=15).length} tone="accent" hint="≥ 15% under median"/></div>
          <div className="p-4"><KStat label="Avg discount" value={`−${Math.round(BEST_BUYS.reduce((s,r)=>s+r.discount,0)/BEST_BUYS.length)}%`} hint="vs district median"/></div>
          <div className="p-4"><KStat label="With recent drop" value={BEST_BUYS.filter(r=>r.priceDrop).length} hint="of 50"/></div>
        </div>
      </Card>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        <Card className="self-start">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Filters</div>
          <div className="space-y-4">
            <FilterGroupVertical label="Region" value={region} setValue={setRegion} options={['all', ...A_DISTRICTS]}/>
            <FilterGroupVertical label="Property type" value={type} setValue={setType} options={['all', ...A_TYPES]}/>
            <FilterGroupVertical label="Rooms" value={rooms} setValue={setRooms} options={['all', ...A_ROOMS]}/>
          </div>
        </Card>

        <Card>
          <SectionHeader title={`Best options to buy now — ${filtered.length} of ${BEST_BUYS.length}`} hint="ranked by composite score (€/m² discount + freshness + drop signal)"
            right={<div className="flex items-center gap-2 text-[12px]">
              <span className="text-neutral-500">Sort</span>
              <Segmented options={['Score','Discount','Newest','€/m²']} value={sort} setValue={setSort}/>
            </div>}/>
          <BestBuysTable rows={filtered} fullCols onRowClick={()=>{}}/>
          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-[12px] text-neutral-500">
            <span>Showing 1–{filtered.length} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" disabled>← Prev</Button>
              <Button size="sm" variant="secondary" disabled>Next →</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// PRICE DROPS TAB
// ============================================================================
function AnalyticsPriceDrops({ region, setRegion, type, setType, rooms, setRooms }) {
  const [sort, setSort] = aUseState('% drop');
  const [period, setPeriod] = aUseState('30d');
  const filtered = aUseMemo(() => {
    let r = PRICE_DROPS;
    if (region !== 'all') r = r.filter(x => x.district === region);
    if (type !== 'all')   r = r.filter(x => x.type === type);
    const s = [...r];
    if (sort === '€ drop') s.sort((a,b)=>b.dropEur-a.dropEur);
    else if (sort === 'Newest') s.sort((a,b)=>parseInt(a.when)-parseInt(b.when));
    else s.sort((a,b)=>b.dropPct-a.dropPct);
    return s;
  }, [region, type, sort]);

  return (
    <div>
      <Card padding={false} className="mb-5">
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-4"><KStat label="Drops in 30d" value={PRICE_DROPS.length} tone="accent"/></div>
          <div className="p-4"><KStat label="Median drop" value="5%" hint="of original price"/></div>
          <div className="p-4"><KStat label="Total cut" value={`€${Math.round(PRICE_DROPS.reduce((s,r)=>s+r.dropEur,0)/1000)}k`} hint="across all drops"/></div>
          <div className="p-4"><KStat label="Drops this week" value={PRICE_DROPS.filter(r=>parseInt(r.when)<=7).length} hint="fresh signal"/></div>
        </div>
      </Card>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        <Card className="self-start">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Filters</div>
          <div className="space-y-4">
            <FilterGroupVertical label="Region" value={region} setValue={setRegion} options={['all', ...A_DISTRICTS]}/>
            <FilterGroupVertical label="Property type" value={type} setValue={setType} options={['all', ...A_TYPES]}/>
            <FilterGroupVertical label="Rooms" value={rooms} setValue={setRooms} options={['all', ...A_ROOMS]}/>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Period</div>
              <Segmented options={['7d','30d','90d']} value={period} setValue={setPeriod}/>
            </div>
          </div>
        </Card>

        <Card>
          <SectionHeader title={`Recent price drops — ${filtered.length} of ${PRICE_DROPS.length}`} hint="last 30 days · ranked"
            right={<div className="flex items-center gap-2 text-[12px]">
              <span className="text-neutral-500">Sort</span>
              <Segmented options={['% drop','€ drop','Newest']} value={sort} setValue={setSort}/>
            </div>}/>
          <PriceDropsTable rows={filtered} fullCols onRowClick={()=>{}}/>
          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-[12px] text-neutral-500">
            <span>Showing 1–{filtered.length} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" disabled>← Prev</Button>
              <Button size="sm" variant="secondary" disabled>Next →</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// HOST PAGE — manages tab state, header chrome
// ============================================================================
function AnalyticsPage({ initialTab = 'overview' }) {
  const [tab, setTab] = aUseState(initialTab);
  const [region, setRegion] = aUseState('all');
  const [type, setType] = aUseState('all');
  const [rooms, setRooms] = aUseState('all');

  const subtitle = {
    'overview':    'Market signals across active listings · 999.md · last 12 months',
    'best-buys':   '50 listings ranked by deviation from district median, freshness, and recent drops',
    'price-drops': '50 listings whose price was reduced in the last 30 days',
  }[tab];

  return (
    <div data-screen-label={`Analytics — ${tab}`}>
      <PageHeader
        title="Analytics"
        subtitle={subtitle}
        actions={<>
          <Button variant="secondary" size="md">Export CSV</Button>
          <Button variant="secondary" size="md">Save view</Button>
        </>}
      />
      <Tabs tab={tab} setTab={setTab}/>
      {tab === 'overview' &&
        <AnalyticsOverview region={region} setRegion={setRegion} type={type} setType={setType} rooms={rooms} setRooms={setRooms} onTab={setTab}/>}
      {tab === 'best-buys' &&
        <AnalyticsBestBuys region={region} setRegion={setRegion} type={type} setType={setType} rooms={rooms} setRooms={setRooms}/>}
      {tab === 'price-drops' &&
        <AnalyticsPriceDrops region={region} setRegion={setRegion} type={type} setType={setType} rooms={rooms} setRooms={setRooms}/>}
    </div>
  );
}

Object.assign(window, { AnalyticsPage });

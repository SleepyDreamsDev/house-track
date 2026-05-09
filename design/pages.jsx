// All four redesigned pages
const { useState: useStateP, useMemo: useMemoP } = React;

// =================================================================
// DASHBOARD — leads-first
// =================================================================
function DashboardPage({ density }) {
  const newToday = window.MOCK_LISTINGS.filter(l => Date.now() - new Date(l.firstSeenAt).getTime() < 24*3600*1000);
  const drops = window.MOCK_LISTINGS.filter(l => l.priceDrop);
  const total = 247;
  const active = 188;
  const avgPrice = 174_500;
  const successRate = window.MOCK_SUCCESS_RATE_24H;

  return (
    <div className="space-y-7" data-screen-label="Dashboard">
      <PageHeader
        title="Dashboard"
        subtitle="Wednesday, May 3 · last sweep 18 min ago"
        actions={
          <>
            <Button variant="secondary" size="md"><IconExternal className="h-4 w-4"/>Open Grafana</Button>
            <Button variant="primary" size="md"><IconPlay className="h-4 w-4"/>Run sweep now</Button>
          </>
        }
      />

      {/* KPI strip */}
      <Card padding={false}>
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-5"><KStat label="Active listings" value={fmt.num(active)} hint={`${total} total`} trend={<Sparkline data={MOCK_NEW_PER_DAY}/>} /></div>
          <div className="p-5"><KStat label="New today" value={newToday.length} hint="2 in last 6h" tone="accent" /></div>
          <div className="p-5"><KStat label="Avg price" value={fmt.eur(avgPrice)} hint="−3.1% vs last week" /></div>
          <div className="p-5"><KStat label="Sweep success" value={`${Math.round(successRate*100)}%`} hint="last 24h · 23/24 ok" /></div>
        </div>
      </Card>

      {/* Two-column body: leads (primary) + crawler health (secondary) */}
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <div>
            <SectionHeader
              title="New today"
              hint={`${newToday.length} listings since 00:00`}
              right={<Button variant="ghost" size="sm">View all houses →</Button>}
            />
            <div className="space-y-2.5">
              {newToday.map(l => <LeadRow key={l.id} listing={l} kind="new"/>)}
              {newToday.length === 0 && (
                <div className="rounded-md bg-white py-8 text-center text-sm text-neutral-500 ring-1 ring-neutral-200">
                  No new listings yet today
                </div>
              )}
            </div>
          </div>

          <div>
            <SectionHeader title="Price drops" hint={`${drops.length} this week`} />
            <div className="space-y-2.5">
              {drops.map(l => <LeadRow key={l.id} listing={l} kind="drop"/>)}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <Card>
            <SectionHeader title="Crawler health" />
            <div className="space-y-3.5">
              <HealthRow label="Last sweep" value={
                <span className="flex items-center gap-1.5">
                  <Badge variant="success"><IconCheck className="h-3 w-3"/>success</Badge>
                  <span className="text-xs text-neutral-500">8.1s</span>
                </span>
              }/>
              <HealthRow label="Circuit breaker" value={<Badge variant="success">closed</Badge>}/>
              <HealthRow label="Next sweep" value={<span className="font-mono text-[12px] text-neutral-700">in 46m</span>}/>
              <HealthRow label="Sources" value={<span className="text-[12px] text-neutral-700">1 active · 2 disabled</span>}/>
            </div>
          </Card>

          <Card>
            <SectionHeader title="By district" hint="active · €/m² avg"/>
            <div className="space-y-2">
              {[
                ['Buiucani', 12, 1180],
                ['Botanica', 38, 1340],
                ['Centru', 24, 1620],
                ['Ciocana', 19, 980],
                ['Durlești', 31, 870],
                ['Râșcani', 14, 1090],
              ].map(([name, n, eurm2]) => (
                <DistrictBar key={name} name={name} count={n} eurm2={eurm2} max={38}/>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader title="New listings · 7d"/>
            <div className="flex items-end justify-between gap-1 h-20">
              {MOCK_NEW_PER_DAY.map((v, i) => {
                const max = Math.max(...MOCK_NEW_PER_DAY);
                const h = Math.max(8, Math.round((v/max)*72));
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-[10px] tabular-nums text-neutral-500">{v}</div>
                    <div className={cx('w-full rounded-t-sm', i === MOCK_NEW_PER_DAY.length-1 ? 'bg-teal-600' : 'bg-neutral-300')} style={{height: h}}/>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-neutral-400">
              <span>Apr 27</span><span>today</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-neutral-500">{label}</span>
      {value}
    </div>
  );
}

function DistrictBar({ name, count, eurm2, max }) {
  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="w-20 text-neutral-700">{name}</span>
      <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div className="h-full rounded-full bg-teal-500" style={{width: `${(count/max)*100}%`}}/>
      </div>
      <span className="w-7 text-right tabular-nums text-neutral-500">{count}</span>
      <span className="w-14 text-right tabular-nums text-neutral-400">€{eurm2}</span>
    </div>
  );
}

function LeadRow({ listing: l, kind }) {
  const drop = l.priceWas && l.priceWas > l.priceEur ? Math.round((1 - l.priceEur/l.priceWas)*100) : null;
  const eurPerSqm = Math.round(l.priceEur / l.areaSqm);
  return (
    <div className="group flex items-center gap-4 rounded-lg bg-white p-3 ring-1 ring-neutral-200 hover:ring-neutral-300 hover:shadow-sm transition-all">
      <PhotoPlaceholder id={l.id} className="h-16 w-24 shrink-0" label="999.md"/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {kind === 'new' && <Badge variant="accent">NEW · {fmt.rel(l.firstSeenAt)}</Badge>}
          {kind === 'drop' && <Badge variant="warning"><IconArrowDown className="h-3 w-3"/>−{drop}%</Badge>}
          {l.flags?.includes('below median €/m²') && <Badge variant="success">below median</Badge>}
          <span className="text-[11px] font-mono text-neutral-400">#{l.id}</span>
        </div>
        <div className="truncate text-[13.5px] font-medium text-neutral-900">{l.title}</div>
        <div className="mt-0.5 flex items-center gap-3 text-[12px] text-neutral-500">
          <span>{l.district} · {l.street}</span>
          <span>·</span>
          <span className="tabular-nums">{l.areaSqm} m²</span>
          <span>·</span>
          <span className="tabular-nums">{l.rooms} rooms</span>
          <span>·</span>
          <span className="tabular-nums">teren {l.landSqm} m²</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[15px] font-semibold tabular-nums text-neutral-900">{fmt.eur(l.priceEur)}</div>
        {l.priceWas && (
          <div className="text-[11px] tabular-nums text-neutral-400 line-through">{fmt.eur(l.priceWas)}</div>
        )}
        <div className="text-[11px] tabular-nums text-neutral-500 mt-0.5">€{eurPerSqm}/m²</div>
      </div>
      <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100"><IconExternal className="h-4 w-4"/></Button>
    </div>
  );
}

// =================================================================
// LISTINGS — card + filter rail
// =================================================================
function ListingsPage({ view = 'list' }) {
  const [maxPrice, setMaxPrice] = useStateP(250000);
  const [district, setDistrict] = useStateP('all');
  const [sort, setSort] = useStateP('newest');
  const [q, setQ] = useStateP('');

  const filtered = useMemoP(() => {
    let r = [...MOCK_LISTINGS];
    if (q) r = r.filter(l => l.title.toLowerCase().includes(q.toLowerCase()) || l.district.toLowerCase().includes(q.toLowerCase()));
    if (district !== 'all') r = r.filter(l => l.district === district);
    if (maxPrice) r = r.filter(l => l.priceEur <= maxPrice);
    if (sort === 'newest') r.sort((a,b)=>new Date(b.firstSeenAt)-new Date(a.firstSeenAt));
    if (sort === 'price') r.sort((a,b)=>a.priceEur - b.priceEur);
    if (sort === 'eurm2') r.sort((a,b)=>(a.priceEur/a.areaSqm)-(b.priceEur/b.areaSqm));
    return r;
  }, [q, district, maxPrice, sort]);

  return (
    <div data-screen-label="Houses">
      <PageHeader
        title="Houses"
        subtitle={`${filtered.length} of ${MOCK_LISTINGS.length} listings · €${maxPrice ? maxPrice.toLocaleString() : '—'} max`}
        actions={
          <>
            <Button variant="secondary" size="md"><IconRefresh className="h-4 w-4"/>Refresh</Button>
            <Button variant="secondary" size="md">Export CSV</Button>
          </>
        }
      />

      <div className="grid grid-cols-[240px_1fr] gap-5">
        {/* Filter rail */}
        <Card className="self-start">
          <div className="space-y-5 text-[13px]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Search</div>
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400"/>
                <Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Title, district…" className="pl-8 h-8 text-[12px]"/>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Max price</div>
                <div className="text-[11px] tabular-nums text-neutral-700">{fmt.eur(maxPrice)}</div>
              </div>
              <input type="range" min="50000" max="250000" step="5000" value={maxPrice}
                onChange={e=>setMaxPrice(Number(e.target.value))}
                className="w-full accent-teal-600"/>
              <div className="flex justify-between text-[10px] text-neutral-400 tabular-nums mt-0.5"><span>€50k</span><span>€250k</span></div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">District</div>
              <div className="space-y-0.5">
                {['all','Buiucani','Botanica','Centru','Ciocana','Durlești','Râșcani'].map(d => (
                  <button key={d} onClick={()=>setDistrict(d)}
                    className={cx('w-full text-left rounded-md px-2 py-1.5 text-[12.5px] transition-colors',
                      district === d ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100')}>
                    {d === 'all' ? 'All districts' : d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Flags</div>
              <label className="flex items-center gap-2 py-1 text-[12.5px] text-neutral-700 cursor-pointer">
                <input type="checkbox" className="h-3.5 w-3.5 rounded accent-teal-600"/> Price drops only
              </label>
              <label className="flex items-center gap-2 py-1 text-[12.5px] text-neutral-700 cursor-pointer">
                <input type="checkbox" className="h-3.5 w-3.5 rounded accent-teal-600"/> Below median €/m²
              </label>
              <label className="flex items-center gap-2 py-1 text-[12.5px] text-neutral-700 cursor-pointer">
                <input type="checkbox" className="h-3.5 w-3.5 rounded accent-teal-600"/> Active only
              </label>
            </div>
          </div>
        </Card>

        {/* Results */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 rounded-md bg-neutral-100 p-0.5">
              {[['newest','Newest'],['price','Price ↑'],['eurm2','€/m² ↑']].map(([id, label]) => (
                <button key={id} onClick={()=>setSort(id)}
                  className={cx('rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
                    sort === id ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-900')}>
                  {label}
                </button>
              ))}
            </div>
            <div className="text-[11.5px] text-neutral-500">{filtered.length} results</div>
          </div>

          <div className="space-y-2">
            {filtered.map(l => <ListingCard key={l.id} l={l}/>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ListingCard({ l }) {
  const drop = l.priceWas ? Math.round((1 - l.priceEur/l.priceWas)*100) : null;
  const eurm2 = Math.round(l.priceEur/l.areaSqm);
  return (
    <div className="grid grid-cols-[120px_1fr_auto] gap-4 rounded-lg bg-white p-3 ring-1 ring-neutral-200 hover:ring-neutral-300 transition-all">
      <PhotoPlaceholder id={l.id} className="h-[88px]" label={`#${String(l.id).slice(-4)}`}/>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          {l.isNew && <Badge variant="accent">NEW</Badge>}
          {drop && <Badge variant="warning"><IconArrowDown className="h-3 w-3"/>−{drop}%</Badge>}
          {l.flags?.map(f => <Badge key={f} variant="outline">{f}</Badge>)}
        </div>
        <h3 className="truncate text-[14px] font-semibold text-neutral-900">{l.title}</h3>
        <div className="mt-1 grid grid-cols-[auto_auto_auto_auto_1fr] gap-x-4 gap-y-0.5 text-[12px] text-neutral-600 tabular-nums">
          <Spec label="District" v={l.district}/>
          <Spec label="Street" v={l.street}/>
          <Spec label="Area" v={`${l.areaSqm} m²`}/>
          <Spec label="Land" v={`${l.landSqm} m²`}/>
          <Spec label="Rooms" v={`${l.rooms} · ${l.floors} fl`}/>
          <Spec label="Built" v={l.yearBuilt}/>
          <Spec label="First seen" v={fmt.rel(l.firstSeenAt)}/>
          <Spec label="Snapshots" v={l.snapshots}/>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between text-right">
        <div>
          <div className="text-[18px] font-semibold tabular-nums text-neutral-900">{fmt.eur(l.priceEur)}</div>
          {l.priceWas && <div className="text-[11px] tabular-nums text-neutral-400 line-through">{fmt.eur(l.priceWas)}</div>}
          <div className="text-[11px] tabular-nums text-neutral-500 mt-0.5">€{eurm2}/m²</div>
        </div>
        <Button variant="secondary" size="sm">Open <IconExternal className="h-3.5 w-3.5"/></Button>
      </div>
    </div>
  );
}

function Spec({ label, v }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10.5px] uppercase tracking-wider text-neutral-400">{label}</span>
      <span className="text-neutral-700">{v}</span>
    </div>
  );
}

// =================================================================
// SWEEP DETAIL — drill-down with live progress
// =================================================================
function SweepDetailPage({ sweepId, onBack }) {
  const detail = MOCK_SWEEP_DETAILS[sweepId] || MOCK_SWEEP_DETAILS['s-480'];
  const live = detail.status === 'running';
  const [tab, setTab] = useStateP('overview');
  const [tick, setTick] = useStateP(0);

  // Live tick animation for the running sweep
  React.useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  return (
    <div data-screen-label="Sweep detail">
      <div className="mb-4 flex items-center gap-2 text-[12.5px]">
        <button onClick={onBack} className="text-neutral-500 hover:text-neutral-900">Sweeps</button>
        <span className="text-neutral-300">/</span>
        <span className="font-mono text-neutral-700">{detail.id}</span>
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span>Sweep <span className="font-mono text-neutral-500">{detail.id}</span></span>
            {live && <Badge variant="warning"><StatusDot tone="warning" pulse/>running</Badge>}
            {detail.status === 'success' && <Badge variant="success"><IconCheck className="h-3 w-3"/>success</Badge>}
            {detail.status === 'failed' && <Badge variant="error"><IconAlert className="h-3 w-3"/>failed</Badge>}
          </span>
        }
        subtitle={`${detail.source} · ${detail.trigger} · started ${fmt.rel(detail.startedAt)}`}
        actions={
          <>
            {live && <Button variant="destructive" size="md">Cancel sweep</Button>}
            <Button variant="secondary" size="md">View raw JSON</Button>
            <Button variant="secondary" size="md" onClick={onBack}>← Back</Button>
          </>
        }
      />

      {/* Live progress hero (only when running) */}
      {live && <LiveProgress detail={detail} tick={tick}/>}

      {/* Summary KPI strip */}
      {!live && (
        <Card padding={false} className="mb-5">
          <div className="grid grid-cols-5 divide-x divide-neutral-200">
            <div className="p-4"><KStat label="Duration" value={fmt.ms(detail.summary.durationMs)}/></div>
            <div className="p-4"><KStat label="Pages" value={detail.summary.pagesFetched}/></div>
            <div className="p-4"><KStat label="Details" value={detail.summary.detailsFetched}/></div>
            <div className="p-4"><KStat label="New listings" value={detail.summary.newListings} tone="accent"/></div>
            <div className="p-4"><KStat label="Errors" value={detail.summary.errors}/></div>
          </div>
        </Card>
      )}

      {/* Tab nav */}
      <div className="mb-4 flex items-center gap-1 border-b border-neutral-200">
        {[
          ['overview', 'Overview'],
          ['http', `HTTP log${detail.pages ? ` · ${detail.pages.length + (detail.details?.length||0)}` : ''}`],
          ['events', `Events · ${detail.logTail.length}`],
          ['errors', `Errors${detail.errors?.length ? ` · ${detail.errors.length}` : ''}`],
          ['config', 'Config snapshot'],
        ].map(([id, label]) => (
          <button key={id} onClick={()=>setTab(id)}
            className={cx('px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors',
              tab === id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-900')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab detail={detail} live={live}/>}
      {tab === 'http' && <HttpTab detail={detail}/>}
      {tab === 'events' && <EventsTab detail={detail} live={live}/>}
      {tab === 'errors' && <ErrorsTab detail={detail}/>}
      {tab === 'config' && <ConfigTab detail={detail}/>}
    </div>
  );
}

function LiveProgress({ detail, tick }) {
  const p = detail.progress;
  const pct = Math.round((p.pagesDone / p.pagesTotal) * 100);
  const elapsed = Math.round((Date.now() - new Date(detail.startedAt).getTime()) / 1000);
  return (
    <Card className="mb-5 ring-amber-200 bg-gradient-to-br from-amber-50/60 to-white">
      <div className="flex items-center gap-2 mb-3">
        <StatusDot tone="warning" pulse/>
        <span className="text-[13px] font-semibold text-neutral-900">Live · phase: {p.phase}</span>
        <span className="text-[12px] text-neutral-500 tabular-nums">elapsed {Math.floor(elapsed/60)}m {elapsed%60}s</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center mb-3">
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[12px] text-neutral-600">Index pages</span>
            <span className="text-[12px] tabular-nums text-neutral-700">{p.pagesDone} / {p.pagesTotal} · {pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-200 overflow-hidden">
            <div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{width: `${pct}%`}}/>
          </div>
        </div>
        <KStat label="Details queued" value={p.detailsQueued}/>
        <KStat label="Updated" value={p.updatedCount}/>
        <KStat label="New" value={p.newCount} tone="accent"/>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-white ring-1 ring-neutral-200 px-3 py-2 text-[12px]">
        <StatusDot tone="warning" pulse/>
        <span className="text-neutral-500 shrink-0">Fetching</span>
        <code className="font-mono text-neutral-700 truncate flex-1">{detail.currentlyFetching.url}</code>
        <span className="font-mono tabular-nums text-neutral-400">
          {((detail.currentlyFetching.startedAt + (tick * 1000))/1000).toFixed(1)}s
        </span>
      </div>
    </Card>
  );
}

function OverviewTab({ detail, live }) {
  const totalBytes = (detail.pages || []).reduce((a,p)=>a + (p.bytes||0), 0)
                  + (detail.details || []).reduce((a,d)=>a + (d.bytes||0), 0);
  const avgPageMs = detail.pages?.length
    ? Math.round(detail.pages.reduce((a,p)=>a+p.took, 0) / detail.pages.length)
    : 0;
  return (
    <div className="grid grid-cols-3 gap-5">
      <div className="col-span-2 space-y-5">
        <Card>
          <SectionHeader title="Index pages" hint={`${detail.pages?.length || 0} fetched`}/>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                <th className="py-1.5 font-semibold w-8">#</th>
                <th className="py-1.5 font-semibold">URL</th>
                <th className="py-1.5 font-semibold text-right">Status</th>
                <th className="py-1.5 font-semibold text-right">Bytes</th>
                <th className="py-1.5 font-semibold text-right">Found</th>
                <th className="py-1.5 font-semibold text-right">Took</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(detail.pages || []).map(p => (
                <tr key={p.n}>
                  <td className="py-1.5 tabular-nums text-neutral-400">{p.n}</td>
                  <td className="py-1.5"><code className="font-mono text-[11.5px] text-neutral-700 truncate max-w-[280px] inline-block align-bottom">{p.url}</code></td>
                  <td className="py-1.5 text-right">
                    <Badge variant={p.status === 200 ? 'success' : 'error'}>{p.status}</Badge>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-600">{p.bytes ? `${(p.bytes/1024).toFixed(1)} KB` : '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-600">{p.found || '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-600">{fmt.ms(p.took)}</td>
                </tr>
              ))}
              {live && (
                <tr className="bg-amber-50/40">
                  <td className="py-1.5 text-neutral-400 tabular-nums">{(detail.pages?.length || 0) + 1}</td>
                  <td className="py-1.5"><code className="font-mono text-[11.5px] text-neutral-700">{detail.currentlyFetching.url}</code></td>
                  <td className="py-1.5 text-right"><Badge variant="warning"><StatusDot tone="warning" pulse/>fetching</Badge></td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-300">—</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-300">—</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-300">…</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {detail.details?.length > 0 && (
          <Card>
            <SectionHeader title="Detail fetches" hint={`${detail.details.length} listings`}/>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                  <th className="py-1.5">ID</th>
                  <th className="py-1.5">URL</th>
                  <th className="py-1.5 text-right">Status</th>
                  <th className="py-1.5 text-right">Action</th>
                  <th className="py-1.5 text-right">Price</th>
                  <th className="py-1.5 text-right">Parse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {detail.details.map(d => (
                  <tr key={d.id}>
                    <td className="py-1.5 font-mono text-neutral-700">#{d.id}</td>
                    <td className="py-1.5"><code className="font-mono text-[11.5px] text-neutral-500">{d.url.replace('https://','')}</code></td>
                    <td className="py-1.5 text-right"><Badge variant="success">{d.status}</Badge></td>
                    <td className="py-1.5 text-right"><Badge variant="accent">{d.action}</Badge></td>
                    <td className="py-1.5 text-right tabular-nums">{fmt.eur(d.priceEur)}</td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-500">{d.parseMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <SectionHeader title="Throughput"/>
          <div className="space-y-3 text-[12.5px]">
            <Stat row label="Avg page time" value={fmt.ms(avgPageMs)}/>
            <Stat row label="Total bytes" value={`${(totalBytes/1024/1024).toFixed(2)} MB`}/>
            <Stat row label="Politeness gap" value={`${detail.config['politeness.baseDelayMs']}ms ± ${detail.config['politeness.jitterMs'] || 0}`}/>
            <Stat row label="HTTP errors" value={detail.errors?.length || 0}/>
          </div>
        </Card>
        <Card>
          <SectionHeader title="Tail" right={live ? <Badge variant="warning"><StatusDot tone="warning" pulse/>live</Badge> : null}/>
          <div className="space-y-1 max-h-[280px] overflow-auto font-mono text-[11px]">
            {[...detail.logTail].slice(-12).reverse().map((e, i) => <LogLine key={i} e={e}/>)}
          </div>
        </Card>
      </div>
    </div>
  );
}

function HttpTab({ detail }) {
  const all = [
    ...(detail.pages || []).map(p => ({ kind: 'index', ...p, identifier: `page=${p.n}` })),
    ...(detail.details || []).map(d => ({ kind: 'detail', ...d, n: d.id, identifier: `id=${d.id}`, took: d.parseMs })),
  ];
  return (
    <Card padding={false}>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
            <th className="px-4 py-2 font-semibold">Kind</th>
            <th className="px-3 py-2 font-semibold">Identifier</th>
            <th className="px-3 py-2 font-semibold">URL</th>
            <th className="px-3 py-2 font-semibold text-right">Status</th>
            <th className="px-3 py-2 font-semibold text-right">Bytes</th>
            <th className="px-3 py-2 font-semibold text-right">Parse</th>
            <th className="px-3 py-2 font-semibold text-right pr-4">Took</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {all.map((r, i) => (
            <tr key={i} className="hover:bg-neutral-50">
              <td className="px-4 py-2"><Badge variant={r.kind === 'index' ? 'outline' : 'accent'}>{r.kind}</Badge></td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-neutral-700">{r.identifier}</td>
              <td className="px-3 py-2"><code className="font-mono text-[11.5px] text-neutral-500">{r.url}</code></td>
              <td className="px-3 py-2 text-right"><Badge variant={r.status >= 400 ? 'error' : r.status >= 300 ? 'warning' : 'success'}>{r.status}</Badge></td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{r.bytes ? `${(r.bytes/1024).toFixed(1)}K` : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{r.parseMs ? `${r.parseMs}ms` : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-700 pr-4">{r.took ? fmt.ms(r.took) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function EventsTab({ detail, live }) {
  return (
    <Card>
      <SectionHeader title="Event log"
        hint={live ? 'streaming' : `${detail.logTail.length} events`}
        right={live ? <Badge variant="warning"><StatusDot tone="warning" pulse/>live</Badge> : <Button variant="ghost" size="sm">Download</Button>}/>
      <div className="space-y-1 max-h-[560px] overflow-auto font-mono text-[12px]">
        {[...detail.logTail].reverse().map((e, i) => <LogLine key={i} e={e}/>)}
      </div>
    </Card>
  );
}

function ErrorsTab({ detail }) {
  if (!detail.errors?.length) {
    return (
      <Card>
        <div className="py-12 text-center">
          <div className="mx-auto h-10 w-10 grid place-items-center rounded-full bg-emerald-50 text-emerald-600 mb-3">
            <IconCheck className="h-5 w-5"/>
          </div>
          <div className="text-[14px] font-medium text-neutral-900">No errors</div>
          <div className="text-[12.5px] text-neutral-500 mt-0.5">This sweep ran cleanly.</div>
        </div>
      </Card>
    );
  }
  return (
    <Card padding={false}>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
            <th className="px-4 py-2">URL</th>
            <th className="px-3 py-2 text-right">Status</th>
            <th className="px-3 py-2 text-right">Attempts</th>
            <th className="px-3 py-2 pr-4">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {detail.errors.map((e, i) => (
            <tr key={i} className="bg-red-50/30">
              <td className="px-4 py-2"><code className="font-mono text-[11.5px] text-neutral-700">{e.url}</code></td>
              <td className="px-3 py-2 text-right"><Badge variant="error">{e.status}</Badge></td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{e.attempts}</td>
              <td className="px-3 py-2 pr-4 text-red-700">{e.msg}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ConfigTab({ detail }) {
  return (
    <Card>
      <SectionHeader title="Config snapshot" hint="settings as resolved at sweep start"/>
      <pre className="font-mono text-[12px] bg-neutral-50 ring-1 ring-neutral-200 rounded-md p-4 overflow-auto">
{JSON.stringify(detail.config, null, 2)}
      </pre>
    </Card>
  );
}

function LogLine({ e }) {
  const tone = e.lvl === 'error' ? 'text-red-700' : e.lvl === 'warn' ? 'text-amber-700' : e.lvl === 'debug' ? 'text-neutral-400' : 'text-neutral-700';
  return (
    <div className="flex gap-2 leading-5">
      <span className="text-neutral-400 tabular-nums shrink-0">{e.t}</span>
      <span className={cx('shrink-0 w-12 uppercase font-semibold', tone)}>{e.lvl}</span>
      <span className={cx('shrink-0 font-medium', tone)}>{e.msg}</span>
      <span className="text-neutral-500 truncate">{e.meta}</span>
    </div>
  );
}

function Stat({ label, value, row }) {
  if (row) return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono text-neutral-900 tabular-nums">{value}</span>
    </div>
  );
  return null;
}

// =================================================================
// SWEEPS — timeline + breaker state
// =================================================================
function SweepsPage({ onOpen }) {
  const [breakerOpen, setBreakerOpen] = useStateP(false);
  const [expanded, setExpanded] = useStateP(null);

  const successRate = MOCK_SWEEPS.filter(s => s.status === 'success').length / MOCK_SWEEPS.length;
  const lastFail = MOCK_SWEEPS.find(s => s.status === 'failed');

  return (
    <div data-screen-label="Sweeps">
      <PageHeader
        title="Sweeps"
        subtitle={`${MOCK_SWEEPS.length} runs shown · ${Math.round(successRate*100)}% success`}
        actions={
          <Button variant="secondary" size="md"><IconRefresh className="h-4 w-4"/>Refresh</Button>
        }
      />

      {/* Breaker state — front and center */}
      <div className={cx('mb-5 rounded-lg ring-1 p-4 flex items-center gap-4',
        breakerOpen ? 'bg-red-50 ring-red-200' : 'bg-white ring-neutral-200'
      )}>
        <div className={cx('grid h-10 w-10 place-items-center rounded-full',
          breakerOpen ? 'bg-red-100 text-red-600' : 'bg-emerald-50 text-emerald-600')}>
          {breakerOpen ? <IconAlert className="h-5 w-5"/> : <IconCheck className="h-5 w-5"/>}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-neutral-900">
              Circuit breaker {breakerOpen ? 'open' : 'closed'}
            </span>
            {breakerOpen && <Badge variant="error">crawler paused</Badge>}
          </div>
          <p className="text-[12.5px] text-neutral-600 mt-0.5">
            {breakerOpen
              ? 'Crawler paused after 3 consecutive failures. It will resume in 22h 14m unless you reset it.'
              : `Last failure ${lastFail ? fmt.rel(lastFail.startedAt) : '—'}. Trips after 3 consecutive failures.`}
          </p>
        </div>
        {breakerOpen ? (
          <Button variant="destructive" onClick={()=>setBreakerOpen(false)}>Reset breaker</Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={()=>setBreakerOpen(true)}>Simulate trip</Button>
        )}
      </div>

      {/* Mini-bars across last 12 sweeps */}
      <Card className="mb-5">
        <SectionHeader title="Last 12 sweeps" hint="duration · color = status" right={
          <div className="flex items-center gap-3 text-[11px] text-neutral-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500"/>success</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500"/>failed</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500"/>running</span>
          </div>
        }/>
        <div className="flex items-end gap-1 h-16">
          {[...MOCK_SWEEPS].reverse().map(s => {
            const max = Math.max(...MOCK_SWEEPS.map(x => x.durationMs));
            const h = Math.max(6, Math.round((s.durationMs/max)*60));
            const color = s.status === 'success' ? 'bg-emerald-500' : s.status === 'failed' ? 'bg-red-500' : 'bg-amber-500';
            return (
              <div key={s.id} className="flex-1 flex flex-col items-center justify-end" title={`${s.id} · ${fmt.ms(s.durationMs)} · ${s.status}`}>
                <div className={cx('w-full rounded-t-sm', color)} style={{height: h, opacity: s.status==='running'?0.7:1}}/>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-neutral-400">
          <span>11h ago</span><span>now</span>
        </div>
      </Card>

      {/* Run table */}
      <Card padding={false}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
              <th className="px-5 py-2.5 font-semibold">Started</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 text-right font-semibold">Duration</th>
              <th className="px-3 py-2.5 text-right font-semibold">Pages</th>
              <th className="px-3 py-2.5 text-right font-semibold">Details</th>
              <th className="px-3 py-2.5 text-right font-semibold">New</th>
              <th className="px-3 py-2.5 text-right font-semibold">Updated</th>
              <th className="px-3 py-2.5 text-right font-semibold pr-5">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {MOCK_SWEEPS.map(s => (
              <React.Fragment key={s.id}>
                <tr onClick={()=> onOpen ? onOpen(s.id) : setExpanded(expanded === s.id ? null : s.id)}
                    className={cx('hover:bg-neutral-50 cursor-pointer group', expanded === s.id && 'bg-neutral-50')}>
                  <td className="px-5 py-2.5">
                    <div className="text-neutral-900">{fmt.date(s.startedAt)}</div>
                    <div className="text-[11px] text-neutral-400">{fmt.rel(s.startedAt)} · <span className="font-mono">{s.id}</span></div>
                  </td>
                  <td className="px-3 py-2.5">
                    {s.status === 'success' && <Badge variant="success">success</Badge>}
                    {s.status === 'failed' && <Badge variant="error">failed</Badge>}
                    {s.status === 'running' && <Badge variant="warning"><StatusDot tone="warning" pulse/>running</Badge>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{fmt.ms(s.durationMs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{s.pagesFetched}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{s.detailsFetched}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {s.newListings > 0 ? <span className="font-semibold text-teal-700">+{s.newListings}</span> : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{s.updatedListings || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums pr-5">
                    {s.errorCount > 0 ? <Badge variant="error">{s.errorCount}</Badge> : <span className="text-neutral-400">0</span>}
                  </td>
                </tr>
                {expanded === s.id && (
                  <tr><td colSpan={8} className="bg-neutral-50 border-t border-neutral-200 px-5 py-4">
                    <div className="grid grid-cols-3 gap-4 text-[12px]">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Run id</div>
                        <code className="font-mono text-neutral-700">{s.id}</code>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Source</div>
                        <span className="text-neutral-700">999.md</span>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Triggered by</div>
                        <span className="text-neutral-700">cron · 0 * * * *</span>
                      </div>
                    </div>
                    {s.errorCount > 0 && (
                      <pre className="mt-3 rounded-md border border-neutral-200 bg-white p-3 font-mono text-[11px] text-neutral-700 overflow-auto max-h-32">
{`[{"url":"https://999.md/ro/76612040","status":429,"msg":"rate limit"},
 {"url":"https://999.md/ro/76598114","status":503,"msg":"upstream timeout"}]`}
                      </pre>
                    )}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// =================================================================
// SETTINGS — typed controls grouped
// =================================================================
function SettingsPage() {
  const [vals, setVals] = useStateP(() => Object.fromEntries(MOCK_SETTINGS.map(s => [s.key, s.value])));
  const groups = useMemoP(() => {
    const m = {};
    for (const s of MOCK_SETTINGS) (m[s.group] ||= []).push(s);
    return m;
  }, []);

  return (
    <div data-screen-label="Settings">
      <PageHeader
        title="Settings"
        subtitle="Runtime overrides applied at the start of each sweep"
        actions={<Button variant="secondary" size="md">Reset all to defaults</Button>}
      />

      <div className="grid grid-cols-[200px_1fr] gap-7">
        {/* Anchor nav */}
        <nav className="sticky top-0 self-start space-y-0.5 text-[13px]">
          {[...Object.keys(groups), 'Sources', 'Global filter'].map(g => (
            <a key={g} href={`#${g}`}
               className="block rounded-md px-2.5 py-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900">
              {g}
            </a>
          ))}
        </nav>

        <div className="space-y-5">
          {Object.entries(groups).map(([group, items]) => (
            <Card key={group}>
              <SectionHeader title={group}/>
              <div className="divide-y divide-neutral-100">
                {items.map(s => (
                  <SettingRow key={s.key} s={s} value={vals[s.key]}
                              onChange={v => setVals({...vals, [s.key]: v})}/>
                ))}
              </div>
            </Card>
          ))}

          {/* Sources */}
          <Card>
            <SectionHeader title="Sources" hint="enable/disable per-source crawling"
              right={<Button variant="ghost" size="sm">+ Add source</Button>}/>
            <div className="divide-y divide-neutral-100">
              {MOCK_SOURCES.map(src => <SourceRow key={src.id} src={src}/>)}
            </div>
          </Card>

          {/* Global filter */}
          <Card>
            <SectionHeader title="Global filter" hint="capture criteria applied to every source"/>
            <div className="grid grid-cols-3 gap-4">
              <FilterField label="Max price" value="€250,000"/>
              <FilterField label="Max area" value="200 m²"/>
              <FilterField label="Category" value="Houses & villas"/>
              <FilterField label="Locations" value="Chișinău, Durlești"/>
              <FilterField label="Deal type" value="Sale"/>
              <FilterField label="Currency" value="EUR (auto-convert)"/>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ s, value, onChange }) {
  const changed = value !== s.default;
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="font-mono text-[12px] text-neutral-900">{s.key}</code>
          {changed && <Badge variant="accent">overridden</Badge>}
        </div>
        <div className="mt-0.5 text-[12.5px] text-neutral-600">{s.label}</div>
        {s.hint && <div className="text-[11.5px] text-neutral-400 mt-0.5">{s.hint}</div>}
      </div>
      <div className="w-44 shrink-0">
        {s.kind === 'number' && (
          <div className="relative">
            <input type="number" value={value} onChange={e=>onChange(Number(e.target.value))}
              className="h-8 w-full rounded-md bg-white pl-2.5 pr-12 text-[13px] text-right tabular-nums ring-1 ring-inset ring-neutral-200 focus:ring-2 focus:ring-teal-500 focus:outline-none"/>
            {s.unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-neutral-400">{s.unit}</span>}
          </div>
        )}
        {s.kind === 'text' && (
          <input value={value} onChange={e=>onChange(e.target.value)}
            className="h-8 w-full rounded-md bg-white px-2.5 font-mono text-[12px] ring-1 ring-inset ring-neutral-200 focus:ring-2 focus:ring-teal-500 focus:outline-none"/>
        )}
        {s.kind === 'select' && (
          <select value={value} onChange={e=>onChange(e.target.value)}
            className="h-8 w-full rounded-md bg-white px-2 text-[13px] ring-1 ring-inset ring-neutral-200 focus:ring-2 focus:ring-teal-500 focus:outline-none">
            {s.options.map(o => <option key={o}>{o}</option>)}
          </select>
        )}
      </div>
      <div className="w-24 text-right text-[11px] text-neutral-400">
        default: <span className="font-mono text-neutral-500">{String(s.default).length > 8 ? String(s.default).slice(0,6)+'…' : String(s.default)}</span>
      </div>
    </div>
  );
}

function SourceRow({ src }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className={cx('h-2 w-2 rounded-full', src.enabled ? 'bg-emerald-500' : 'bg-neutral-300')}/>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-neutral-900">{src.name}</span>
          {src.placeholder && <Badge variant="outline">not implemented</Badge>}
        </div>
        <div className="font-mono text-[11.5px] text-neutral-400 truncate">{src.baseUrl}</div>
      </div>
      <Toggle checked={src.enabled} disabled={src.placeholder}/>
    </div>
  );
}

function Toggle({ checked, disabled }) {
  return (
    <button disabled={disabled} className={cx(
      'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
      checked ? 'bg-teal-600' : 'bg-neutral-200',
      disabled && 'opacity-40 cursor-not-allowed'
    )}>
      <span className={cx(
        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform shadow',
        checked ? 'translate-x-4.5' : 'translate-x-0.5'
      )} style={{transform: checked ? 'translateX(18px)' : 'translateX(2px)'}}/>
    </button>
  );
}

function FilterField({ label, value }) {
  return (
    <div className="rounded-md bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-[13.5px] text-neutral-900 font-medium tabular-nums">{value}</div>
    </div>
  );
}

Object.assign(window, { DashboardPage, ListingsPage, SweepsPage, SettingsPage, SweepDetailPage });

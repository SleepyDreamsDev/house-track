// Shared primitives + AppShell. All Tailwind-only, monochrome with teal accent.
const { useState, useEffect, useMemo, useRef } = React;

// --- tiny class helper
const cx = (...a) => a.filter(Boolean).join(' ');

// --- Badge (status pill)
function Badge({ variant = 'default', children, className }) {
  const palettes = {
    default: 'bg-neutral-100 text-neutral-700',
    success: 'bg-emerald-50 text-emerald-700',
    error: 'bg-red-50 text-red-700',
    warning: 'bg-amber-50 text-amber-700',
    accent: 'bg-teal-50 text-teal-700',
    outline: 'bg-white text-neutral-600 ring-1 ring-inset ring-neutral-200',
  };
  return (
    <span className={cx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-5 tracking-wide',
      palettes[variant], className
    )}>
      {children}
    </span>
  );
}

// --- StatusDot (live indicator)
function StatusDot({ tone = 'success', pulse = false }) {
  const tones = { success: 'bg-emerald-500', error: 'bg-red-500', warning: 'bg-amber-500', muted: 'bg-neutral-300' };
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={cx('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', tones[tone])} />}
      <span className={cx('relative inline-flex h-2 w-2 rounded-full', tones[tone])} />
    </span>
  );
}

// --- Button
function Button({ variant = 'primary', size = 'md', className, children, ...props }) {
  const variants = {
    primary: 'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-950 disabled:bg-neutral-300',
    secondary: 'bg-white text-neutral-900 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50',
    ghost: 'text-neutral-700 hover:bg-neutral-100',
    destructive: 'bg-red-600 text-white hover:bg-red-700',
    accent: 'bg-teal-600 text-white hover:bg-teal-700',
  };
  const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm', lg: 'h-10 px-4 text-sm' };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed',
        variants[variant], sizes[size], className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// --- Input
function Input({ className, ...props }) {
  return (
    <input
      className={cx(
        'h-9 w-full rounded-md bg-white px-3 text-sm text-neutral-900 ring-1 ring-inset ring-neutral-200',
        'placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-teal-500',
        className
      )}
      {...props}
    />
  );
}

// --- Card
function Card({ children, className, padding = true }) {
  return (
    <div className={cx(
      'rounded-lg bg-white ring-1 ring-neutral-200/80 shadow-[0_1px_0_rgba(0,0,0,0.02)]',
      padding && 'p-5',
      className
    )}>
      {children}
    </div>
  );
}

// --- KStat (small stat block)
function KStat({ label, value, hint, tone, trend }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={cx('text-[26px] font-semibold leading-none tabular-nums', tone === 'accent' ? 'text-teal-700' : 'text-neutral-900')}>
        {value}
      </div>
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
      {trend}
    </div>
  );
}

// --- Sparkline (svg, simple)
function Sparkline({ data, w = 120, h = 32, stroke = 'currentColor' }) {
  if (!data?.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(max - min, 1);
  const step = w / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`).join(' ');
  const last = data.length - 1;
  const lx = (last * step).toFixed(1);
  const ly = (h - ((data[last] - min) / span) * (h - 4) - 2).toFixed(1);
  return (
    <svg width={w} height={h} className="overflow-visible text-teal-600">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="currentColor" />
    </svg>
  );
}

// --- Photo placeholder (we don't download images — striped tile per spec)
function PhotoPlaceholder({ id, className, label = 'photo' }) {
  // deterministic hue from id
  const hue = (() => {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return (h % 60) + 160; // teal-ish band
  })();
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-neutral-100', className)}
         style={{ backgroundImage:
           `repeating-linear-gradient(135deg, oklch(0.95 0.02 ${hue}) 0 6px, oklch(0.92 0.02 ${hue}) 6px 12px)` }}>
      <div className="absolute inset-0 flex items-end p-2">
        <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-600">
          {label}
        </span>
      </div>
    </div>
  );
}

// --- AppShell with sidebar nav
function AppShell({ page, setPage, children, density = 'comfortable', breakerOpen = false }) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: IconHome },
    { id: 'listings', label: 'Houses', icon: IconHouse, badge: 2 },
    { id: 'sweeps', label: 'Sweeps', icon: IconActivity },
    { id: 'analytics', label: 'Analytics', icon: IconChart },
    { id: 'settings', label: 'Settings', icon: IconCog },
  ];
  return (
    <div className={cx('flex h-screen bg-neutral-50 text-neutral-900', density === 'compact' ? 'text-[13px]' : 'text-sm')}>
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-neutral-900 text-white">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">House Track</div>
            <div className="text-[11px] text-neutral-500">999.md operator</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3" data-screen-label="Sidebar">
          {nav.map((it) => {
            const Icon = it.icon;
            const active = it.id === page;
            return (
              <button key={it.id} onClick={() => setPage(it.id)}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                  active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                )}
              >
                <Icon className={cx('h-4 w-4', active ? 'text-white' : 'text-neutral-400')} />
                <span className="flex-1 text-left">{it.label}</span>
                {it.badge ? (
                  <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    active ? 'bg-white/15 text-white' : 'bg-teal-50 text-teal-700')}>
                    {it.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-neutral-200 px-3 py-3">
          <div className="flex items-center gap-2 rounded-md bg-neutral-50 px-2.5 py-2">
            <StatusDot tone={breakerOpen ? 'error' : 'success'} pulse={!breakerOpen} />
            <div className="flex-1 leading-tight">
              <div className="text-[12px] font-medium">Crawler {breakerOpen ? 'paused' : 'running'}</div>
              <div className="text-[10.5px] text-neutral-500">{breakerOpen ? 'circuit open' : 'next sweep in 46m'}</div>
            </div>
          </div>
          <div className="mt-2 px-1.5 text-[10.5px] text-neutral-400">v0.4 · localhost</div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1180px] px-8 py-7">
          {children}
        </div>
      </main>
    </div>
  );
}

// --- Page header (title + subtitle + actions)
function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// --- Section header (within a page)
function SectionHeader({ title, hint, right }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-neutral-900">{title}</h2>
        {hint && <span className="text-xs text-neutral-500">{hint}</span>}
      </div>
      {right}
    </div>
  );
}

// --- Icons (1.5px stroke, 16x16 viewBox=24x24)
const Ico = (path) => (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {path}
  </svg>
);
const IconHome = Ico(<><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></>);
const IconHouse = Ico(<><path d="M3 10l9-7 9 7"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/></>);
const IconActivity = Ico(<><path d="M3 12h4l3-8 4 16 3-8h4"/></>);
const IconCog = Ico(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>);
const IconExternal = Ico(<><path d="M14 5h5v5"/><path d="M19 5l-9 9"/><path d="M19 13v6H5V5h6"/></>);
const IconArrowDown = Ico(<><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></>);
const IconAlert = Ico(<><path d="M12 9v4"/><circle cx="12" cy="17" r=".5"/><path d="M10.3 3.7L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.7a2 2 0 0 0-3.4 0z"/></>);
const IconCheck = Ico(<><path d="M5 12l5 5L20 7"/></>);
const IconRefresh = Ico(<><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 21v-5h5"/></>);
const IconSearch = Ico(<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>);
const IconSliders = Ico(<><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></>);
const IconPlay = Ico(<><path d="M6 4l14 8-14 8z"/></>);
const IconChart = Ico(<><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-7"/></>);

Object.assign(window, {
  cx, Badge, StatusDot, Button, Input, Card, KStat, Sparkline, PhotoPlaceholder,
  AppShell, PageHeader, SectionHeader,
  IconHome, IconHouse, IconActivity, IconCog, IconExternal, IconArrowDown,
  IconAlert, IconCheck, IconRefresh, IconSearch, IconSliders, IconPlay, IconChart,
});

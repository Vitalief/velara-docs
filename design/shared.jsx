/* Shared primitives: Icon set, Badge, Avatar, helpers */

const I = {
  // 1.7px stroke geometric line icons
  registry:   'M4 7h16M4 12h16M4 17h10',
  catalog:    'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  cert:       'M12 3l2.2 1.6 2.7-.2 1 2.5 2.4 1.2-.5 2.7 1.3 2.4-1.9 1.9.2 2.7-2.6.8-1.4 2.3-2.6-.7L12 21l-2.3-1.6-2.6.7-1.4-2.3-2.6-.8.2-2.7L1 12.3l1.3-2.4-.5-2.7L4.2 6l1-2.5 2.7.2z',
  check:      'M5 12.5l4.5 4.5L19 7',
  shield:     'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  chart:      'M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3M20 16v-7',
  audit:      'M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h4',
  play:       'M7 5l12 7-12 7z',
  search:     'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  chevron:    'M9 6l6 6-6 6',
  chevdown:   'M6 9l6 6 6-6',
  lock:       'M6 11V8a6 6 0 0112 0v3M5 11h14v9H5z',
  unlock:     'M7 11V8a5 5 0 019-3M5 11h14v9H5z',
  file:       'M6 3h8l4 4v14H6zM14 3v4h4',
  layers:     'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  link:       'M9 15l6-6M10 6l1-1a4 4 0 016 6l-1 1M14 18l-1 1a4 4 0 01-6-6l1-1',
  code:       'M9 8l-5 4 5 4M15 8l5 4-5 4',
  sparkle:    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  bolt:       'M13 3L5 13h6l-1 8 8-10h-6z',
  clock:      'M12 7v5l3.5 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  user:       'M12 12a4 4 0 100-8 4 4 0 000 8zM5 20c0-3.5 3-6 7-6s7 2.5 7 6',
  users:      'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 19c0-3 2.5-5 6-5s6 2 6 5M17 4.5a3.5 3.5 0 010 7M21 19c0-2.5-1.6-4.3-4-4.8',
  upload:     'M12 16V5m0 0L8 9m4-4l4 4M5 19h14',
  download:   'M12 4v11m0 0l4-4m-4 4l-4-4M5 20h14',
  arrowR:     'M5 12h14m0 0l-6-6m6 6l-6 6',
  arrowDown:  'M12 5v14m0 0l6-6m-6 6l-6-6',
  plus:       'M12 5v14M5 12h14',
  x:          'M6 6l12 12M18 6L6 18',
  filter:     'M4 5h16l-6 8v6l-4-2v-4z',
  dots:       'M12 6h.01M12 12h.01M12 18h.01',
  settings:   'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12l-1 2 2 1 .5 2 2-.3 1.5 1.5L12 21l1.5-1.8 1.5-1.5 2 .3.5-2 2-1-1-2 1-2-2-1-.5-2-2 .3L12 3l-1.5 1.8L9 6.3l-2-.3-.5 2-2 1 1 2z',
  eye:        'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeoff:     'M3 3l18 18M10.5 5.2A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a16 16 0 01-3 3.6M6.2 6.5A15.6 15.6 0 002 12s3.5 7 10 7a9.6 9.6 0 004-.9',
  branch:     'M6 4v9a3 3 0 003 3h6M6 4a2 2 0 100 4 2 2 0 000-4zm12 9a2 2 0 100 4 2 2 0 000-4z',
  doc2:       'M7 3h7l4 4v14H7zM13 3v5h5M10 12h5M10 16h5',
  building:   'M5 21V5l7-2 7 2v16M9 8h0M12 8h0M15 8h0M9 12h0M12 12h0M15 12h0M9 21v-4h6v4',
  inbox:      'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  history:    'M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 4v3.5H6.5M12 8v4l3 2',
  flag:       'M5 21V4m0 0h11l-2 4 2 4H5',
};

function Icon({ name, size=18, sw=1.7, style, className }) {
  const d = I[name] || I.dots;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Avatar({ p, size=28 }) {
  const person = typeof p === 'string' ? DATA.people[p] : p;
  if (!person) return null;
  return <span className="av" style={{ width:size, height:size, background:person.color, fontSize:size*0.4 }}>{person.init}</span>;
}

const STATE_META = {
  'draft':         { label:'Draft',          cls:'badge-state-draft',    dot:'var(--st-draft)' },
  'internal-ready':{ label:'Internal-ready', cls:'badge-state-internal', dot:'var(--st-internal)' },
  'client-ready':  { label:'Client-ready',   cls:'badge-state-client',   dot:'var(--st-client)' },
  'retired':       { label:'Retired',        cls:'badge-state-retired',  dot:'var(--st-retired)' },
};
function StateBadge({ state }) {
  const m = STATE_META[state] || STATE_META.draft;
  return <span className={'badge '+m.cls}><span className="d" style={{background:m.dot}}></span>{m.label}</span>;
}

const TYPE_META = {
  prompt: { label:'Prompt', icon:'sparkle' },
  code:   { label:'Code',   icon:'code' },
  hybrid: { label:'Hybrid', icon:'bolt' },
};
function TypeChip({ type, mini }) {
  const m = TYPE_META[type] || TYPE_META.prompt;
  return <span className="kind"><Icon name={m.icon} size={mini?13:15} /> {!mini && m.label}</span>;
}

const VIS_META = {
  'internal-only':{ label:'Internal-only', icon:'lock' },
  'client-facing':{ label:'Client-facing', icon:'eye' },
  'paired':       { label:'Paired', icon:'layers' },
};
function VisChip({ visibility }) {
  const m = VIS_META[visibility] || VIS_META['internal-only'];
  return <span className="vis"><Icon name={m.icon} size={14} style={{color:'var(--muted)'}} /> {m.label}</span>;
}

function CertLocks({ skill, compact }) {
  const t = skill.tech.status === 'certified';
  const m = skill.method.status === 'certified';
  return (
    <div className="locks">
      <span className={'lockchip '+(t?'turned':'open')} title="MA Technologies — technical key">
        <Icon name={t?'lock':'unlock'} size={14} /> {!compact && 'Technical'}
      </span>
      <span className={'lockchip '+(m?'turned':'open')} title="Matt Maxwell — methodology key">
        <Icon name={m?'lock':'unlock'} size={14} /> {!compact && 'Methodology'}
      </span>
    </div>
  );
}

function fmtMs(ms){ return ms>=1000 ? (ms/1000).toFixed(1)+'s' : ms+'ms'; }
function fmtNum(n){ return n.toLocaleString('en-US'); }

// Tiny inline bar/spark chart helpers
function Sparkline({ data, w=160, h=42, color='var(--green-600)' }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((d,i)=>[ i/(data.length-1)*w, h - ((d-min)/(max-min||1))*(h-6) - 3 ]);
  const path = pts.map((p,i)=> (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const area = path+` L${w} ${h} L0 ${h} Z`;
  return (
    <svg width={w} height={h} style={{display:'block'}}>
      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.18"/><stop offset="1" stopColor={color} stopOpacity="0"/>
      </linearGradient></defs>
      <path d={area} fill="url(#spk)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

Object.assign(window, { Icon, Avatar, StateBadge, TypeChip, VisChip, CertLocks, Sparkline,
  STATE_META, TYPE_META, VIS_META, fmtMs, fmtNum });

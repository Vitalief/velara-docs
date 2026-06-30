/* app_v2.jsx — Velara v2 shell: horizontal appbar + appnav
   Default view: Engagements. Run Console reachable via skill/engagement Run buttons.
*/

/* ── TopBar override ────────────────────────────────────── */
function TopBar({ title, crumbs, actions }) {
  return (
    <div className="topbar">
      <div className="grow">
        {crumbs
          ? <div className="crumb">{crumbs}</div>
          : <div className="pagetitle">{title}</div>
        }
      </div>
      {actions}
    </div>
  );
}

/* ── InternalShell — appnav + main, no sidebar ─────────── */
function InternalShell({ view, setView, children }) {
  const queueCount   = DATA.skills.filter(s => s.inQueue).length;
  const skillCount   = DATA.skills.filter(s => !s.isClientVariant && s.state !== 'retired').length;
  const pendingKeys  = DATA.skills.filter(s => !s.isClientVariant && !s.inQueue && (s.tech.status!=='certified'||s.method.status!=='certified') && s.state!=='retired').length;
  const certAlert    = queueCount + pendingKeys;

  const nav = [
    { id: 'hierarchy', label: 'Engagements' },
    { id: 'registry',  label: 'Skill Registry', count: skillCount },
    { id: 'cert',      label: 'Certification',  alert: certAlert },
    { id: 'access',    label: 'Access Control' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'audit',     label: 'Audit Log' },
  ];

  return (
    <>
      <nav className="appnav">
        {nav.map(item => (
          <button
            key={item.id}
            className={'appnav-item' + (view === item.id ? ' on' : '')}
            onClick={() => setView(item.id)}
          >
            {item.label}
            {item.alert > 0 && <span className="appnav-badge">{item.alert}</span>}
            {item.count != null && !item.alert && <span className="appnav-count">{item.count}</span>}
          </button>
        ))}
      </nav>
      <div className="main">{children}</div>
    </>
  );
}

/* ── App ────────────────────────────────────────────────── */
function App() {
  const [role,       setRole]      = React.useState('internal');
  const [view,       setView]      = React.useState('hierarchy'); // Engagements is the landing page
  const [skillId,    setSkillId]   = React.useState(null);
  const [cmdOpen,    setCmdOpen]   = React.useState(false);
  const [runKey,     setRunKey]    = React.useState(0);   // incremented to force RunConsole remount
  const [runOrigin,  setRunOrigin] = React.useState('hierarchy'); // which nav tab to highlight during run

  React.useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCmdOpen(o => !o);
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const openSkill = id => { setSkillId(id); setView('skill'); setCmdOpen(false); };
  const goView    = v  => { setView(v); setSkillId(null); };

  /* Run from Skill Detail — skill locked, user selects any context */
  const handleSkillRun = id => {
    const _id = id;
    window.__runCtx = {
      ctx: { clientId:'', projectId:'', studyId:'' },
      skillId: id,
      mode: 'skill-first',
      onBack: () => { setSkillId(_id); setView('skill'); },
    };
    setRunOrigin('registry');
    setRunKey(k => k + 1);
    setView('run');
    setSkillId(null);
  };

  /* Run from Engagement — context pre-populated from hierarchy */
  const goRun = (skillId, entityType, entityId) => {
    let ctx = { clientId:'', projectId:'', studyId:'' };
    if (entityType === 'study') {
      const st   = DATA.studyById(entityId);
      const proj = DATA.projectById(st?.project);
      ctx = { clientId: proj?.client || '', projectId: st?.project || '', studyId: entityId };
    } else if (entityType === 'project') {
      const proj = DATA.projectById(entityId);
      ctx = { clientId: proj?.client || '', projectId: entityId, studyId: '' };
    }
    window.__runCtx = {
      ctx,
      skillId: skillId || '',
      mode: 'context-first',
      onBack: () => { setView('hierarchy'); setSkillId(null); },
    };
    setRunOrigin('hierarchy');
    setRunKey(k => k + 1);
    setView('run');
    setSkillId(null);
  };

  /* Which nav item to highlight */
  const activeNav = view === 'skill'      ? 'registry'
                  : view === 'run'        ? runOrigin
                  : view === 'validation' ? 'cert'
                  : view;

  return (
    <div className="app">

      {/* ── Appbar — always visible ── */}
      <header className="appbar">
        <div className="appbar-brand">
          <VLogo size={20} color="#fff"/>
          Velara
        </div>
        <span className="appbar-sub">A Vitalief Skills Platform</span>
        <div className="appbar-sep"></div>
        <span className="appbar-ctx">
          {role === 'internal' ? 'velara.vitalief.io' : 'bilh.velara.io'}
        </span>

        <div style={{ flex:1 }}></div>

        {role === 'internal' && (
          <>
            <button className="appbar-search" onClick={() => setCmdOpen(true)}>
              <Icon name="search" size={13}/>
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
            <div className="appbar-sep"></div>
          </>
        )}

        <div className="roleswitch">
          <button className={role === 'internal' ? 'on' : ''} onClick={() => setRole('internal')}>
            <Icon name="users" size={13}/> Vitalief
          </button>
          <button className={role === 'client' ? 'on' : ''} onClick={() => setRole('client')}>
            <Icon name="building" size={13}/> Client
          </button>
        </div>

        <div className="appbar-sep"></div>

        <div className="appbar-pill">
          <span className="appbar-dot" style={{ background: role === 'internal' ? '#5ecfcc' : '#7bbfd4' }}></span>
          {role === 'internal' ? 'Full access' : 'Outputs only'}
        </div>

        {role === 'internal' && (
          <>
            <div className="appbar-sep"></div>
            <div className="row gap8" style={{ cursor:'default' }}>
              <Avatar p="matt" size={28}/>
              <div style={{ lineHeight:1.25 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#d5e8f2' }}>M. Maxwell</div>
                <div style={{ fontSize:10.5, color:'#6da8bc' }}>Methodology key</div>
              </div>
            </div>
          </>
        )}
      </header>

      {/* ── Content ── */}
      {role === 'internal' ? (
        <InternalShell view={activeNav} setView={goView}>
          {view === 'hierarchy'               && <OrgHierarchy onRunSkill={goRun}/>}
          {view === 'registry'                   && <Registry     onOpen={openSkill}/>}
          {view === 'skill'                      && <SkillDetail  id={skillId} onBack={() => goView('registry')} onOpen={openSkill} onRun={handleSkillRun}/>}
          {view === 'run'                        && <RunConsole   key={runKey}/>}
          {(view==='cert'||view==='validation')  && <CertPipeline onOpen={openSkill}/>}
          {view === 'access'                     && <AccessControl onOpen={openSkill}/>}
          {view === 'analytics'                  && <Analytics/>}
          {view === 'audit'                      && <AuditLog/>}
        </InternalShell>
      ) : (
        <div style={{ flex:1, overflow:'auto' }}>
          <ClientApp/>
        </div>
      )}

      {cmdOpen && (
        <CmdPalette onClose={() => setCmdOpen(false)} onOpen={openSkill} onView={goView}/>
      )}
    </div>
  );
}

/* ── CmdPalette ─────────────────────────────────────────── */
function CmdPalette({ onClose, onOpen, onView }) {
  const [q, setQ] = React.useState('');
  const inputRef  = React.useRef(null);
  React.useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  const skills = DATA.skills
    .filter(s => !s.isClientVariant && (s.name + s.tags.join()).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 6);

  const views = [
    ['hierarchy',  'Engagements',    'layers'],
    ['registry',   'Skill Registry', 'registry'],
    ['cert',       'Certification',  'cert'],
    ['analytics',  'Usage & Value',  'chart'],
    ['audit',      'Audit Log',      'audit'],
    ['access',     'Access Control', 'shield'],
  ].filter(v => v[1].toLowerCase().includes(q.toLowerCase()));

  const rowHover = e => e.currentTarget.style.background = 'var(--surface-sunk)';
  const rowLeave = e => e.currentTarget.style.background = 'transparent';

  return (
    <div className="overlay" style={{ alignItems:'flex-start', justifyContent:'center', paddingTop:'12vh' }} onClick={onClose}>
      <div className="modal" style={{ width:'min(580px,92vw)', overflow:'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="row gap10" style={{ padding:'16px 18px', borderBottom:'1px solid var(--line)' }}>
          <Icon name="search" size={18} style={{ color:'var(--faint)' }}/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search skills and views…"
            style={{ border:0, outline:0, flex:1, fontFamily:'var(--sans)', fontSize:15.5, background:'transparent', color:'var(--ink)' }}/>
          <kbd style={{ fontFamily:'var(--mono)', fontSize:11, background:'var(--surface-sunk)', border:'1px solid var(--line-2)', borderRadius:4, padding:'2px 6px', color:'var(--muted)' }}>esc</kbd>
        </div>
        <div style={{ maxHeight:'46vh', overflowY:'auto', padding:'8px' }}>
          {skills.length > 0 && (
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.06em', color:'var(--faint)', padding:'8px 10px 4px' }}>SKILLS</div>
          )}
          {skills.map(s => (
            <div key={s.id} className="row gap12" onClick={() => onOpen(s.id)}
              style={{ padding:'9px 10px', borderRadius:8, cursor:'pointer' }}
              onMouseEnter={rowHover} onMouseLeave={rowLeave}>
              <Icon name={TYPE_META[s.type].icon} size={16} style={{ color:'var(--muted)' }}/>
              <span className="grow" style={{ fontSize:13.5, fontWeight:500 }}>{s.name}</span>
              <StateBadge state={s.state}/>
            </div>
          ))}
          {views.length > 0 && (
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.06em', color:'var(--faint)', padding:'10px 10px 4px' }}>GO TO</div>
          )}
          {views.map(([id, label, icon]) => (
            <div key={id} className="row gap12" onClick={() => { onView(id); onClose(); }}
              style={{ padding:'9px 10px', borderRadius:8, cursor:'pointer' }}
              onMouseEnter={rowHover} onMouseLeave={rowLeave}>
              <Icon name={icon} size={16} style={{ color:'var(--muted)' }}/>
              <span className="grow" style={{ fontSize:13.5, fontWeight:500 }}>{label}</span>
              <Icon name="arrowR" size={14} style={{ color:'var(--faint)' }}/>
            </div>
          ))}
          {skills.length === 0 && views.length === 0 && (
            <div className="muted" style={{ padding:'24px', textAlign:'center', fontSize:13.5 }}>No matches.</div>
          )}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

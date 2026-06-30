/* overrides.jsx — Velara v2 behaviour overrides
   Loaded after all base components, before app_v2.jsx.
   Overrides: SkillDetail (onRun), RunConsole (pre-init),
              EntityDetail (Run buttons), OrgHierarchy (onRunSkill)
*/

/* ── Extend Add Location modal with Postal code field ─── */
/* ADD_FIELDS is a var-hoisted global from hierarchy.jsx   */
if (typeof ADD_FIELDS !== 'undefined' && ADD_FIELDS.location
    && !ADD_FIELDS.location.find(function(f){ return f.id==='postal'; })) {
  /* insert after 'city' (index 2), before 'pi' */
  ADD_FIELDS.location.splice(3, 0, { id:'postal', label:'Postal code', ph:'02114' });
}

/* ── SkillDetail — wires the Run button to onRun prop ─── */
function SkillDetail({ id, onBack, onOpen, onRun }) {
  const s      = DATA.skillById(id);
  const [tab,      setTab]      = useState('overview');
  const [managing, setManaging] = useState(false);
  const child  = s.lineageChildId ? DATA.skillById(s.lineageChildId) : null;
  const parent = s.parentId       ? DATA.skillById(s.parentId)       : null;
  const both   = s.tech.status === 'certified' && s.method.status === 'certified';
  const tabs   = [['overview','Overview'],['versions','Versions'],['lineage','Lineage'],['usage','Usage'],['access','Access']];

  return (
    <>
      <TopBar
        crumbs={
          <><span onClick={onBack} style={{cursor:'pointer'}}>Skill Registry</span>
            <Icon name="chevron" size={14}/><b>{s.name}</b></>
        }
        actions={
          <div className="row gap8">
            <button className="btn btn-ghost" onClick={onBack}>
              <Icon name="arrowR" size={15} style={{transform:'rotate(180deg)'}}/> Back
            </button>
            <button className="btn btn-ghost" onClick={() => onRun && onRun(id)}>
              <Icon name="play" size={14}/> Run
            </button>
            <button className="btn btn-primary" onClick={() => setManaging(true)}>
              <Icon name="settings" size={14}/> Manage
            </button>
          </div>
        }
      />
      <div className="content">
        <div className="wrap fade-in">
          <div className="row gap16" style={{alignItems:'flex-start', marginBottom:18}}>
            <div className="grow">
              <div className="row gap10" style={{marginBottom:8}}>
                <StateBadge state={s.state}/>
                <VisChip visibility={s.visibility}/>
                {s.isClientVariant && <span className="tag">Derived variant</span>}
              </div>
              <h1 style={{fontSize:28, marginBottom:8}}>{s.name}</h1>
              <p className="muted" style={{maxWidth:680, fontSize:15, lineHeight:1.5, margin:0}}>{s.desc}</p>
              <div className="row gap16" style={{marginTop:14, flexWrap:'wrap'}}>
                <span className="mono" style={{fontSize:12, color:'var(--faint)'}}>{s.id}</span>
                <span className="row gap6" style={{fontSize:12.5,color:'var(--muted)'}}><Icon name="user" size={14}/> {DATA.people[s.owner].name}</span>
                <span className="row gap6" style={{fontSize:12.5,color:'var(--muted)'}}><Icon name="clock" size={14}/> Updated {s.modified}</span>
                <TypeChip type={s.type}/>
              </div>
            </div>
            <div className="card card-pad" style={{width:280, flex:'none'}}>
              <div style={{fontSize:11.5,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--faint)',marginBottom:10}}>
                Certification · v{s.version}
              </div>
              <CertLocks skill={s}/>
              <div style={{marginTop:12,padding:'10px 12px',borderRadius:8,fontSize:12.5,fontWeight:600,
                background:both?'var(--green-50)':'var(--surface-sunk)',
                color:both?'var(--green-700)':'var(--muted)'}}>
                {both ? '✓ Both keys turned — client-ready' : 'Awaiting both keys before client-ready'}
              </div>
            </div>
          </div>

          <div className="tabs" style={{marginBottom:22}}>
            {tabs.map(([t,l]) => (
              (t==='lineage' && s.visibility!=='paired' && !parent && !child) ? null :
              <div key={t} className={'tab'+(tab===t?' on':'')} onClick={() => setTab(t)}>{l}</div>
            ))}
          </div>

          {tab==='overview' && <OverviewTab s={s}/>}
          {tab==='versions' && <VersionsTab s={s}/>}
          {tab==='lineage'  && <LineageTab  s={s} parent={parent} child={child} onOpen={onOpen}/>}
          {tab==='usage'    && <UsageTab    s={s}/>}
          {tab==='access'   && <AccessTab   s={s}/>}
        </div>
      </div>
      {managing && <ManageSkillModal skill={s} onClose={() => setManaging(false)}/>}
    </>
  );
}

/* ── RunConsole — mode + onBack + skill-first layout ────── */
function RunConsole() {
  const _init = window.__runCtx || null;
  if (_init) window.__runCtx = null;

  const [ctx,      setCtx]      = useState(_init && _init.ctx ? _init.ctx : { clientId:'', projectId:'', studyId:'' });
  const [phase,    setPhase]    = useState('idle');
  const [progress, setProgress] = useState(0);
  const [file,     setFile]     = useState(null);
  const [surface,  setSurface]  = useState('Web');
  const [selSkill, setSelSkill] = useState(_init ? (_init.skillId || '') : '');
  const [onBack]  = useState(function(){ return _init && _init.onBack ? _init.onBack : null; });
  const [mode]    = useState(_init && _init.mode ? _init.mode : 'context-first');
  const timer = useRef(null);

  const availableSkills = useMemo(() => {
    if (mode === 'skill-first') {
      if (!selSkill) return [];
      const sk = DATA.skillById(selSkill);
      return (sk && (sk.state==='client-ready'||sk.state==='internal-ready'))
        ? [{ skillId:selSkill, skill:sk }] : [];
    }
    const results = [];
    if (ctx.studyId)   results.push(...DATA.skillsAt('study',   ctx.studyId));
    if (ctx.projectId && (!ctx.studyId || DATA.projectById(ctx.projectId)?.skillsAtProject))
      results.push(...DATA.skillsAt('project', ctx.projectId));
    return results.filter(a => a.skill?.state==='client-ready'||a.skill?.state==='internal-ready');
  }, [ctx, mode, selSkill]);

  const s = mode === 'skill-first' && selSkill
    ? DATA.skillById(selSkill)
    : availableSkills.find(a => a.skillId === selSkill)?.skill;

  const contextPath = ctx.studyId   ? DATA.displayPath('study',   ctx.studyId)
                    : ctx.projectId ? DATA.displayPath('project', ctx.projectId) : '';

  const start = () => {
    setPhase('running'); setProgress(0); let p = 0;
    timer.current = setInterval(() => {
      p += Math.random() * 16 + 6;
      if (p >= 100) { p=100; clearInterval(timer.current); setProgress(100); setTimeout(() => setPhase('done'), 350); }
      setProgress(Math.min(100, p));
    }, 240);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  const reset = () => { setPhase('idle'); setProgress(0); setFile(null); };

  const steps      = s ? ['Validating input file','Loading skill v'+s.version,'Executing in sandbox','Generating output','Writing audit entry'] : [];
  const activeStep = steps.length ? Math.min(steps.length-1, Math.floor(progress/(100/steps.length))) : 0;
  const outFiles   = s ? (s.outputs.match(/(PDF|PPTX|DOCX|XLSX|CSV)/g)||['PDF']) : [];

  const crumbs = onBack
    ? <><span onClick={onBack} style={{cursor:'pointer'}}>Back</span><Icon name="chevron" size={14}/><b>Run Console</b></>
    : undefined;

  return (
    <>
      <TopBar
        title={onBack ? undefined : 'Run Console'}
        crumbs={crumbs}
        actions={<span className="chip"><Icon name="bolt" size={13}/> Sandboxed · audited · context-scoped</span>}
      />
      <div className="content">
        <div className="wrap fade-in" style={{display:'grid', gridTemplateColumns:'1fr 1.1fr', gap:24, alignItems:'start'}}>

          {/* left: config */}
          <div style={{display:'flex', flexDirection:'column', gap:16}}>

            {/* skill-first: locked skill card */}
            {mode === 'skill-first' && s && (
              <div className="card card-pad" style={{borderColor:'var(--green-100)', background:'var(--green-50)'}}>
                <div style={{fontSize:10.5,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--green-600)',marginBottom:10}}>Running skill</div>
                <div style={{fontWeight:700, fontSize:16, color:'var(--ink)', marginBottom:6}}>{s.name}</div>
                <div className="row gap8" style={{marginBottom:8}}>
                  <TypeChip type={s.type}/><VisChip visibility={s.visibility}/><span className="ver">{s.version}</span>
                </div>
                <div className="muted" style={{fontSize:13, lineHeight:1.45}}>{s.desc}</div>
              </div>
            )}

            {/* context picker — always shown */}
            <div className="card card-pad">
              <h3 style={{fontSize:15, marginBottom:12}}>Engagement context</h3>
              <HierarchyPicker value={ctx} onChange={c => { setCtx(c); if (mode !== 'skill-first') setSelSkill(''); reset(); }}/>
            </div>

            {/* skill picker — context-first only */}
            {mode !== 'skill-first' && ctx.projectId && (
              <div className="card card-pad">
                <h3 style={{fontSize:15, marginBottom:12}}>Skill</h3>
                {availableSkills.length ? (
                  <>
                    <select value={selSkill} onChange={e => { setSelSkill(e.target.value); reset(); }}
                      style={{...selStyle, marginBottom:10}}>
                      <option value="">— select a skill —</option>
                      {availableSkills.map(a => (
                        <option key={a.skillId} value={a.skillId}>{a.skill.name} · v{a.skill.version}</option>
                      ))}
                    </select>
                    {s && <div className="row gap10"><TypeChip type={s.type}/><VisChip visibility={s.visibility}/><span className="ver">{s.version}</span></div>}
                  </>
                ) : (
                  <div className="muted" style={{fontSize:13}}>No certified skills attached at this level yet.</div>
                )}
              </div>
            )}

            {/* input + invoke — skill resolved AND project selected */}
            {s && ctx.projectId && (
              <div className="card card-pad">
                <h3 style={{fontSize:15, marginBottom:10}}>
                  Input · <span className="muted" style={{fontFamily:'var(--sans)', fontSize:13}}>{s.inputs}</span>
                </h3>
                <div className="fileph" style={{height:90, flexDirection:'column', gap:8, cursor:'pointer',
                  background:file?'var(--green-50)':undefined, borderColor:file?'var(--green-300)':undefined}}
                  onClick={() => setFile(f => f ? null : {name:s.id+'_input.xlsx', size:'2.4 MB'})}>
                  {file
                    ? <><Icon name="file" size={20} style={{color:'var(--green-600)'}}/><span style={{color:'var(--green-700)',fontFamily:'var(--sans)',fontWeight:600,fontSize:13}}>{file.name}</span><span style={{fontSize:11}}>{file.size} · click to remove</span></>
                    : <><Icon name="upload" size={20}/><span style={{fontFamily:'var(--sans)',fontSize:13,color:'var(--muted)'}}>Drop file or click to attach</span></>}
                </div>
                <div className="row gap8" style={{marginTop:12, flexWrap:'wrap'}}>
                  {['Web','Claude','API','Client Portal'].map(x => (
                    <button key={x} onClick={() => setSurface(x)} className="btn btn-sm" style={{
                      background: surface===x ? 'var(--green-50)'  : 'var(--surface)',
                      color:      surface===x ? 'var(--green-800)' : 'var(--ink-2)',
                      border: '1px solid '+(surface===x ? 'var(--green-300)' : 'var(--line-2)'),
                    }}>{x}</button>
                  ))}
                </div>
                <button className="btn btn-primary btn-lg" disabled={!file||phase==='running'} onClick={start}
                  style={{width:'100%', justifyContent:'center', marginTop:14, opacity:(!file||phase==='running')?.5:1}}>
                  {phase==='running'
                    ? <><Icon name="settings" size={15} className="spin"/> Running…</>
                    : <><Icon name="play" size={15}/> Invoke skill</>}
                </button>
              </div>
            )}
          </div>

          {/* right: result */}
          <div className="card card-pad" style={{minHeight:340}}>
            {phase==='idle' && !s && (
              <div style={{textAlign:'center', padding:'60px 20px', color:'var(--faint)'}}>
                <div style={{width:52,height:52,borderRadius:12,background:'var(--surface-sunk)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}>
                  <Icon name="bolt" size={24}/>
                </div>
                <div style={{fontSize:14, color:'var(--muted)'}}>
                  {mode === 'skill-first' ? 'Select an engagement context to continue' : 'Select an engagement context and skill to begin'}
                </div>
              </div>
            )}
            {phase==='idle' && s && (
              <div>
                <h3 style={{fontSize:15, marginBottom:10}}>Ready to run</h3>
                <div style={{padding:'12px 14px',borderRadius:9,background:'var(--surface-sunk)',fontSize:13,color:'var(--ink-2)',marginBottom:12}} className="row gap8">
                  <Icon name="layers" size={14} style={{color:'var(--muted)'}}/>
                  <span className="mono">{contextPath || '— select a project or study above —'}</span>
                </div>
                <div style={{fontSize:13.5}}><b>{s.name}</b></div>
                <div className="muted" style={{fontSize:13, marginTop:4, lineHeight:1.45}}>{s.desc}</div>
                <div style={{marginTop:12,fontSize:12.5,color:'var(--muted)'}}>
                  {ctx.projectId ? 'Attach a file above to invoke.' : 'Select a project or study context above.'}
                </div>
              </div>
            )}
            {phase!=='idle' && s && (
              <div>
                <div className="row" style={{justifyContent:'space-between', marginBottom:14}}>
                  <h3 style={{fontSize:16}}>{phase==='done' ? 'Run complete' : 'Executing'}</h3>
                  <span className="mono faint" style={{fontSize:12}}>inv-{Math.floor(9013+Math.random()*40)}</span>
                </div>
                <div className="barwrap" style={{height:8, marginBottom:18}}>
                  <div className="bar" style={{width:progress+'%'}}></div>
                </div>
                {steps.map((st, i) => {
                  const state = phase==='done'||i<activeStep?'done':i===activeStep?'active':'pend';
                  return (
                    <div key={i} className="row gap10" style={{padding:'7px 0', fontSize:13, opacity:state==='pend'?.4:1}}>
                      <span className="cb" style={{width:18,height:18,borderRadius:5,flex:'none',display:'flex',alignItems:'center',justifyContent:'center',
                        background:state==='done'?'var(--green-600)':state==='active'?'var(--green-100)':'var(--surface-sunk)',
                        color:state==='done'?'#fff':'var(--green-700)'}}>
                        {state==='done'?<Icon name="check" size={11}/>:state==='active'?<Icon name="settings" size={11} className="spin"/>:null}
                      </span>
                      <span>{st}</span>
                    </div>
                  );
                })}
                {phase==='done' && (
                  <div className="fade-in" style={{marginTop:18, paddingTop:16, borderTop:'1px solid var(--line)'}}>
                    <div style={{fontSize:12,fontWeight:700,letterSpacing:'.04em',color:'var(--faint)',marginBottom:10}}>GENERATED OUTPUTS</div>
                    <div className="row gap10" style={{flexWrap:'wrap', marginBottom:16}}>
                      {outFiles.map(f => (
                        <div key={f} className="row gap10" style={{border:'1px solid var(--line-2)',borderRadius:9,padding:'10px 14px',background:'var(--surface-2)'}}>
                          <Icon name="doc2" size={18} style={{color:'var(--green-600)'}}/>
                          <div>
                            <div style={{fontWeight:600,fontSize:13}}>{s.id.split('-').slice(0,2).join('_')}.{f.toLowerCase()}</div>
                            <div className="mono faint" style={{fontSize:11}}>{f} · Vitalief brand</div>
                          </div>
                          <button className="btn btn-quiet btn-sm"><Icon name="download" size={14}/></button>
                        </div>
                      ))}
                    </div>
                    <div className="row gap10" style={{padding:'10px 14px',borderRadius:9,background:'var(--surface-sunk)',fontSize:12.5}}>
                      <Icon name="audit" size={15} style={{color:'var(--muted)'}}/>
                      <div className="grow">
                        <div className="muted">Audit entry stamped</div>
                        <div className="mono" style={{fontSize:10.5,color:'var(--faint)',marginTop:2}}>{contextPath}</div>
                      </div>
                      <span className="badge badge-state-client"><Icon name="check" size={11}/> success</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{marginTop:14}} onClick={reset}>
                      <Icon name="play" size={13}/> Run again
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

/* ── BreadcrumbBar — full hierarchy path above detail cards ── */
function BreadcrumbBar({ type, id, onSelect }) {
  if (type === 'org' || type === 'client') return null;
  const segs = DATA.entityPath(type, id).filter(s => s.type !== 'org');
  if (segs.length <= 1) return null;
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:2, flexWrap:'wrap',
      padding:'9px 14px', borderRadius:10,
      background:'var(--surface-2)', border:'1px solid var(--line)',
    }}>
      {segs.map((seg, i) => {
        const sm    = ENTITY[seg.type];
        const isLast = i === segs.length - 1;
        return (
          <React.Fragment key={seg.id}>
            {i > 0 && (
              <Icon name="chevron" size={12} style={{color:'var(--line-strong)', flexShrink:0, margin:'0 1px'}}/>
            )}
            <button
              onClick={() => !isLast && onSelect && onSelect(seg.type, seg.id)}
              style={{
                display:'inline-flex', alignItems:'center', gap:6,
                border:0, padding:'4px 7px', borderRadius:7,
                cursor: isLast ? 'default' : 'pointer',
                fontFamily:'var(--sans)', fontSize:12.5,
                fontWeight: isLast ? 700 : 500,
                color: isLast ? 'var(--ink)' : 'var(--muted)',
                background:'transparent',
              }}
              onMouseEnter={e => { if (!isLast) e.currentTarget.style.background = 'var(--surface-sunk)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{
                width:18, height:18, borderRadius:5, flexShrink:0,
                background:sm.bg, display:'inline-flex', alignItems:'center', justifyContent:'center',
              }}>
                <Icon name={sm.icon} size={10} style={{color:sm.color}}/>
              </span>
              <span style={{ maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{seg.name}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── EntityDetail — adds Run buttons on project/study skill chips ── */
function EntityDetail({ type, id, onSelect, onAdd, onRunSkill }) {
  const m = ENTITY[type];
  let entity, children = [], childType = null, childLabel = '';

  if (type==='org')      { entity = DATA.orgs?.find(x=>x.id===id); children = DATA.clients.filter(c=>c.org===id); childType='client'; childLabel='Clients'; }
  else if (type==='client')  { entity = DATA.clients.find(x=>x.id===id);  children = DATA.projects.filter(p=>p.client===id); childType='project'; childLabel='Projects'; }
  else if (type==='project') { entity = DATA.projects.find(x=>x.id===id); children = DATA.studies.filter(s=>s.project===id); childType='study';   childLabel='Studies'; }
  else if (type==='study')   { entity = DATA.studies.find(x=>x.id===id);  children = DATA.locations.filter(l=>l.study===id); childType='location'; childLabel='Locations'; }
  else if (type==='location'){ entity = DATA.locations.find(x=>x.id===id); }

  if (!entity) return null;

  const assignments = DATA.skillAssignments.filter(a => a.entityType===type && a.entityId===id);
  const parentAssignments = (() => {
    if (type==='location') return DATA.skillAssignments.filter(a => a.entityType==='study'   && a.entityId===entity.study);
    if (type==='study')    return DATA.skillAssignments.filter(a => a.entityType==='project' && a.entityId===DATA.studies.find(x=>x.id===id)?.project);
    return [];
  })();

  const statusColor = v => v==='active'?'var(--st-client-tx)':v==='paused'?'var(--st-internal-tx)':'var(--muted)';
  const statusBg    = v => v==='active'?'var(--st-client-bg)':v==='paused'?'var(--st-internal-bg)':'var(--surface-sunk)';
  const canRun      = sk => onRunSkill && (sk.state==='client-ready' || sk.state==='internal-ready');

  return (
    <div className="fade-in" style={{display:'flex', flexDirection:'column', gap:18}}>

      {/* Breadcrumb — project / study / location only */}
      <BreadcrumbBar type={type} id={id} onSelect={onSelect}/>

      {/* header card */}
      <div className="card card-pad">
        <div className="row gap10" style={{marginBottom:12}}>
          <EntityBadge type={type}/>
          {entity.status && <span style={{fontSize:11.5,fontWeight:700,background:statusBg(entity.status),color:statusColor(entity.status),padding:'3px 10px',borderRadius:999}}>{entity.status}</span>}
          {entity.active===false && type==='client' && <span style={{fontSize:11.5,fontWeight:700,background:'var(--st-retired-bg)',color:'var(--st-retired)',padding:'3px 10px',borderRadius:999}}>paused</span>}
        </div>
        <div className="row gap16" style={{alignItems:'flex-start'}}>
          <div className="grow">
            <h2 style={{fontSize:24, marginBottom:8}}>{entity.name}</h2>
            <p className="muted" style={{margin:'0 0 12px', fontSize:14, lineHeight:1.5}}>{entity.desc}</p>
          </div>
          {type!=='org' && (
            <div style={{width:36,height:36,borderRadius:10,background:m.bg,display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>
              <Icon name={m.icon} size={20} style={{color:m.color}}/>
            </div>
          )}
        </div>
        <div className="row gap0" style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--line)',gap:24,flexWrap:'wrap'}}>
          {entity.code      && <MetaChip k="Code"                    v={entity.code} mono/>}
          {entity.created   && <MetaChip k="Created"                 v={entity.created}/>}
          {entity.lead      && <MetaChip k="Lead"                    v={DATA.people[entity.lead]?.name}/>}
          {entity.phase     && <MetaChip k="Phase"                   v={entity.phase}/>}
          {entity.sponsor   && <MetaChip k="Sponsor"                 v={entity.sponsor}/>}
          {entity.pi        && <MetaChip k="Principal Investigator"  v={entity.pi}/>}
          {entity.city      && <MetaChip k="Site city"               v={entity.city}/>}
          {entity.activated && <MetaChip k="Activated"               v={entity.activated}/>}
          {type==='project' && <MetaChip k="Skill level" v={entity.skillsAtProject?'Project-level':'Study-level'}/>}
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns: children.length ? '1fr 1fr' : '1fr', gap:18, alignItems:'start'}}>

        {/* children panel */}
        {childType && (
          <div className="card card-pad">
            <div className="row" style={{justifyContent:'space-between', marginBottom:14}}>
              <h3 style={{fontSize:15}}>{childLabel} <span className="faint mono" style={{fontSize:12}}>· {children.length}</span></h3>
              {(childType!=='location' || type==='study') && (
                <button className="btn btn-primary btn-sm" onClick={() => onAdd(childType, type, id)}>
                  <Icon name="plus" size={13}/> Add {ENTITY[childType].label}
                </button>
              )}
            </div>
            {children.length ? (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {children.map(c => {
                  const cm = ENTITY[childType];
                  return (
                    <div key={c.id} className="row gap12" onClick={() => onSelect(childType, c.id)}
                      style={{padding:'11px 13px',borderRadius:10,border:'1px solid var(--line)',cursor:'pointer',background:'var(--surface)'}}
                      onMouseEnter={e => e.currentTarget.style.borderColor='var(--line-strong)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor='var(--line)'}>
                      <span style={{width:32,height:32,borderRadius:8,background:cm.bg,display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>
                        <Icon name={cm.icon} size={16} style={{color:cm.color}}/>
                      </span>
                      <div className="grow">
                        <div style={{fontWeight:600,fontSize:13.5}}>{c.name}</div>
                        <div className="muted" style={{fontSize:12}}>{c.code||c.city||''}</div>
                      </div>
                      {c.status && <span style={{fontSize:11,fontWeight:700,background:statusBg(c.status),color:statusColor(c.status),padding:'2px 8px',borderRadius:999}}>{c.status}</span>}
                      {c.active===false && childType==='client' && <span style={{fontSize:11,fontWeight:700,background:'var(--st-retired-bg)',color:'var(--st-retired)',padding:'2px 8px',borderRadius:999}}>paused</span>}
                      <Icon name="chevron" size={15} style={{color:'var(--faint)'}}/>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{fontSize:13.5, padding:'8px 0'}}>
                No {childLabel.toLowerCase()} yet.
                {type==='project' && childType==='study' && entity.skillsAtProject && (
                  <span> Skills are attached at project level for this engagement.</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* attached skills panel */}
        {(type==='project' || type==='study' || (type==='location' && (assignments.length>0||parentAssignments.length>0))) && (
          <div className="card card-pad">
            <div className="row" style={{justifyContent:'space-between', marginBottom:14}}>
              <div>
                <h3 style={{fontSize:15}}>Attached skills <span className="faint mono" style={{fontSize:12}}>· {assignments.length}</span></h3>
                {type==='project' && !entity.skillsAtProject && assignments.length===0 && (
                  <div style={{fontSize:12,color:'var(--muted)',marginTop:3}}>Skills here are available across all studies in this project</div>
                )}
              </div>
              {(type==='project'||type==='study') && (
                <button className="btn btn-ghost btn-sm" onClick={() => onAdd('skill-attach', type, id)}>
                  <Icon name="plus" size={13}/> Attach
                </button>
              )}
            </div>

            {assignments.length ? (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {assignments.map(a => {
                  const sk = DATA.skillById(a.skillId);
                  if (!sk) return null;
                  return (
                    <div key={a.id} className="row gap10" style={{padding:'10px 12px',borderRadius:10,border:'1px solid var(--line)',background:'var(--surface)'}}>
                      <Icon name={TYPE_META[sk.type].icon} size={15} style={{color:'var(--muted)'}}/>
                      <div className="grow">
                        <div style={{fontWeight:600, fontSize:13}}>{sk.name}</div>
                        <div className="muted" style={{fontSize:11.5}}>v{sk.version} · granted {a.grantedAt} by {DATA.people[a.grantedBy]?.short}</div>
                      </div>
                      <StateBadge state={sk.state}/>
                      {canRun(sk) && (
                        <button className="btn btn-ghost btn-sm" style={{flexShrink:0, gap:5}}
                          onClick={e => { e.stopPropagation(); onRunSkill(sk.id, type, id); }}>
                          <Icon name="play" size={12}/> Run
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{fontSize:13.5}}>No skills directly attached at this level.</div>
            )}

            {parentAssignments.length > 0 && (
              <>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'.05em',color:'var(--faint)',margin:'14px 0 8px',textTransform:'uppercase'}}>Inherited from parent level</div>
                {parentAssignments.map(a => {
                  const sk = DATA.skillById(a.skillId);
                  if (!sk) return null;
                  return (
                    <div key={a.id} className="row gap10" style={{padding:'8px 12px',borderRadius:10,border:'1px dashed var(--line-2)',background:'var(--surface-2)'}}>
                      <Icon name={TYPE_META[sk.type].icon} size={14} style={{color:'var(--faint)'}}/>
                      <div className="grow"><div style={{fontWeight:500,fontSize:13,color:'var(--muted)'}}>{sk.name}</div></div>
                      <StateBadge state={sk.state}/>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* context path */}
      <div className="card card-pad" style={{background:'var(--surface-2)'}}>
        <div className="row gap8" style={{marginBottom:8}}>
          <Icon name="audit" size={15} style={{color:'var(--muted)'}}/>
          <div style={{fontSize:12,fontWeight:700,letterSpacing:'.04em',color:'var(--muted)',textTransform:'uppercase'}}>Context path</div>
        </div>
        <div className="mono" style={{fontSize:12.5,color:'var(--ink-2)',padding:'8px 12px',background:'var(--surface-sunk)',borderRadius:8,border:'1px solid var(--line)'}}>
          {DATA.displayPath(type, id)}
        </div>
        <div className="muted" style={{fontSize:12, marginTop:8}}>All access control policies, audit events, and invocation records for this entity carry this context path.</div>
      </div>
    </div>
  );
}

/* ── CertPipeline — merges Validation Queue + Certification ── */
function CertPipeline({ onOpen }) {
  const [tab, setTab] = useState('validation');
  const queueCount  = DATA.skills.filter(s => s.inQueue).length;
  const pendingKeys = DATA.skills.filter(s =>
    !s.inQueue &&
    (s.tech.status !== 'certified' || s.method.status !== 'certified') &&
    s.state !== 'retired'
  ).length;

  return (
    <>
      <TopBar title="Certification Pipeline" actions={
        <span className="chip"><Icon name="cert" size={13}/> Two-key model · technical + methodology</span>
      }/>
      {/* in-page sub-tabs */}
      <div className="tabs" style={{padding:'0 28px', background:'var(--paper)', flexShrink:0}}>
        <div className={'tab'+(tab==='validation'?' on':'')} onClick={()=>setTab('validation')}>
          Validation Queue
          {queueCount>0 && <span className="appnav-badge" style={{marginLeft:7}}>{queueCount}</span>}
        </div>
        <div className={'tab'+(tab==='cert'?' on':'')} onClick={()=>setTab('cert')}>
          Awaiting Keys
          {pendingKeys>0 && <span className="appnav-badge" style={{marginLeft:7}}>{pendingKeys}</span>}
        </div>
      </div>
      {/* display:contents so inner .content gets flex:1 directly from .main */}
      <div className="cert-inner" style={{display:'contents'}}>
        {tab==='validation' && <ValidationQueue onOpen={onOpen}/>}
        {tab==='cert'       && <Certification   onOpen={onOpen}/>}
      </div>
    </>
  );
}

/* ── OrgHierarchy — search/filter + threads onRunSkill down to EntityDetail ── */
function OrgHierarchy({ onRunSkill }) {
  const [sel,          setSel]          = React.useState({ type:'client', id:'cli-bilh' });
  const [expanded,     setExpanded]     = React.useState(new Set(['cli-bilh','prj-bilh-onc']));
  const [addModal,     setAddModal]     = React.useState(null);
  const [query,        setQuery]        = React.useState('');
  const [typeFilter,   setTypeFilter]   = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const searchRef = React.useRef(null);

  const isFiltered = query.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all';

  const expandToEntity = (type, id) => {
    setExpanded(ex => {
      const next = new Set(ex);
      if (type === 'client')   { next.add(id); }
      if (type === 'project')  { const p = DATA.projectById(id);  if(p) { next.add(p.client); next.add(id); } }
      if (type === 'study')    { const s = DATA.studyById(id);    if(s) { const p = DATA.projectById(s.project); if(p) next.add(p.client); next.add(s.project); next.add(id); } }
      if (type === 'location') { const l = DATA.locationById(id); if(l) { const s = DATA.studyById(l.study); if(s) { const p = DATA.projectById(s.project); if(p) next.add(p.client); next.add(s.project); next.add(s.id); } next.add(id); } }
      return next;
    });
  };

  const handleSelect = (type, id) => {
    // Tree clicks: just update selection — HierarchyTree manages its own toggle
    setSel({ type, id });
  };

  const handleSearchSelect = (type, id) => {
    // Search result clicks: expand tree path + clear filters
    setSel({ type, id });
    expandToEntity(type, id);
    setQuery(''); setTypeFilter('all'); setStatusFilter('all');
  };

  const handleDetailSelect = (type, id) => {
    // Clicking a child entity inside the detail panel: expand tree to reveal it
    setSel({ type, id });
    expandToEntity(type, id);
  };

  const clearFilters = () => { setQuery(''); setTypeFilter('all'); setStatusFilter('all'); };

  const TYPE_TABS = [
    { id:'all',     label:'All'     },
    { id:'client',  label:'Client'  },
    { id:'project', label:'Project' },
    { id:'study',   label:'Study'   },
    { id:'site',    label:'Site'    },
  ];

  return (
    <>
      <TopBar title="Engagements" actions={
        <div className="row gap8">
          <button className="btn btn-ghost btn-sm"><Icon name="history" size={14}/> Audit trail</button>
          <button className="btn btn-primary btn-sm"
            onClick={() => setAddModal({ childType:'client', parentType:'org', parentId:'org-vitalief' })}>
            <Icon name="plus" size={14}/> New client
          </button>
        </div>
      }/>
      <div className="content">
        <div style={{display:'flex', height:'100%'}}>

          {/* ── Tree panel ── */}
          <div style={{width:272,flex:'none',borderRight:'1px solid var(--line)',background:'var(--surface-2)',display:'flex',flexDirection:'column'}}>

            {/* Search + filters */}
            <div style={{padding:'10px 10px 10px', borderBottom:'1px solid var(--line)'}}>

              {/* Search input */}
              <div style={{position:'relative', display:'flex', alignItems:'center', marginBottom:8}}>
                <Icon name="search" size={13} style={{position:'absolute', left:9, color:'var(--faint)', pointerEvents:'none'}}/>
                <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search clients, projects, studies…"
                  style={{
                    width:'100%', padding:'7px 30px 7px 28px', border:'1px solid var(--line-2)',
                    borderRadius:8, background:'var(--surface)', fontFamily:'var(--sans)',
                    fontSize:12.5, color:'var(--ink)', outline:'none', boxSizing:'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor='var(--green-300)'}
                  onBlur={e  => e.target.style.borderColor='var(--line-2)'}
                />
                {query && (
                  <button onClick={() => setQuery('')} style={{position:'absolute', right:7, border:'none', background:'none', cursor:'pointer', color:'var(--faint)', padding:2, display:'flex', alignItems:'center'}}>
                    <Icon name="x" size={12}/>
                  </button>
                )}
              </div>

              {/* Type filter */}
              <div style={{display:'flex', gap:4, flexWrap:'wrap', marginBottom:6}}>
                {TYPE_TABS.map(t => (
                  <button key={t.id} onClick={() => setTypeFilter(t.id)} style={{
                    fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:999,
                    border:'1px solid', cursor:'pointer', fontFamily:'var(--sans)',
                    background:  typeFilter===t.id ? 'var(--green-800)' : 'transparent',
                    color:       typeFilter===t.id ? '#fff'             : 'var(--muted)',
                    borderColor: typeFilter===t.id ? 'var(--green-800)' : 'var(--line-2)',
                  }}>{t.label}</button>
                ))}
              </div>

              {/* Status filter + clear */}
              <div style={{display:'flex', alignItems:'center', gap:4}}>
                {[['all','All'],['active','Active'],['paused','Paused']].map(([v,l]) => (
                  <button key={v} onClick={() => setStatusFilter(v)} style={{
                    fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:999,
                    border:'1px solid', cursor:'pointer', fontFamily:'var(--sans)',
                    background:  statusFilter===v ? 'var(--surface-sunk)' : 'transparent',
                    color:       statusFilter===v ? 'var(--ink-2)'        : 'var(--muted)',
                    borderColor: statusFilter===v ? 'var(--line-strong)'  : 'var(--line-2)',
                  }}>{l}</button>
                ))}
                {isFiltered && (
                  <button onClick={clearFilters} style={{
                    marginLeft:'auto', fontSize:11, fontWeight:600, color:'var(--green-600)',
                    padding:'3px 7px', border:'none', background:'none', cursor:'pointer', fontFamily:'var(--sans)',
                  }}>Clear</button>
                )}
              </div>
            </div>

            {/* Tree or search results */}
            {isFiltered
              ? <SearchResults query={query} typeFilter={typeFilter} statusFilter={statusFilter} onSelect={handleSearchSelect}/>
              : <HierarchyTree sel={sel} onSelect={handleSelect} expanded={expanded} setExpanded={setExpanded}/>
            }

            <div style={{padding:'10px 12px',borderTop:'1px solid var(--line)',fontSize:12,color:'var(--faint)'}}>
              {DATA.clients.length} clients · {DATA.projects.length} projects · {DATA.studies.length} studies · {DATA.locations.length} sites
            </div>
          </div>

          {/* ── Detail panel ── */}
          <div style={{flex:1, overflowY:'auto'}}>
            <div style={{maxWidth:900, margin:'0 auto', padding:'24px 26px 80px'}}>
              <EntityDetail
                type={sel.type}
                id={sel.id}
                onSelect={handleDetailSelect}
                onAdd={(ct,pt,pi) => setAddModal({ childType:ct, parentType:pt, parentId:pi })}
                onRunSkill={onRunSkill}
              />
            </div>
          </div>
        </div>
      </div>
      {addModal && (
        <AddEntityModal
          childType={addModal.childType}
          parentType={addModal.parentType}
          parentId={addModal.parentId}
          onClose={() => setAddModal(null)}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   CLIENT PORTAL — expose project-level skills
   ═══════════════════════════════════════════════════════════ */

/* helper — small reusable skill card for client portal */
function ClientSkillCard({ a, onRun, badge }) {
  const s = a.skill;
  return (
    <div className="skill-card" onClick={() => onRun && onRun(s)}>
      <div className="row" style={{justifyContent:'space-between'}}>
        <div style={{width:40,height:40,borderRadius:10,background:'var(--green-50)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--green-700)'}}>
          <Icon name={TYPE_META[s.type].icon} size={18}/>
        </div>
        <div className="row gap8">
          {badge && <span className="tag" style={{background:'#e8edf6',color:'#3d5a8a',borderColor:'#c5d0e8'}}>{badge}</span>}
          <span className="tag">{TYPE_META[s.type].label}</span>
          <Icon name="arrowR" size={17} style={{color:'var(--faint)'}}/>
        </div>
      </div>
      <div>
        <div style={{fontWeight:700,fontSize:15.5,fontFamily:'var(--serif)',marginBottom:5}}>{s.name}</div>
        <p className="muted" style={{fontSize:13.5,margin:0,lineHeight:1.5}}>{s.clientDesc||s.desc}</p>
      </div>
      <div className="row gap6" style={{marginTop:'auto',paddingTop:6,flexWrap:'wrap'}}>
        {(s.outputs.match(/(PDF|PPTX|DOCX|XLSX)/g)||[]).map(f=><span key={f} className="tag">{f}</span>)}
      </div>
    </div>
  );
}

/* ── ClientRun — handles null study (project-level context) ── */
function ClientRun({ skill, study, project, client, onBack }) {
  const [phase,    setPhase]    = React.useState('upload');
  const [file,     setFile]     = React.useState(null);
  const [progress, setProgress] = React.useState(0);
  const timer = React.useRef(null);
  const outFiles = (skill.outputs.match(/(PDF|PPTX|DOCX|XLSX)/g)||['PDF']);

  const run = () => {
    setPhase('running'); setProgress(0); let p=0;
    timer.current = setInterval(()=>{ p+=Math.random()*14+5; if(p>=100){p=100; clearInterval(timer.current); setTimeout(()=>setPhase('done'),400);} setProgress(Math.min(100,p)); },260);
  };
  React.useEffect(()=>()=>clearInterval(timer.current),[]);

  /* project-level run has no study context */
  const contextPath = study
    ? DATA.displayPath('study',   study.id)
    : DATA.displayPath('project', project.id);
  const backLabel = study ? study.name : project.name;

  return (
    <div className="client-wrap fade-in" style={{maxWidth:800}}>
      <button className="btn btn-quiet btn-sm" onClick={onBack} style={{marginBottom:18, marginLeft:-8}}>
        <Icon name="arrowR" size={15} style={{transform:'rotate(180deg)'}}/> {backLabel}
      </button>
      <div className="row gap8" style={{marginBottom:18,padding:'8px 14px',background:'var(--surface)',border:'1px solid var(--line)',borderRadius:9,fontSize:12}}>
        <Icon name="layers" size={13} style={{color:'var(--muted)'}}/>
        <span className="mono" style={{color:'var(--muted)'}}>{contextPath}</span>
      </div>
      <div className="row gap16" style={{marginBottom:22}}>
        <div style={{width:52,height:52,borderRadius:13,background:'var(--green-50)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--green-700)',flex:'none'}}>
          <Icon name={TYPE_META[skill.type].icon} size={24}/>
        </div>
        <div>
          <h1 style={{fontSize:24}}>{skill.name}</h1>
          <p className="muted" style={{margin:'5px 0 0',fontSize:14,maxWidth:520}}>{skill.clientDesc||skill.desc}</p>
        </div>
      </div>

      {phase==='upload' && (
        <div className="card card-pad fade-in">
          <div style={{fontSize:12,fontWeight:700,letterSpacing:'.04em',color:'var(--faint)',marginBottom:8,textTransform:'uppercase'}}>Step 1 · Upload your input</div>
          <div className="muted" style={{fontSize:13.5,marginBottom:14}}>Accepted: {skill.inputs}</div>
          <div className="fileph" style={{height:140,flexDirection:'column',gap:10,cursor:'pointer',background:file?'var(--green-50)':undefined,borderColor:file?'var(--green-300)':undefined}}
            onClick={()=>setFile(f=>f?null:{name:(study?.code||project.code)+'_input.xlsx', size:'3.1 MB'})}>
            {file
              ? <><Icon name="file" size={26} style={{color:'var(--green-600)'}}/><span style={{fontFamily:'var(--sans)',fontWeight:600,color:'var(--green-700)',fontSize:14}}>{file.name}</span><span style={{fontSize:12}}>{file.size} · click to remove</span></>
              : <><Icon name="upload" size={26}/><span style={{fontFamily:'var(--sans)',fontSize:14,color:'var(--muted)'}}>Drag a file here, or click to browse</span><span style={{fontSize:11}}>Up to 100 MB</span></>}
          </div>
          <button className="btn btn-primary btn-lg" disabled={!file} onClick={run}
            style={{marginTop:18,width:'100%',justifyContent:'center',opacity:file?1:.5,cursor:file?'pointer':'not-allowed'}}>
            <Icon name="play" size={16}/> Run skill
          </button>
        </div>
      )}

      {phase==='running' && (
        <div className="card card-pad fade-in" style={{textAlign:'center',padding:'48px 30px'}}>
          <div style={{width:62,height:62,borderRadius:15,background:'var(--green-50)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 18px',color:'var(--green-600)'}}>
            <Icon name="settings" size={28} className="spin"/>
          </div>
          <h2 style={{fontSize:20,marginBottom:8}}>Running {skill.name}…</h2>
          <p className="muted" style={{fontSize:14,marginBottom:22}}>Processing your document securely. Usually under a minute.</p>
          <div className="barwrap" style={{maxWidth:420,margin:'0 auto',height:9}}><div className="bar" style={{width:progress+'%'}}></div></div>
          <div className="mono faint" style={{fontSize:12,marginTop:10}}>{Math.round(progress)}%</div>
        </div>
      )}

      {phase==='done' && (
        <div className="fade-in">
          <div className="card card-pad" style={{background:'linear-gradient(160deg,var(--green-50),var(--surface) 55%)',borderColor:'var(--green-100)',marginBottom:18}}>
            <div className="row gap12">
              <div style={{width:46,height:46,borderRadius:'50%',background:'var(--green-600)',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}><Icon name="check" size={22} style={{color:'#fff'}}/></div>
              <div>
                <h2 style={{fontSize:20}}>Your deliverable is ready</h2>
                <div className="muted" style={{fontSize:13.5,marginTop:2}}>Generated · {study ? study.name : project.name} · {new Date().toISOString().slice(0,10)}</div>
              </div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:18}}>
            {outFiles.map(f=>(
              <div key={f} className="card card-pad row gap14" style={{alignItems:'center'}}>
                <div className="fileph" style={{width:42,height:54,flex:'none',background:'var(--surface-2)'}}><span style={{fontSize:9}}>{f}</span></div>
                <div className="grow"><div style={{fontWeight:600,fontSize:14}}>{(study?.code||project.code)}_{skill.id.split('-')[0]}</div><div className="mono faint" style={{fontSize:11.5}}>.{f.toLowerCase()} · ready</div></div>
                <button className="btn btn-primary btn-sm"><Icon name="download" size={14}/></button>
              </div>
            ))}
          </div>
          <div className="row gap10">
            <button className="btn btn-ghost" onClick={()=>{setPhase('upload');setFile(null);}}><Icon name="play" size={14}/> Run again</button>
            <button className="btn btn-quiet" onClick={onBack}>Back to {study ? 'study' : 'project'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ClientDashboard — adds project-level skills section ── */
function ClientDashboard({ project, client: cli, studies, onStudy, onNav, onRun }) {
  const allDeliverables = DATA.deliverables.filter(d=>d.projectId===project.id);
  const projSkills      = DATA.skillsAt('project', project.id)
    .filter(a => a.skill?.state==='client-ready' && a.skill?.visibility!=='internal-only');
  const studySkillCount = studies.reduce((n,s)=>n+DATA.skillsAt('study',s.id).length, 0);
  const allSkillCount   = studySkillCount + projSkills.length;
  const activeStudies   = studies.filter(s=>s.status==='active');

  return (
    <div className="client-wrap fade-in">
      <div className="hero-banner" style={{marginBottom:28}}>
        <div style={{position:'absolute',right:-60,top:-60,width:240,height:240,borderRadius:'50%',background:'rgba(255,255,255,.05)'}}></div>
        <div style={{fontSize:12,fontWeight:700,letterSpacing:'.1em',opacity:.65,marginBottom:8}}>{cli.name.toUpperCase()} · {project.code}</div>
        <h1 style={{fontSize:28,color:'#fff',marginBottom:8}}>{project.name}</h1>
        <p style={{maxWidth:540,fontSize:14.5,opacity:.85,margin:'0 0 18px',lineHeight:1.5}}>{project.desc}</p>
        <div className="row gap12">
          <div style={{background:'rgba(255,255,255,.12)',borderRadius:10,padding:'10px 16px',textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:700,color:'#fff'}}>{activeStudies.length}</div>
            <div style={{fontSize:11,opacity:.75,marginTop:2}}>Active studies</div>
          </div>
          <div style={{background:'rgba(255,255,255,.12)',borderRadius:10,padding:'10px 16px',textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:700,color:'#fff'}}>{allSkillCount}</div>
            <div style={{fontSize:11,opacity:.75,marginTop:2}}>Available skills</div>
          </div>
          <div style={{background:'rgba(255,255,255,.12)',borderRadius:10,padding:'10px 16px',textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:700,color:'#fff'}}>{allDeliverables.length}</div>
            <div style={{fontSize:11,opacity:.75,marginTop:2}}>Deliverables</div>
          </div>
        </div>
      </div>

      {/* project-level skills — shown before studies if they exist */}
      {projSkills.length > 0 && (
        <div style={{marginBottom:32}}>
          <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
            <h2 style={{fontSize:19}}>Project-wide skills</h2>
            <span className="chip"><Icon name="layers" size={13}/> Available across all studies</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12}}>
            {projSkills.map(a => (
              <ClientSkillCard key={a.skillId} a={a} onRun={skill => onRun && onRun(skill)} badge="Project-wide"/>
            ))}
          </div>
        </div>
      )}

      <div style={{display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:22, alignItems:'start'}}>
        <div>
          <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
            <h2 style={{fontSize:19}}>Your studies</h2>
            <button className="btn btn-quiet btn-sm" onClick={()=>onNav('studies')}>View all <Icon name="chevron" size={13}/></button>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {studies.map(s=><StudyCard key={s.id} study={s} onOpen={onStudy}/>)}
          </div>
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:16}}>
          <div className="card card-pad">
            <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
              <h3 style={{fontSize:15}}>Recent deliverables</h3>
              <button className="btn btn-quiet btn-sm" onClick={()=>onNav('deliverables')}>All <Icon name="chevron" size={13}/></button>
            </div>
            {allDeliverables.slice(0,4).map((d,i)=>{
              const study = DATA.studyById(d.studyId);
              return (
                <div key={d.id} className="row gap10" style={{padding:'9px 0', borderTop:i?'1px solid var(--line)':'none'}}>
                  <Icon name="doc2" size={16} style={{color:'var(--green-600)'}}/>
                  <div className="grow">
                    <div style={{fontSize:13.5,fontWeight:500}}>{d.name}</div>
                    <div className="muted" style={{fontSize:11.5}}>{study?.code} · {d.at.slice(5,10)}</div>
                  </div>
                  <div className="row gap4">{d.files.map(f=><span key={f} className="tag">{f}</span>)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── ClientStudy — adds project-wide skills alongside study skills ── */
function ClientStudy({ studyId, project, client, onRun, onBack }) {
  const study      = DATA.studyById(studyId);
  const skills     = DATA.skillsAt('study', studyId);
  const projSkills = DATA.skillsAt('project', project.id)
    .filter(a => a.skill?.state==='client-ready' && a.skill?.visibility!=='internal-only');
  const locs   = DATA.locations.filter(l=>l.study===studyId);
  const delivs = DATA.deliverables.filter(d=>d.studyId===studyId);

  if (!study) return null;
  return (
    <div className="client-wrap fade-in">
      <button className="btn btn-quiet btn-sm" onClick={onBack} style={{marginBottom:18, marginLeft:-8}}>
        <Icon name="arrowR" size={15} style={{transform:'rotate(180deg)'}}/> All studies
      </button>
      <div className="card card-pad" style={{marginBottom:22,background:'linear-gradient(160deg,var(--green-50),var(--surface) 55%)',borderColor:'var(--green-100)'}}>
        <div className="row gap10" style={{marginBottom:8}}>
          <span className="tag">{study.phase}</span>
          <span style={{fontSize:11.5,fontWeight:700,background:study.status==='active'?'var(--st-client-bg)':'var(--st-internal-bg)',color:study.status==='active'?'var(--st-client-tx)':'var(--st-internal-tx)',padding:'2px 8px',borderRadius:999}}>{study.status}</span>
        </div>
        <h1 style={{fontSize:26,marginBottom:6}}>{study.name}</h1>
        <p className="muted" style={{margin:'0 0 14px',fontSize:14.5,lineHeight:1.5}}>{study.desc}</p>
        <div className="row gap20" style={{flexWrap:'wrap',fontSize:13,color:'var(--muted)'}}>
          <span className="row gap6"><Icon name="users" size={14}/>{study.sponsor}</span>
          <span className="row gap6"><Icon name="pin" size={14}/>{locs.length} site{locs.length!==1?'s':''}</span>
          <span className="row gap6"><Icon name="layers" size={14}/>{project.name}</span>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:22, alignItems:'start'}}>
        <div>
          <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
            <h2 style={{fontSize:19}}>Skills</h2>
            <span className="chip"><Icon name="shield" size={13}/> Outputs only</span>
          </div>

          {/* project-wide skills */}
          {projSkills.length > 0 && (
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--muted)',marginBottom:8,display:'flex',alignItems:'center',gap:7}}>
                <Icon name="layers" size={12}/> Available across all studies
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {projSkills.map(a=>(
                  <ClientSkillCard key={a.skillId} a={a} onRun={skill=>onRun(skill, null)} badge="Project-wide"/>
                ))}
              </div>
              {skills.length > 0 && (
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--muted)',margin:'18px 0 8px',display:'flex',alignItems:'center',gap:7}}>
                  <Icon name="flask" size={12}/> Study-specific
                </div>
              )}
            </div>
          )}

          {/* study-level skills */}
          {skills.length > 0 ? (
            <div style={{display:'flex', flexDirection:'column', gap:12}}>
              {skills.map(a=>(
                <ClientSkillCard key={a.skillId} a={a} onRun={skill=>onRun(skill, study)}/>
              ))}
            </div>
          ) : projSkills.length === 0 ? (
            <div className="card card-pad muted" style={{fontSize:14}}>No skills have been granted for this study yet.</div>
          ) : null}
        </div>

        <div style={{display:'flex', flexDirection:'column', gap:16}}>
          <div className="card card-pad">
            <h3 style={{fontSize:15, marginBottom:12}}>Sites <span className="faint mono" style={{fontSize:12}}>· {locs.length}</span></h3>
            {locs.map((l,i)=>(
              <div key={l.id} className="row gap10" style={{padding:'9px 0', borderTop:i?'1px solid var(--line)':'none'}}>
                <span style={{width:28,height:28,borderRadius:7,background:'var(--st-client-bg)',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>
                  <Icon name="pin" size={13} style={{color:'var(--st-client-tx)'}}/>
                </span>
                <div className="grow">
                  <div style={{fontWeight:600,fontSize:13.5}}>{l.name}</div>
                  <div className="muted" style={{fontSize:12}}>{l.city} · {l.pi}</div>
                </div>
                <span style={{fontSize:11,fontWeight:700,background:l.status==='active'?'var(--st-client-bg)':'var(--surface-sunk)',color:l.status==='active'?'var(--st-client-tx)':'var(--muted)',padding:'2px 8px',borderRadius:999}}>{l.status}</span>
              </div>
            ))}
          </div>
          {delivs.length > 0 && (
            <div className="card card-pad">
              <h3 style={{fontSize:15, marginBottom:12}}>Study deliverables <span className="faint mono" style={{fontSize:12}}>· {delivs.length}</span></h3>
              {delivs.map((d,i)=>(
                <div key={d.id} className="row gap10" style={{padding:'9px 0', borderTop:i?'1px solid var(--line)':'none'}}>
                  <Icon name="doc2" size={16} style={{color:'var(--green-600)'}}/>
                  <div className="grow"><div style={{fontSize:13.5,fontWeight:500}}>{d.name}</div><div className="muted" style={{fontSize:11.5}}>{d.at.slice(5,10)}</div></div>
                  <button className="btn btn-ghost btn-sm"><Icon name="download" size={13}/></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── ClientApp — wires onRun through to Dashboard ─────── */
function ClientApp() {
  const client    = DATA.people.susan;
  const clientRec = DATA.clientById('cli-bilh');
  const project   = DATA.projectById('prj-bilh-onc');
  const studies   = DATA.studies.filter(s=>s.project==='prj-bilh-onc');

  const [view,     setView]     = useState('dashboard');
  const [studyId,  setStudyId]  = useState(null);
  const [runSkill, setRunSkill] = useState(null); // { skill, study } — study may be null

  const navTo = v => { setView(v); setStudyId(null); setRunSkill(null); };

  return (
    <div className="client-scope" style={{display:'flex',flexDirection:'column',flex:1,minHeight:0,background:'var(--paper)'}}>
      <div className="client-top">
        <div className="brand">
          <VLogo size={24}/>
          <span>Velara</span>
          <span style={{fontFamily:'var(--sans)',fontSize:11,fontWeight:700,letterSpacing:'.08em',color:'var(--muted)',background:'var(--surface-sunk)',padding:'3px 8px',borderRadius:6}}>BY VITALIEF</span>
        </div>
        <div className="client-nav">
          {[['dashboard','Dashboard'],['studies','Studies'],['deliverables','Deliverables']].map(([id,l])=>(
            <div key={id} className={'ci'+(view===id&&!studyId&&!runSkill?' on':'')} onClick={()=>navTo(id)}>{l}</div>
          ))}
        </div>
        <div className="grow"></div>
        <div className="row gap6" style={{fontSize:12,color:'var(--muted)',marginRight:16}}>
          <Icon name="layers" size={13}/>
          <span>{clientRec.name}</span>
          <Icon name="chevron" size={12}/>
          <span style={{fontWeight:600,color:'var(--ink-2)'}}>{project.name}</span>
        </div>
        <div className="row gap10">
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:13,fontWeight:600}}>{client.name}</div>
            <div className="muted" style={{fontSize:11.5}}>{client.role}</div>
          </div>
          <Avatar p={client} size={34}/>
        </div>
      </div>

      <div style={{flex:1,overflowY:'auto'}}>
        {runSkill
          ? <ClientRun skill={runSkill.skill} study={runSkill.study} project={project} client={clientRec}
              onBack={()=>setRunSkill(null)}/>
          : studyId
          ? <ClientStudy studyId={studyId} project={project} client={clientRec}
              onRun={(skill,study)=>setRunSkill({skill,study})}
              onBack={()=>setStudyId(null)}/>
          : view==='dashboard'
          ? <ClientDashboard project={project} client={clientRec} studies={studies}
              onStudy={setStudyId} onNav={navTo}
              onRun={skill=>setRunSkill({skill, study:null})}/>
          : view==='studies'
          ? <ClientStudiesList studies={studies} project={project} onStudy={setStudyId}/>
          : <ClientDeliverables studies={studies}/>}
      </div>
    </div>
  );
}

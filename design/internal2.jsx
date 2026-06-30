/* Internal app part 2 — CertPanel, Certification, Validation, Analytics, Audit, Run Console */

/* CertPanel — used in skill overview + cert view */
function CertPanel({ s, expanded }) {
  const keys = [
    { which:'tech', cert:s.tech, who:DATA.people.priya, title:'Technical key', sub:'MA Technologies', icon:'code' },
    { which:'method', cert:s.method, who:DATA.people.matt, title:'Methodology key', sub:'Matt Maxwell', icon:'sparkle' },
  ];
  return (
    <div className="card card-pad">
      <div className="row" style={{justifyContent:'space-between', marginBottom:14}}>
        <h3 style={{fontSize:15}}>Two-key certification</h3>
        <span className="mono faint" style={{fontSize:11.5}}>v{s.version}</span>
      </div>
      <div className={expanded?'keylock':''} style={expanded?{}:{display:'flex', flexDirection:'column', gap:14}}>
        {keys.map(k=>{
          const done = k.cert.criteria.filter(c=>c.done).length;
          const total = k.cert.criteria.length;
          const certified = k.cert.status==='certified';
          return (
            <div className={'keycard '+k.which} key={k.which}>
              <div className="kh">
                <div className="kicon"><Icon name={k.icon} size={18}/></div>
                <div className="grow">
                  <div style={{fontWeight:700, fontSize:13.5}}>{k.title}</div>
                  <div className="muted" style={{fontSize:12}}>{k.sub}</div>
                </div>
                {certified
                  ? <span className="badge badge-state-client"><Icon name="lock" size={11}/> Turned</span>
                  : k.cert.status==='in-review' ? <span className="badge badge-state-internal">In review</span>
                  : <span className="badge badge-state-draft">Not started</span>}
              </div>
              {expanded && k.cert.criteria.map((c,i)=>(
                <div key={i} className={'crit '+(c.done?'done':'pend')}>
                  <span className="cb">{c.done && <Icon name="check" size={12}/>}</span>
                  <span>{c.label}</span>
                </div>
              ))}
              <div className="row" style={{justifyContent:'space-between', marginTop:expanded?12:2, fontSize:12}}>
                <span className="muted">{done}/{total} criteria</span>
                {k.cert.by && <span className="muted">{certified?'Signed':'Reviewing'} · {k.cert.date||'—'}</span>}
              </div>
              {expanded && (
                certified
                  ? <div className="row gap8" style={{marginTop:10, fontSize:12.5, color:'var(--green-700)', fontWeight:600}}><Avatar p={k.who} size={20}/> Signed by {k.who.short}</div>
                  : <button className="btn btn-primary btn-sm" style={{marginTop:10, width:'100%', justifyContent:'center'}}><Icon name="lock" size={13}/> Turn {k.which==='tech'?'technical':'methodology'} key</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Certification view ---------------- */
function Certification({ onOpen }) {
  const pending = DATA.skills.filter(s=>s.tech.status!=='certified' || s.method.status!=='certified').filter(s=>s.state!=='retired');
  const recent = DATA.skills.filter(s=>s.tech.status==='certified'&&s.method.status==='certified'&&s.state==='client-ready').slice(0,4);
  const [sel, setSel] = useState(pending[0]?.id);
  const s = DATA.skillById(sel) || pending[0];

  return (
    <>
      <TopBar title="Certification" actions={<span className="chip"><Icon name="cert" size={14}/> Two-key model · technical + methodology</span>}/>
      <div className="content">
        <div className="wrap-wide fade-in" style={{display:'grid', gridTemplateColumns:'320px 1fr', gap:24, alignItems:'start'}}>
          {/* list */}
          <div>
            <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--faint)', margin:'2px 0 10px'}}>Awaiting keys · {pending.length}</div>
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {pending.map(p=>(
                <div key={p.id} onClick={()=>setSel(p.id)} className="card" style={{padding:'13px 14px', cursor:'pointer',
                  borderColor: sel===p.id?'var(--green-300)':'var(--line)', boxShadow: sel===p.id?'0 0 0 1px var(--green-300)':'var(--sh-sm)'}}>
                  <div style={{fontWeight:600, fontSize:13.5, marginBottom:8}}>{p.name}</div>
                  <div className="row" style={{justifyContent:'space-between'}}>
                    <CertLocks skill={p} compact/>
                    <span className="ver">{p.version}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--faint)', margin:'20px 0 10px'}}>Recently certified</div>
            {recent.map(r=>(
              <div key={r.id} className="row gap8" style={{padding:'8px 4px', fontSize:13, cursor:'pointer'}} onClick={()=>onOpen(r.id)}>
                <Icon name="check" size={14} style={{color:'var(--green-600)'}}/>
                <span className="grow">{r.name}</span><span className="ver">{r.version}</span>
              </div>
            ))}
          </div>

          {/* detail */}
          {s && (
            <div>
              <div className="card card-pad" style={{marginBottom:18}}>
                <div className="row" style={{justifyContent:'space-between', alignItems:'flex-start'}}>
                  <div>
                    <div className="row gap8" style={{marginBottom:6}}><StateBadge state={s.state}/><VisChip visibility={s.visibility}/></div>
                    <h2 style={{fontSize:21}}>{s.name}</h2>
                    <div className="mono faint" style={{fontSize:12, marginTop:4}}>{s.id} · v{s.version} · submitted {s.submitted||s.modified} by {DATA.people[s.submittedBy||s.owner].short}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>onOpen(s.id)}>Open skill <Icon name="chevron" size={13}/></button>
                </div>
                <div style={{marginTop:14, padding:'12px 16px', borderRadius:10, display:'flex', alignItems:'center', gap:12,
                  background: (s.tech.status==='certified'&&s.method.status==='certified')?'var(--green-50)':'var(--surface-sunk)'}}>
                  <Icon name={(s.tech.status==='certified'&&s.method.status==='certified')?'lock':'unlock'} size={18} style={{color:'var(--green-600)'}}/>
                  <div style={{fontSize:13.5, fontWeight:600, color:'var(--ink-2)'}}>
                    {s.tech.status==='certified'&&s.method.status==='certified'
                      ? 'Both keys turned — this version can be promoted to client-ready.'
                      : 'A skill is not client-ready until both keys turn. '+
                        ([s.tech.status!=='certified'&&'technical', s.method.status!=='certified'&&'methodology'].filter(Boolean).join(' and ')+' key'+((s.tech.status!=='certified')&&(s.method.status!=='certified')?'s':'')+' outstanding.')}
                  </div>
                </div>
              </div>
              <CertPanel s={s} expanded/>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------------- Validation Queue ---------------- */
function ValidationQueue({ onOpen }) {
  const queue = DATA.skills.filter(s=>s.inQueue);
  return (
    <>
      <TopBar title="Validation Queue" actions={<span className="chip"><Icon name="inbox" size={14}/> {queue.length} awaiting MA Technologies</span>}/>
      <div className="content">
        <div className="wrap fade-in">
          <p className="muted" style={{maxWidth:680, marginTop:0, fontSize:14}}>Authored skills are submitted here for technical validation by MA Technologies — static review, execution against representative and adversarial inputs, schema and security verification — before either certification key can turn.</p>
          <div style={{display:'flex', flexDirection:'column', gap:14, marginTop:18}}>
            {queue.map(s=>{
              const techDone = s.tech.criteria.filter(c=>c.done).length;
              return (
                <div key={s.id} className="card card-pad" style={{cursor:'pointer'}} onClick={()=>onOpen(s.id)}>
                  <div className="row gap16">
                    <div className="grow">
                      <div className="row gap10" style={{marginBottom:6}}>
                        <span style={{fontWeight:700, fontSize:15.5}}>{s.name}</span>
                        <span className="ver">{s.version}</span>
                        <TypeChip type={s.type} mini/>
                      </div>
                      <div className="muted" style={{fontSize:13, maxWidth:560}}>{s.desc}</div>
                      <div className="row gap16" style={{marginTop:10, fontSize:12, color:'var(--muted)'}}>
                        <span className="row gap6"><Icon name="upload" size={13}/> Submitted {s.submitted} by {DATA.people[s.submittedBy].short}</span>
                        <span className="row gap6"><Icon name="clock" size={13}/> {s.runs} test runs</span>
                      </div>
                    </div>
                    <div style={{width:230, flex:'none'}}>
                      <div style={{fontSize:11.5, fontWeight:700, color:'var(--faint)', marginBottom:8, letterSpacing:'.04em'}}>VALIDATION PROGRESS</div>
                      <div style={{marginBottom:8}}>
                        <div className="row" style={{justifyContent:'space-between', fontSize:12, marginBottom:4}}><span className="muted">Technical review</span><span className="mono">{techDone}/{s.tech.criteria.length}</span></div>
                        <div className="barwrap"><div className="bar" style={{width:(techDone/s.tech.criteria.length*100)+'%', background:'var(--key-tech)'}}></div></div>
                      </div>
                      <CertLocks skill={s} compact/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Analytics ---------------- */
function Analytics() {
  const [tab,     setTab]     = useState('overview');
  const [selUser, setSelUser] = useState('dana');

  /* ── Overview data ── */
  const total     = DATA.usageByProject.reduce((a, b) => a + b.invocations, 0);
  const maxBar    = Math.max(...DATA.usageSeries);
  const topSkills = [...DATA.skills].filter(s => !s.isClientVariant).sort((a, b) => b.runs - a.runs).slice(0, 6);
  const maxRuns   = topSkills[0].runs;

  /* ── Per-user mock stats ── */
  const USER_STATS = {
    matt:  {
      invocations:487, successRate:98.7, skillsUsed:6,  avgRuntime:'5.8s',  trend:'+9%',  hoursSaved:109,
      topSkills:[
        { name:'Protocol Feasibility Scorecard', runs:62  },
        { name:'Governance Memo Generator',      runs:41  },
        { name:'Informed Consent Readability',   runs:28  },
        { name:'Enrollment Forecast',            runs:17  },
        { name:'Style & Format Filter',          runs:8   },
      ],
      surfaces:[{ name:'Claude', n:89 }, { name:'Web', n:47 }, { name:'API', n:20 }],
      weekly:[6,9,10,14,11,16,14,18,12,17,14,15],
    },
    priya: {
      invocations:89,  successRate:100,  skillsUsed:3,  avgRuntime:'3.1s',  trend:'+4%',  hoursSaved:62,
      topSkills:[
        { name:'Protocol Deviation Analyzer', runs:41 },
        { name:'Site Activation Risk Report', runs:31 },
        { name:'Governance Memo Generator',   runs:17 },
      ],
      surfaces:[{ name:'Web', n:51 }, { name:'API', n:38 }],
      weekly:[4,5,6,8,7,9,8,11,7,9,8,7],
    },
    dana:  {
      invocations:487, successRate:96.3, skillsUsed:8,  avgRuntime:'14.2s', trend:'+22%', hoursSaved:341,
      topSkills:[
        { name:'CTMS Data Extractor',            runs:189 },
        { name:'Governance Memo Generator',      runs:142 },
        { name:'Protocol Feasibility Scorecard', runs:88  },
        { name:'Style & Format Filter',          runs:45  },
        { name:'Enrollment Forecast',            runs:23  },
      ],
      surfaces:[{ name:'Web', n:234 }, { name:'API', n:175 }, { name:'Claude', n:78 }],
      weekly:[28,34,39,46,41,52,48,55,44,58,51,61],
    },
    tomas: {
      invocations:289, successRate:93.8, skillsUsed:5,  avgRuntime:'8.7s',  trend:'+11%', hoursSaved:202,
      topSkills:[
        { name:'MVR Summarizer',              runs:118 },
        { name:'Style & Format Filter',       runs:87  },
        { name:'Site Activation Risk Report', runs:51  },
        { name:'Governance Memo Generator',   runs:33  },
      ],
      surfaces:[{ name:'Web', n:162 }, { name:'Claude', n:98 }, { name:'API', n:29 }],
      weekly:[18,21,24,29,22,31,27,34,25,36,28,34],
    },
    karen: {
      invocations:341, successRate:97.9, skillsUsed:7,  avgRuntime:'22.1s', trend:'+16%', hoursSaved:239,
      topSkills:[
        { name:'Enrollment Forecast',            runs:134 },
        { name:'Site Activation Risk Report',    runs:89  },
        { name:'Protocol Feasibility Scorecard', runs:72  },
        { name:'Reg. Readiness Checklist',       runs:31  },
        { name:'Governance Memo Generator',      runs:15  },
      ],
      surfaces:[{ name:'Web', n:218 }, { name:'Claude', n:79 }, { name:'API', n:44 }],
      weekly:[22,26,28,34,29,38,33,41,30,42,38,40],
    },
  };

  const INTERNAL_USERS = ['dana','karen','tomas','matt','priya'];
  const u  = DATA.people[selUser];
  const us = USER_STATS[selUser];

  /* Recent activity — merge invocations + audit for selected user */
  const kindIcon  = { invoke:'play', fail:'x', cert:'cert', access:'shield', version:'layers', submit:'upload', lineage:'flag' };
  const kindColor = { invoke:'var(--green-600)', fail:'var(--danger)', cert:'var(--key-method)', access:'var(--st-internal-tx)', version:'var(--green-500)', submit:'var(--key-tech)', lineage:'var(--st-internal-tx)' };

  const recentActivity = [
    ...DATA.invocations.filter(i => i.user === selUser).map(i => ({
      key:   i.id,   at: i.at,
      label: DATA.skills.find(s => s.id === i.skill || s.lineageChildId === i.skill)?.name || i.skill,
      detail:`${i.surface} · ${fmtMs(i.ms)} · ${i.outcome}`,
      icon:  i.outcome === 'failed' ? 'x' : 'play',
      color: i.outcome === 'failed' ? 'var(--danger)' : 'var(--green-600)',
    })),
    ...DATA.audit.filter(a => a.actor === selUser).map(a => ({
      key:   a.id, at: a.at,
      label: a.target, detail: a.meta,
      icon:  kindIcon[a.kind]  || 'dots',
      color: kindColor[a.kind] || 'var(--faint)',
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);

  const surfaceTotal  = us.surfaces.reduce((a, s) => a + s.n, 0);
  const maxSkillRuns  = us.topSkills[0]?.runs || 1;
  const maxWeekly     = Math.max(...us.weekly);

  /* ── Surface accent colours ── */
  const SURFACE_COLORS = { Web:'var(--green-600)', API:'var(--key-tech)', Claude:'var(--key-method)', 'Client Portal':'var(--st-internal-tx)' };

  return (
    <>
      <TopBar title="Usage & Value" actions={
        <div className="row gap8">
          <div className="roleswitch">
            <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>
              <Icon name="chart" size={13}/> Overview
            </button>
            <button className={tab === 'user' ? 'on' : ''} onClick={() => setTab('user')}>
              <Icon name="user" size={13}/> By User
            </button>
          </div>
          {tab === 'overview' && <>
            <span className="chip"><Icon name="clock" size={13}/> Last 12 weeks</span>
            <button className="btn btn-ghost btn-sm"><Icon name="download" size={14}/> Value report</button>
          </>}
        </div>
      }/>
      <div className="content">

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <div className="wrap-wide fade-in">
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:22 }}>
              <StatMini k="Total invocations" v={fmtNum(total)} sub="+18% vs prior period" icon="bolt" accent/>
              <StatMini k="Consultant hours saved" v={fmtNum(1530)} sub="modeled at 42 min / run" icon="clock"/>
              <StatMini k="Active projects" v={DATA.projects.filter(p => DATA.clientById(DATA.projects.find(x => x.id === p.id)?.client)?.active !== false).length} sub="across 3 clients" icon="layers"/>
              <StatMini k="Avg platform overhead" v="1.4s" sub="p95 · under 2s target" icon="bolt"/>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:22, marginBottom:22, alignItems:'start' }}>
              <div className="card card-pad">
                <div className="row" style={{ justifyContent:'space-between', marginBottom:16 }}>
                  <h3 style={{ fontSize:16 }}>Invocations over time</h3>
                  <span className="mono faint" style={{ fontSize:12 }}>weekly</span>
                </div>
                <div className="row" style={{ alignItems:'flex-end', gap:8, height:160 }}>
                  {DATA.usageSeries.map((v, i) => (
                    <div key={i} className="grow" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                      <div style={{ width:'100%', maxWidth:30, height:(v/maxBar*140), background: i===DATA.usageSeries.length-1 ? 'var(--green-700)' : 'var(--green-300)', borderRadius:'5px 5px 0 0', transition:'height .4s' }} title={v}></div>
                      <span style={{ fontSize:9.5, color:'var(--faint)', whiteSpace:'nowrap' }}>{DATA.weeks[i].split(' ')[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card card-pad">
                <h3 style={{ fontSize:16, marginBottom:16 }}>By project</h3>
                {DATA.usageByProject.map(p => {
                  const proj = DATA.projectById(p.projectId);
                  const cli  = proj && DATA.clientById(proj.client);
                  return (
                    <div key={p.projectId} style={{ marginBottom:14 }}>
                      <div className="row" style={{ justifyContent:'space-between', fontSize:12.5, marginBottom:3 }}>
                        <div>
                          <div style={{ fontWeight:600 }}>{proj?.code}</div>
                          <div className="faint mono" style={{ fontSize:10.5 }}>{cli?.name}</div>
                        </div>
                        <span className="mono faint">{fmtNum(p.invocations)}</span>
                      </div>
                      <div className="barwrap"><div className="bar" style={{ width:(p.invocations/total*100*1.6)+'%', background:p.color }}></div></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:22, alignItems:'start' }}>
              <div className="card card-pad">
                <h3 style={{ fontSize:16, marginBottom:16 }}>Most-used skills</h3>
                {topSkills.map((s, i) => (
                  <div key={s.id} className="row gap12" style={{ padding:'9px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                    <span className="mono faint" style={{ width:18, fontSize:12 }}>{i+1}</span>
                    <div className="grow">
                      <div style={{ fontWeight:600, fontSize:13.5 }}>{s.name}</div>
                      <div className="barwrap" style={{ marginTop:5, maxWidth:240 }}><div className="bar" style={{ width:(s.runs/maxRuns*100)+'%' }}></div></div>
                    </div>
                    <span className="mono" style={{ fontSize:12.5, color:'var(--ink-2)' }}>{fmtNum(s.runs)}</span>
                  </div>
                ))}
              </div>
              <div className="card card-pad" style={{ background:'linear-gradient(160deg,var(--green-50),var(--surface) 60%)', borderColor:'var(--green-100)' }}>
                <div className="row gap10" style={{ marginBottom:10 }}><Icon name="sparkle" size={18} style={{ color:'var(--green-600)' }}/><h3 style={{ fontSize:16 }}>Renewal value snapshot</h3></div>
                <p className="muted" style={{ fontSize:13.5, marginTop:0, lineHeight:1.55 }}>Usage data feeds a value-reporting view shared in renewal conversations.</p>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:8 }}>
                  <div><div className="serif" style={{ fontSize:26, color:'var(--green-700)' }}>$412K</div><div className="muted" style={{ fontSize:12 }}>est. delivery cost avoided</div></div>
                  <div><div className="serif" style={{ fontSize:26, color:'var(--green-700)' }}>6.2×</div><div className="muted" style={{ fontSize:12 }}>proposal velocity uplift</div></div>
                  <div><div className="serif" style={{ fontSize:26, color:'var(--green-700)' }}>2,165</div><div className="muted" style={{ fontSize:12 }}>governed invocations</div></div>
                  <div><div className="serif" style={{ fontSize:26, color:'var(--green-700)' }}>11</div><div className="muted" style={{ fontSize:12 }}>reusable IP assets live</div></div>
                </div>
                <button className="btn btn-primary" style={{ marginTop:16, width:'100%', justifyContent:'center' }}><Icon name="doc2" size={14}/> Generate BILH renewal report</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ BY USER ══ */}
        {tab === 'user' && (
          <div className="wrap-wide fade-in">

            {/* User selector */}
            <div className="row gap8" style={{ marginBottom:22, flexWrap:'wrap' }}>
              {INTERNAL_USERS.map(uid => {
                const p = DATA.people[uid];
                return (
                  <button key={uid} onClick={() => setSelUser(uid)} className="btn btn-sm row gap8" style={{
                    background: selUser===uid ? 'var(--green-800)' : 'var(--surface)',
                    color:      selUser===uid ? '#fff'             : 'var(--ink-2)',
                    border:     '1px solid ' + (selUser===uid ? 'var(--green-800)' : 'var(--line-2)'),
                    padding:'6px 12px',
                  }}>
                    <Avatar p={uid} size={20}/>
                    {p.short}
                  </button>
                );
              })}
            </div>

            {/* User header card */}
            <div className="card card-pad" style={{ display:'flex', alignItems:'center', gap:20, marginBottom:18 }}>
              <Avatar p={selUser} size={46}/>
              <div className="grow">
                <div style={{ fontWeight:700, fontSize:18, color:'var(--ink)' }}>{u.name}</div>
                <div className="muted" style={{ fontSize:13, marginTop:3 }}>{u.role}</div>
              </div>
              <div style={{ display:'flex', gap:28, textAlign:'right' }}>
                {[
                  [fmtNum(us.invocations), 'invocations'],
                  [us.successRate + '%',   'success rate'],
                  [fmtNum(us.hoursSaved) + 'h', 'hours modeled saved'],
                ].map(([val, label]) => (
                  <div key={label}>
                    <div style={{ fontSize:24, fontWeight:700, fontFamily:'var(--serif)', color:'var(--green-700)' }}>{val}</div>
                    <div className="muted" style={{ fontSize:11.5, marginTop:2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3-col metrics */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:18, marginBottom:18, alignItems:'start' }}>

              {/* Weekly activity */}
              <div className="card card-pad">
                <div className="row" style={{ justifyContent:'space-between', marginBottom:14 }}>
                  <h3 style={{ fontSize:15 }}>Weekly activity</h3>
                  <span style={{ fontSize:12, fontWeight:600, color:'var(--green-600)' }}>{us.trend} vs prior</span>
                </div>
                <div className="row" style={{ alignItems:'flex-end', gap:4, height:96 }}>
                  {us.weekly.map((v, i) => (
                    <div key={i} className="grow" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                      <div style={{
                        width:'100%', height:(v/maxWeekly*82),
                        background: i===us.weekly.length-1 ? 'var(--green-700)' : 'var(--green-300)',
                        borderRadius:'3px 3px 0 0', transition:'height .4s',
                      }}></div>
                      {i % 4 === 0 && <span style={{ fontSize:8, color:'var(--faint)' }}>{DATA.weeks[i]?.split(' ')[1]||''}</span>}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:10, fontSize:12, color:'var(--muted)' }}>~{Math.round(us.invocations/12)}/wk avg · {us.avgRuntime} runtime</div>
              </div>

              {/* Skills used */}
              <div className="card card-pad">
                <div className="row" style={{ justifyContent:'space-between', marginBottom:14 }}>
                  <h3 style={{ fontSize:15 }}>Skills used</h3>
                  <span className="chip">{us.skillsUsed} distinct</span>
                </div>
                {us.topSkills.map((s, i) => (
                  <div key={i} style={{ marginBottom:10 }}>
                    <div className="row" style={{ justifyContent:'space-between', fontSize:12.5, marginBottom:3 }}>
                      <span style={{ fontWeight:500, color:'var(--ink-2)' }}>{s.name}</span>
                      <span className="mono faint" style={{ fontSize:11.5 }}>{fmtNum(s.runs)}</span>
                    </div>
                    <div className="barwrap"><div className="bar" style={{ width:(s.runs/maxSkillRuns*100)+'%', background:'var(--green-600)' }}></div></div>
                  </div>
                ))}
              </div>

              {/* Surface breakdown */}
              <div className="card card-pad">
                <h3 style={{ fontSize:15, marginBottom:14 }}>By surface</h3>
                {us.surfaces.map((s, i) => {
                  const pct = Math.round(s.n / surfaceTotal * 100);
                  const color = SURFACE_COLORS[s.name] || 'var(--green-500)';
                  return (
                    <div key={i} style={{ marginBottom:16 }}>
                      <div className="row" style={{ justifyContent:'space-between', fontSize:12.5, marginBottom:4 }}>
                        <span style={{ fontWeight:600 }}>{s.name}</span>
                        <span className="mono" style={{ fontSize:12, color:'var(--ink-2)' }}>{pct}%</span>
                      </div>
                      <div style={{ height:8, borderRadius:4, background:'var(--surface-sunk)', overflow:'hidden' }}>
                        <div style={{ height:'100%', width:pct+'%', background:color, borderRadius:4, transition:'width .4s' }}></div>
                      </div>
                      <div style={{ fontSize:11, color:'var(--faint)', marginTop:3 }}>{fmtNum(s.n)} invocations</div>
                    </div>
                  );
                })}
                <div style={{ paddingTop:10, borderTop:'1px solid var(--line)', fontSize:12, color:'var(--muted)' }}>
                  {us.skillsUsed} skills · {us.avgRuntime} avg runtime
                </div>
              </div>
            </div>

            {/* Recent activity */}
            <div className="card card-pad">
              <div className="row" style={{ justifyContent:'space-between', marginBottom:14 }}>
                <h3 style={{ fontSize:15 }}>Recent activity</h3>
                <span className="chip"><Avatar p={selUser} size={16}/> {u.short}</span>
              </div>
              {recentActivity.length === 0 ? (
                <div className="muted" style={{ padding:'20px 0', fontSize:13.5 }}>No recent activity.</div>
              ) : recentActivity.map((item, i) => (
                <div key={item.key} style={{ padding:'11px 0', borderTop: i ? '1px solid var(--line)' : 'none', display:'flex', gap:14, alignItems:'flex-start' }}>
                  <div style={{ width:30, height:30, borderRadius:7, flex:'none', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--surface-sunk)', color:item.color }}>
                    <Icon name={item.icon} size={14}/>
                  </div>
                  <div className="grow">
                    <div style={{ fontSize:13.5, fontWeight:500 }}>{item.label}</div>
                    <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{item.detail}</div>
                  </div>
                  <div className="mono faint" style={{ fontSize:11, whiteSpace:'nowrap', paddingTop:3 }}>{item.at}</div>
                </div>
              ))}
            </div>

          </div>
        )}

      </div>
    </>
  );
}

/* ---------------- Audit Log ---------------- */
function AuditLog() {
  const kindMeta = {
    invoke:{icon:'play', c:'var(--green-600)'}, cert:{icon:'cert', c:'var(--key-method)'},
    fail:{icon:'x', c:'var(--danger)'}, submit:{icon:'upload', c:'var(--key-tech)'},
    access:{icon:'shield', c:'var(--st-internal-tx)'}, version:{icon:'layers', c:'var(--green-500)'},
    lineage:{icon:'flag', c:'var(--st-internal-tx)'},
  };

  const PRESETS = [
    { id:'today',  label:'Today' },
    { id:'last7',  label:'Last 7 days' },
    { id:'last30', label:'Last 30 days' },
    { id:'all',    label:'All time' },
  ];

  const [filter,     setFilter]     = useState('all');
  const [preset,     setPreset]     = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef(null);

  // Anchor relative to most recent entry so presets show real mock data
  const anchor = DATA.audit[0]?.at?.substring(0, 10) || '2026-05-28';

  function offsetDate(base, days) {
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() - days);
    return d.toISOString().substring(0, 10);
  }

  function getRange() {
    if (preset === 'custom') return { from: customFrom || null, to: customTo || null };
    if (preset === 'all')    return { from: null, to: null };
    if (preset === 'today')  return { from: anchor, to: anchor };
    if (preset === 'last7')  return { from: offsetDate(anchor, 6), to: anchor };
    if (preset === 'last30') return { from: offsetDate(anchor, 29), to: anchor };
    return { from: null, to: null };
  }

  const range = getRange();

  const list = DATA.audit.filter(a => {
    const kindOk = filter === 'all' || a.kind === filter;
    const date   = a.at.substring(0, 10);
    const dateOk = (!range.from || date >= range.from) && (!range.to || date <= range.to);
    return kindOk && dateOk;
  });

  function rangeLabel() {
    if (preset === 'all')    return 'All time';
    if (preset === 'custom') return (customFrom && customTo) ? `${customFrom} – ${customTo}` : 'Custom range';
    return PRESETS.find(p => p.id === preset)?.label || 'All time';
  }

  useEffect(() => {
    if (!showPicker) return;
    const h = e => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showPicker]);

  const anyActive = preset !== 'all' || filter !== 'all';

  return (
    <>
      <TopBar title="Audit Log" actions={<span className="chip"><Icon name="lock" size={13}/> Append-only · 7-year retention</span>}/>
      <div className="content">
        <div className="wrap fade-in">

          {/* ── Filter toolbar ── */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:16, flexWrap:'wrap' }}>

            {/* Kind pills */}
            <div className="row gap8" style={{ flexWrap:'wrap', flex:1 }}>
              {[['all','All events'],['invoke','Invocations'],['cert','Certifications'],['access','Access'],['version','Versions'],['lineage','Lineage'],['fail','Failures']].map(([v,l]) => (
                <button key={v} onClick={() => setFilter(v)} className="btn btn-sm" style={{
                  background: filter===v ? 'var(--green-800)' : 'var(--surface)',
                  color:      filter===v ? '#fff' : 'var(--ink-2)',
                  border:     '1px solid ' + (filter===v ? 'var(--green-800)' : 'var(--line-2)'),
                }}>{l}</button>
              ))}
            </div>

            {/* Date range button + dropdown */}
            <div style={{ position:'relative', flexShrink:0 }} ref={pickerRef}>
              <button onClick={() => setShowPicker(o => !o)} className="btn btn-sm row gap6" style={{
                background: preset !== 'all' ? 'var(--surface-sunk)' : 'var(--surface)',
                color:      preset !== 'all' ? 'var(--ink)'          : 'var(--ink-2)',
                border:     '1px solid ' + (preset !== 'all' ? 'var(--line-strong)' : 'var(--line-2)'),
              }}>
                <Icon name="clock" size={13}/>
                {rangeLabel()}
                <Icon name="chevdown" size={12} style={{ transition:'transform .15s', transform: showPicker ? 'rotate(180deg)' : 'none' }}/>
              </button>

              {showPicker && (
                <div style={{
                  position:'absolute', right:0, top:'calc(100% + 6px)', zIndex:200,
                  background:'var(--surface)', border:'1px solid var(--line-2)', borderRadius:'var(--r)',
                  boxShadow:'0 8px 28px -4px rgba(0,0,0,.18)', padding:14, width:222,
                }}>
                  <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.07em', color:'var(--faint)', marginBottom:6 }}>QUICK SELECT</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:1, marginBottom:2 }}>
                    {PRESETS.map(p => (
                      <button key={p.id} onClick={() => { setPreset(p.id); setShowPicker(false); }}
                        style={{
                          display:'flex', alignItems:'center', justifyContent:'space-between',
                          padding:'7px 9px', borderRadius:6, border:'none', cursor:'pointer',
                          background:  preset===p.id ? 'var(--surface-sunk)' : 'transparent',
                          color:       preset===p.id ? 'var(--ink)'          : 'var(--ink-2)',
                          fontFamily: 'var(--sans)', fontSize:13,
                          fontWeight: preset===p.id ? 600 : 400, textAlign:'left', width:'100%',
                        }}>
                        {p.label}
                        {preset===p.id && <Icon name="check" size={12} style={{ color:'var(--green-600)' }}/>}
                      </button>
                    ))}
                    {/* Custom option */}
                    <button onClick={() => setPreset('custom')}
                      style={{
                        display:'flex', alignItems:'center', justifyContent:'space-between',
                        padding:'7px 9px', borderRadius:6, border:'none', cursor:'pointer',
                        background:  preset==='custom' ? 'var(--surface-sunk)' : 'transparent',
                        color:       preset==='custom' ? 'var(--ink)'          : 'var(--ink-2)',
                        fontFamily: 'var(--sans)', fontSize:13,
                        fontWeight: preset==='custom' ? 600 : 400, textAlign:'left', width:'100%',
                      }}>
                      Custom range
                      {preset==='custom' && <Icon name="check" size={12} style={{ color:'var(--green-600)' }}/>}
                    </button>
                  </div>

                  {/* Custom date inputs */}
                  {preset === 'custom' && (
                    <>
                      <div style={{ height:1, background:'var(--line)', margin:'10px 0' }}/>
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        <label style={{ display:'flex', flexDirection:'column', gap:3 }}>
                          <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.07em', color:'var(--faint)' }}>FROM</span>
                          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{
                            fontFamily:'var(--mono)', fontSize:12.5, padding:'6px 8px',
                            border:'1px solid var(--line-2)', borderRadius:6,
                            background:'var(--surface-sunk)', color:'var(--ink)',
                            outline:'none', width:'100%', boxSizing:'border-box',
                          }}/>
                        </label>
                        <label style={{ display:'flex', flexDirection:'column', gap:3 }}>
                          <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.07em', color:'var(--faint)' }}>TO</span>
                          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{
                            fontFamily:'var(--mono)', fontSize:12.5, padding:'6px 8px',
                            border:'1px solid var(--line-2)', borderRadius:6,
                            background:'var(--surface-sunk)', color:'var(--ink)',
                            outline:'none', width:'100%', boxSizing:'border-box',
                          }}/>
                        </label>
                        <button className="btn btn-primary btn-sm" onClick={() => setShowPicker(false)} style={{ marginTop:2 }}>
                          Apply
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Result count pill */}
          {anyActive && (
            <div style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>
              {list.length} event{list.length !== 1 ? 's' : ''}
              {preset !== 'all' && <> · {rangeLabel()}</>}
              {filter !== 'all' && <> · {filter}</>}
            </div>
          )}

          <div className="card" style={{ overflow:'hidden' }}>
            {list.length === 0 ? (
              <div style={{ padding:'52px 24px', textAlign:'center', color:'var(--faint)', fontSize:13.5 }}>
                No events in this range.
              </div>
            ) : list.map((a, i) => {
              const m = kindMeta[a.kind] || kindMeta.invoke;
              return (
                <div key={a.id} style={{ padding:'14px 18px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <div className="row gap14">
                    <div style={{ width:34, height:34, borderRadius:8, flex:'none', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--surface-sunk)', color:m.c }}>
                      <Icon name={m.icon} size={16}/>
                    </div>
                    <div className="grow">
                      <div style={{ fontSize:13.5 }}><b style={{ color:'var(--ink)' }}>{a.target}</b></div>
                      <div className="row gap8" style={{ marginTop:3, fontSize:12, color:'var(--muted)' }}>
                        <span className="mono" style={{ color:'var(--ink-2)' }}>{a.action}</span>
                        <span>·</span><span>{a.meta}</span>
                      </div>
                      {a.path && (
                        <div className="row gap6" style={{ marginTop:5 }}>
                          <Icon name="layers" size={11} style={{ color:'var(--faint)' }}/>
                          <span className="mono" style={{ fontSize:10.5, color:'var(--faint)' }}>{a.path}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div className="row gap6" style={{ justifyContent:'flex-end', fontSize:12, fontWeight:600 }}>
                        <Avatar p={a.actor} size={20}/> {DATA.people[a.actor].short}
                      </div>
                      <div className="mono faint" style={{ fontSize:11, marginTop:3 }}>{a.at}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </>
  );
}

Object.assign(window, { CertPanel, Certification, ValidationQueue, Analytics, AuditLog });

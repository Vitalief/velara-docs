/* Internal app — shell, registry, skill detail */
const { useState, useMemo, useEffect, useRef } = React;

/* ---------------- Internal Shell ---------------- */
function InternalShell({ view, setView, children, onSearch }) {
  const D = DATA;
  const queueCount = D.skills.filter(s=>s.inQueue).length;
  const draftCount = D.skills.filter(s=>s.state==='draft').length;
  const nav = [
    { grp:'Library', items:[
      { id:'registry', icon:'registry', label:'Skill Registry', count: D.skills.filter(s=>s.state!=='retired').length },
      { id:'run', icon:'play', label:'Run Console' },
    ]},
    { grp:'Governance', items:[
      { id:'validation', icon:'inbox', label:'Validation Queue', alert: queueCount },
      { id:'cert', icon:'cert', label:'Certification' },
      { id:'access', icon:'shield', label:'Access Control' },
    ]},
    { grp:'Platform', items:[
      { id:'hierarchy', icon:'layers', label:'Engagements' },
    ]},
    { grp:'Insight', items:[
      { id:'analytics', icon:'chart', label:'Usage & Value' },
      { id:'audit', icon:'audit', label:'Audit Log' },
    ]},
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-search" onClick={onSearch}>
          <Icon name="search" size={15} />
          <span style={{flex:1}}>Search skills…</span>
          <kbd>⌘K</kbd>
        </div>
        {nav.map(g=>(
          <div className="nav-group" key={g.grp}>
            <div className="lbl">{g.grp}</div>
            {g.items.map(it=>(
              <div key={it.id} className={'nav-item'+(view===it.id?' on':'')} onClick={()=>setView(it.id)}>
                <Icon name={it.icon} size={17} />
                <span>{it.label}</span>
                {it.alert>0 && <span className="alert">{it.alert}</span>}
                {it.count!=null && <span className="count">{it.count}</span>}
              </div>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <div className="side-user">
            <Avatar p="matt" size={32} />
            <div className="meta">
              <div className="nm">Matthew Maxwell</div>
              <div className="rl">Product owner · Methodology key</div>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}

function TopBar({ title, crumbs, actions }) {
  return (
    <div className="topbar">
      <div className="grow">
        {crumbs ? (
          <div className="crumb">{crumbs}</div>
        ) : (
          <div className="pagetitle">{title}</div>
        )}
      </div>
      {actions}
    </div>
  );
}

/* ---------------- Registry ---------------- */
function Registry({ onOpen }) {
  const D = DATA;
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [type, setType] = useState('all');
  const [vis, setVis] = useState('all');

  const list = useMemo(()=> D.skills.filter(s=>{
    if (s.isClientVariant) return false; // group variants under parent
    if (state!=='all' && s.state!==state) return false;
    if (type!=='all' && s.type!==type) return false;
    if (vis!=='all' && s.visibility!==vis) return false;
    if (q && !(s.name+s.desc+s.tags.join()).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [q,state,type,vis]);

  const counts = {
    all: D.skills.filter(s=>!s.isClientVariant).length,
    'client-ready': D.skills.filter(s=>!s.isClientVariant&&s.state==='client-ready').length,
    'internal-ready': D.skills.filter(s=>!s.isClientVariant&&s.state==='internal-ready').length,
    'draft': D.skills.filter(s=>!s.isClientVariant&&s.state==='draft').length,
    'retired': D.skills.filter(s=>!s.isClientVariant&&s.state==='retired').length,
  };

  return (
    <>
      <TopBar title="Skill Registry" actions={
        <div className="row gap8">
          <button className="btn btn-ghost"><Icon name="upload" size={15}/> Import</button>
          <button className="btn btn-primary"><Icon name="plus" size={15}/> New skill</button>
        </div>
      }/>
      <div className="content">
        <div className="wrap-wide fade-in">
          {/* stat strip */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:22}}>
            <StatMini k="Total skills" v={counts.all} sub="across the library" icon="layers"/>
            <StatMini k="Client-ready" v={counts['client-ready']} sub="both keys turned" icon="shield" accent/>
            <StatMini k="In certification" v={D.skills.filter(s=>s.inQueue).length} sub="awaiting a key" icon="cert"/>
            <StatMini k="Invocations · 30d" v={fmtNum(2165)} sub="+18% vs prior" icon="bolt"/>
          </div>

          {/* filters */}
          <div className="card" style={{padding:'14px 16px', marginBottom:16}}>
            <div className="row gap12" style={{flexWrap:'wrap'}}>
              <div className="registry-search">
                <Icon name="search" size={16} style={{flex:'none', color:'var(--faint)'}}/>
                <input placeholder="Filter by name, description, or tag…" value={q} onChange={e=>setQ(e.target.value)} />
                {q && <button className="clear-btn" onClick={()=>setQ('')}><Icon name="x" size={14}/></button>}
              </div>
              <FilterSeg label="State" value={state} set={setState} opts={[['all','All'],['client-ready','Client-ready'],['internal-ready','Internal-ready'],['draft','Draft'],['retired','Retired']]}/>
              <FilterSeg label="Type" value={type} set={setType} opts={[['all','All'],['prompt','Prompt'],['code','Code'],['hybrid','Hybrid']]}/>
              <FilterSeg label="Visibility" value={vis} set={setVis} opts={[['all','All'],['internal-only','Internal'],['client-facing','Client'],['paired','Paired']]}/>
            </div>
          </div>

          {/* table */}
          <div className="card" style={{overflow:'hidden'}}>
            <table className="tbl">
              <thead><tr>
                <th style={{width:'34%'}}>Skill</th>
                <th>Type</th>
                <th>Visibility</th>
                <th>State</th>
                <th>Version</th>
                <th>Owner</th>
                <th style={{textAlign:'right'}}>Runs</th>
                <th></th>
              </tr></thead>
              <tbody>
                {list.map(s=>(
                  <tr key={s.id} onClick={()=>onOpen(s.id)}>
                    <td>
                      <div style={{fontWeight:600, color:'var(--ink)'}}>{s.name}</div>
                      <div className="mono" style={{fontSize:11, color:'var(--faint)', marginTop:2}}>{s.id}</div>
                    </td>
                    <td><TypeChip type={s.type}/></td>
                    <td><VisChip visibility={s.visibility}/></td>
                    <td><StateBadge state={s.state}/></td>
                    <td><span className="ver">{s.version}</span></td>
                    <td><div className="row gap8"><Avatar p={s.owner} size={24}/><span style={{fontSize:12.5}}>{DATA.people[s.owner].short}</span></div></td>
                    <td style={{textAlign:'right', fontFamily:'var(--mono)', fontSize:12.5, color:'var(--ink-2)'}}>{fmtNum(s.runs)}</td>
                    <td style={{textAlign:'right', color:'var(--faint)'}}><Icon name="chevron" size={16}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length===0 && <div style={{padding:40, textAlign:'center', color:'var(--muted)'}}>No skills match these filters.</div>}
          </div>
          <div style={{marginTop:12, fontSize:12.5, color:'var(--faint)'}}>{list.length} skills · paired client variants are grouped under their parent</div>
        </div>
      </div>
    </>
  );
}

function StatMini({ k, v, sub, icon, accent }) {
  return (
    <div className="card stat" style={accent?{borderColor:'var(--green-100)', background:'linear-gradient(180deg,var(--green-50),var(--surface) 70%)'}:{}}>
      <div className="k"><Icon name={icon} size={15} style={{color:accent?'var(--green-600)':'var(--muted)'}}/> {k}</div>
      <div className="v">{v}</div>
      <div className="delta" style={{color:'var(--faint)', fontWeight:500}}>{sub}</div>
    </div>
  );
}

function FilterSeg({ label, value, set, opts }) {
  return (
    <div className="row gap8">
      <span style={{fontSize:11.5, fontWeight:700, letterSpacing:'.04em', textTransform:'uppercase', color:'var(--faint)'}}>{label}</span>
      <div className="row" style={{background:'var(--surface-sunk)', borderRadius:8, padding:3, gap:2}}>
        {opts.map(([val,lab])=>(
          <button key={val} onClick={()=>set(val)} style={{
            border:0, cursor:'pointer', fontSize:12, fontWeight:600, padding:'4px 9px', borderRadius:6,
            background: value===val?'var(--surface)':'transparent',
            color: value===val?'var(--ink)':'var(--muted)',
            boxShadow: value===val?'var(--sh-sm)':'none',
          }}>{lab}</button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Skill Detail ---------------- */
function SkillDetail({ id, onBack, onOpen }) {
  const s = DATA.skillById(id);
  const [tab, setTab] = useState('overview');
  const [managing, setManaging] = useState(false);
  const child = s.lineageChildId ? DATA.skillById(s.lineageChildId) : null;
  const parent = s.parentId ? DATA.skillById(s.parentId) : null;
  const both = s.tech.status==='certified' && s.method.status==='certified';

  const tabs = [['overview','Overview'],['versions','Versions'],['lineage','Lineage'],['usage','Usage'],['access','Access']];

  return (
    <>
      <TopBar crumbs={<><span onClick={onBack} style={{cursor:'pointer'}}>Skill Registry</span><Icon name="chevron" size={14}/><b>{s.name}</b></>}
        actions={<div className="row gap8">
          <button className="btn btn-ghost" onClick={onBack}><Icon name="arrowR" size={15} style={{transform:'rotate(180deg)'}}/> Back</button>
          <button className="btn btn-ghost"><Icon name="play" size={14}/> Run</button>
          <button className="btn btn-primary" onClick={()=>setManaging(true)}><Icon name="settings" size={14}/> Manage</button>
        </div>}/>
      <div className="content">
        <div className="wrap fade-in">
          {/* header block */}
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
              <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--faint)', marginBottom:10}}>Certification · v{s.version}</div>
              <CertLocks skill={s}/>
              <div style={{marginTop:12, padding:'10px 12px', borderRadius:8, fontSize:12.5, fontWeight:600,
                background: both?'var(--green-50)':'var(--surface-sunk)', color: both?'var(--green-700)':'var(--muted)'}}>
                {both ? '✓ Both keys turned — client-ready' : 'Awaiting both keys before client-ready'}
              </div>
            </div>
          </div>

          <div className="tabs" style={{marginBottom:22}}>
            {tabs.map(([t,l])=>(
              (t==='lineage' && s.visibility!=='paired' && !parent && !child) ? null :
              <div key={t} className={'tab'+(tab===t?' on':'')} onClick={()=>setTab(t)}>{l}</div>
            ))}
          </div>

          {tab==='overview' && <OverviewTab s={s}/>}
          {tab==='versions' && <VersionsTab s={s}/>}
          {tab==='lineage' && <LineageTab s={s} parent={parent} child={child} onOpen={onOpen}/>}
          {tab==='usage' && <UsageTab s={s}/>}
          {tab==='access' && <AccessTab s={s}/>}
        </div>
      </div>
      {managing && <ManageSkillModal skill={s} onClose={()=>setManaging(false)}/>}
    </>
  );
}

function MetaRow({ k, children }) {
  return <div style={{display:'grid', gridTemplateColumns:'130px 1fr', gap:14, padding:'11px 0', borderTop:'1px solid var(--line)', fontSize:13.5}}>
    <div className="muted" style={{fontWeight:600}}>{k}</div>
    <div style={{color:'var(--ink)'}}>{children}</div>
  </div>;
}

function OverviewTab({ s }) {
  return (
    <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:22, alignItems:'start'}}>
      <div className="card card-pad">
        <h3 style={{fontSize:16, marginBottom:4}}>Definition</h3>
        <div style={{marginTop:6}}>
          <MetaRow k="Runtime">{s.runtime}</MetaRow>
          <MetaRow k="Inputs"><span className="mono" style={{fontSize:12.5}}>{s.inputs}</span></MetaRow>
          <MetaRow k="Outputs"><span className="mono" style={{fontSize:12.5}}>{s.outputs}</span></MetaRow>
          <MetaRow k="Tags"><div className="row gap6" style={{flexWrap:'wrap'}}>{s.tags.map(t=><span key={t} className="tag">{t}</span>)}</div></MetaRow>
          <MetaRow k="Created">{s.created}</MetaRow>
          <MetaRow k="Lifecycle">{s.state==='client-ready'?'Available to clients on granted engagements':s.state==='internal-ready'?'Available to Vitalief consultants only':s.state==='draft'?'In authoring — not yet invokable in production':'Retired — retained for audit only'}</MetaRow>
        </div>
        {s.clientFacing && s.clientDesc && (
          <div style={{marginTop:16, padding:'14px 16px', borderRadius:10, background:'var(--st-client-bg)', border:'1px solid var(--st-client-bd)'}}>
            <div className="row gap6" style={{fontSize:12, fontWeight:700, color:'var(--st-client-tx)', marginBottom:8}}><Icon name="eye" size={14}/> CLIENT-VISIBLE DESCRIPTION</div>
            <div style={{fontSize:13.5, color:'var(--ink-2)'}}>{s.clientDesc}</div>
          </div>
        )}
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        <CertPanel s={s}/>
        <div className="card card-pad">
          <div className="row" style={{justifyContent:'space-between', marginBottom:10}}>
            <h3 style={{fontSize:15}}>Recent runs</h3>
            <span className="mono" style={{fontSize:12, color:'var(--faint)'}}>{fmtNum(s.runs)} total</span>
          </div>
          {DATA.invocations.filter(i=>i.skill===s.id || i.skill===s.lineageChildId).slice(0,4).map(i=>(
            <div key={i.id} className="row gap10" style={{padding:'8px 0', borderTop:'1px solid var(--line)', fontSize:12.5}}>
              <span className="d" style={{width:7,height:7,borderRadius:'50%', background:i.outcome==='success'?'var(--green-500)':'var(--danger)'}}></span>
              <span className="grow muted">{DATA.people[i.user].short} · {i.surface}</span>
              <span className="mono faint">{fmtMs(i.ms)}</span>
            </div>
          ))}
          {DATA.invocations.filter(i=>i.skill===s.id||i.skill===s.lineageChildId).length===0 &&
            <div className="muted" style={{fontSize:13, padding:'8px 0'}}>No production runs yet.</div>}
        </div>
      </div>
    </div>
  );
}

function VersionsTab({ s }) {
  const versions = s.versions || [{v:s.version, date:s.modified, author:s.owner, type:'minor', note:'Current version', recert:'certified'}];
  const typeColor = { major:'var(--danger)', minor:'var(--green-600)', patch:'var(--muted)' };
  return (
    <div className="card card-pad">
      <h3 style={{fontSize:16, marginBottom:16}}>Version history</h3>
      <div style={{position:'relative', paddingLeft:22}}>
        <div style={{position:'absolute', left:5, top:6, bottom:6, width:2, background:'var(--line)'}}></div>
        {versions.map((v,i)=>(
          <div key={v.v} style={{position:'relative', paddingBottom:i<versions.length-1?22:0}}>
            <div style={{position:'absolute', left:-22, top:3, width:12, height:12, borderRadius:'50%', background:i===0?'var(--green-600)':'var(--surface)', border:'2px solid '+(i===0?'var(--green-600)':'var(--line-strong)')}}></div>
            <div className="row gap10" style={{marginBottom:4}}>
              <span className="ver">{v.v}</span>
              <span className="tag" style={{color:typeColor[v.type], textTransform:'capitalize'}}>{v.type}</span>
              {i===0 && <span className="badge badge-state-client"><span className="d" style={{background:'var(--st-client)'}}></span>Current</span>}
              <span className="grow"></span>
              <span className="mono faint" style={{fontSize:12}}>{v.date}</span>
            </div>
            <div style={{fontSize:13.5, color:'var(--ink-2)', marginBottom:4}}>{v.note}</div>
            <div className="row gap10" style={{fontSize:12, color:'var(--muted)'}}>
              <span className="row gap6"><Avatar p={v.author} size={18}/>{DATA.people[v.author].short}</span>
              {v.recert==='certified' && <span className="row gap6" style={{color:'var(--green-600)'}}><Icon name="check" size={13}/>Re-certified</span>}
            </div>
          </div>
        ))}
      </div>
      <div style={{marginTop:18, paddingTop:14, borderTop:'1px solid var(--line)', fontSize:12.5, color:'var(--faint)'}}>
        Skills are versioned semantically. Every version is an immutable artifact and requires re-certification of both keys.
      </div>
    </div>
  );
}

function LineageTab({ s, parent, child, onOpen }) {
  const internal = parent ? parent : s;
  const clientV = child ? child : (s.isClientVariant ? s : null);
  if (s.visibility==='paired' && !parent && !child) {
    return <div className="card card-pad muted" style={{fontSize:14}}>This skill is designated <b>paired</b> but no client-facing derivative has been published yet. Publishing one will record the derivation lineage here.</div>;
  }
  return (
    <div>
      <div className="lineage">
        <LineageNode skill={internal} kind="internal" onOpen={onOpen} current={internal.id===s.id}/>
        <div className="lin-arrow">
          <svg width="56" height="60"><defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0l6 3-6 3" fill="none" stroke="var(--faint)" strokeWidth="1.4"/></marker></defs>
            <line x1="2" y1="30" x2="46" y2="30" stroke="var(--faint)" strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#ah)"/></svg>
          <span style={{position:'absolute', top:8, fontSize:10, fontWeight:700, letterSpacing:'.05em', color:'var(--faint)'}}>DERIVES</span>
        </div>
        {clientV
          ? <LineageNode skill={clientV} kind="client" onOpen={onOpen} current={clientV.id===s.id}/>
          : <div className="lin-node" style={{display:'flex', alignItems:'center', justifyContent:'center', borderStyle:'dashed', color:'var(--faint)', textAlign:'center', fontSize:13}}>No client-facing<br/>derivative published</div>}
      </div>
      <div className="card card-pad" style={{marginTop:18}}>
        <div className="row gap10" style={{marginBottom:10}}><Icon name="flag" size={16} style={{color:'var(--green-600)'}}/><h3 style={{fontSize:15}}>Derivation policy</h3></div>
        <p className="muted" style={{fontSize:13.5, margin:0, lineHeight:1.55}}>
          The client-facing variant is a sanitized derivative — it exposes outputs, name, and description, but never the instructions, code, or proprietary methodology of its parent.
          When the internal parent is updated, the derived skill is automatically <b style={{color:'var(--ink-2)'}}>flagged for review</b> so the pair never drifts.
        </p>
        <div style={{marginTop:12, padding:'10px 14px', borderRadius:8, background:'var(--surface-sunk)', fontSize:12.5, color:'var(--ink-2)'}} className="row gap8">
          <Icon name="check" size={14} style={{color:'var(--green-600)'}}/> Both variants currently aligned at v{internal.version}
        </div>
      </div>
    </div>
  );
}

function LineageNode({ skill, kind, onOpen, current }) {
  return (
    <div className={'lin-node '+kind} style={current?{boxShadow:'0 0 0 2px var(--green-300)'}:{}}>
      <div className="row gap8" style={{marginBottom:8}}>
        {kind==='internal' ? <span className="badge badge-state-internal"><Icon name="lock" size={11}/> Internal parent</span>
          : <span className="badge badge-state-client"><Icon name="eye" size={11}/> Client derivative</span>}
        {current && <span className="tag">viewing</span>}
      </div>
      <div style={{fontWeight:700, fontSize:15, marginBottom:4}}>{skill.name}</div>
      <div className="mono" style={{fontSize:11, color:'var(--faint)', marginBottom:8}}>{skill.id} · v{skill.version}</div>
      <p className="muted" style={{fontSize:12.5, margin:0, lineHeight:1.45}}>{skill.desc}</p>
      {!current && <button className="btn btn-ghost btn-sm" style={{marginTop:12}} onClick={()=>onOpen(skill.id)}>Open <Icon name="chevron" size={13}/></button>}
    </div>
  );
}

function UsageTab({ s }) {
  // Find all skillAssignments for this skill (both internal and client variants)
  const allIds = [s.id, s.lineageChildId].filter(Boolean);
  const assignments = DATA.skillAssignments.filter(a=>allIds.includes(a.skillId));
  const byProject = assignments.map(a=>{
    if (a.entityType==='project') {
      const p = DATA.projectById(a.entityId);
      return p ? { label:p.name, code:p.code, path:DATA.displayPath('project',p.id), n:Math.round(s.runs*0.35) } : null;
    }
    if (a.entityType==='study') {
      const st = DATA.studyById(a.entityId);
      return st ? { label:st.name, code:st.code, path:DATA.displayPath('study',st.id), n:Math.round(s.runs*0.25) } : null;
    }
    return null;
  }).filter(Boolean);
  return (
    <div style={{display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:22, alignItems:'start'}}>
      <div className="card card-pad">
        <div className="row" style={{justifyContent:'space-between', marginBottom:6}}>
          <h3 style={{fontSize:15}}>Invocations · 12 weeks</h3>
          <span className="mono" style={{fontSize:12, color:'var(--green-600)', fontWeight:600}}>{fmtNum(s.runs)} total</span>
        </div>
        <Sparkline data={DATA.usageSeries.map(v=>Math.round(v*0.12+s.runs/40))} w={520} h={120}/>
        <div className="row" style={{justifyContent:'space-between', marginTop:6, fontSize:11, color:'var(--faint)'}}>
          <span>{DATA.weeks[0]}</span><span>{DATA.weeks[DATA.weeks.length-1]}</span>
        </div>
      </div>
      <div className="card card-pad">
        <h3 style={{fontSize:15, marginBottom:12}}>By engagement context</h3>
        {byProject.length ? byProject.map((item,i)=>(
          <div key={i} style={{marginBottom:14}}>
            <div className="row" style={{justifyContent:'space-between', fontSize:12.5, marginBottom:3}}>
              <div>
                <div style={{fontWeight:600}}>{item.label}</div>
                <div className="mono faint" style={{fontSize:10.5}}>{item.path}</div>
              </div>
              <span className="mono faint">{item.n}</span>
            </div>
            <div className="barwrap"><div className="bar" style={{width:Math.min(100,item.n/s.runs*180)+'%'}}></div></div>
          </div>
        )) : <div className="muted" style={{fontSize:13}}>Not yet assigned to any project or study.</div>}
      </div>
    </div>
  );
}

function AccessTab({ s }) {
  const allIds = [s.id, s.lineageChildId].filter(Boolean);
  const assignments = DATA.skillAssignments.filter(a=>allIds.includes(a.skillId));
  return (
    <div className="card card-pad">
      <h3 style={{fontSize:16, marginBottom:4}}>Access scope</h3>
      <p className="muted" style={{fontSize:13.5, marginTop:0}}>Access is scoped to a specific level in the Client → Project → Study structure. {s.visibility==='internal-only' ? 'This is an internal-only skill — never exposed to clients.' : 'Clients receive outputs only; instructions, code, and methodology remain hidden.'}</p>
      {assignments.length ? (
        <div style={{marginTop:8}}>
          <div className="row" style={{fontSize:11, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--faint)', padding:'8px 0', borderBottom:'1px solid var(--line)', gap:12}}>
            <span style={{flex:1}}>Context path</span>
            <span style={{width:90}}>Level</span>
            <span style={{width:110}}>Granted</span>
            <span style={{width:80}}>By</span>
          </div>
          {assignments.map(a=>{
            const path = DATA.displayPath(a.entityType, a.entityId);
            const grantee = DATA.people[a.grantedBy];
            return (
              <div key={a.id} className="row gap12" style={{padding:'12px 0', borderBottom:'1px solid var(--line)', fontSize:13, alignItems:'flex-start'}}>
                <div style={{flex:1}}>
                  <div className="mono" style={{fontSize:11.5, color:'var(--ink-2)', lineHeight:1.4}}>{path}</div>
                </div>
                <span style={{width:90}}><EntityBadge type={a.entityType} small/></span>
                <span style={{width:110, color:'var(--muted)', fontSize:12.5}}>{a.grantedAt}</span>
                <div style={{width:80}} className="row gap6">{grantee && <><Avatar p={grantee} size={18}/><span style={{fontSize:12}}>{grantee.short}</span></>}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="muted" style={{fontSize:13, padding:'14px 0'}}>Not yet assigned to any project or study.</div>
      )}
      {s.visibility!=='internal-only' && (
        <div style={{marginTop:16, padding:'12px 14px', borderRadius:9, background:'var(--surface-sunk)', fontSize:12.5, color:'var(--ink-2)'}} className="row gap8">
          <Icon name="eye" size={14} style={{color:'var(--muted)'}}/>
          Clients see: name, description, and outputs only. Instructions, code, and methodology are never exposed.
        </div>
      )}
    </div>
  );
}

/* ---------- Manage Skill Modal ---------- */
function ManageSkillModal({ skill, onClose }) {
  const [desc,    setDesc]   = React.useState(skill.desc);
  const [cDesc,   setCDesc]  = React.useState(skill.clientDesc||'');
  const [vis,     setVis]    = React.useState(skill.visibility);
  const [state,   setState]  = React.useState(skill.state);
  const [tags,    setTags]   = React.useState(skill.tags.join(', '));
  const [saved,   setSaved]  = React.useState(false);

  const lifecycleSteps = [
    { id:'draft',          label:'Draft',           sub:'Authoring — not invokable in production' },
    { id:'internal-ready', label:'Internal-ready',  sub:'Available to Vitalief consultants only' },
    { id:'client-ready',   label:'Client-ready',    sub:'Available on granted client engagements' },
    { id:'retired',        label:'Retired',         sub:'Preserved for audit; cannot be invoked' },
  ];
  const visOpts = [
    { id:'internal-only', label:'Internal-only', icon:'lock',   sub:'Never exposed to clients' },
    { id:'paired',        label:'Paired',        icon:'layers', sub:'Has a sanitized client variant' },
    { id:'client-facing', label:'Client-facing', icon:'eye',    sub:'This IS the client-facing variant' },
  ];

  const save = () => { setSaved(true); setTimeout(onClose, 900); };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={e=>e.stopPropagation()}>
        {/* header */}
        <div style={{padding:'20px 22px 16px', borderBottom:'1px solid var(--line)', flex:'none'}}>
          <div className="row gap10" style={{marginBottom:4}}>
            <TypeChip type={skill.type}/>
            <span className="ver">{skill.version}</span>
            <button onClick={onClose} className="btn btn-quiet btn-sm" style={{marginLeft:'auto', padding:'4px 8px'}}><Icon name="x" size={15}/></button>
          </div>
          <h2 style={{fontSize:20, marginBottom:2}}>{skill.name}</h2>
          <div className="mono faint" style={{fontSize:11.5}}>{skill.id}</div>
        </div>

        {/* scrollable form */}
        <div style={{flex:1, overflowY:'auto', padding:'20px 22px', display:'flex', flexDirection:'column', gap:20}}>

          {/* Lifecycle state */}
          <div>
            <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--faint)', marginBottom:10}}>Lifecycle state</div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {lifecycleSteps.map((ls,i)=>{
                const active = state===ls.id;
                const past   = lifecycleSteps.findIndex(x=>x.id===state) > i;
                return (
                  <div key={ls.id} onClick={()=>setState(ls.id)}
                    style={{display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:9, cursor:'pointer', border:'1px solid '+(active?'var(--green-300)':'var(--line)'), background:active?'var(--green-50)':'var(--surface)'}}>
                    <span style={{width:20, height:20, borderRadius:'50%', flex:'none', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700,
                      background:active?'var(--green-600)':past?'var(--green-100)':'var(--surface-sunk)', color:active?'#fff':past?'var(--green-700)':'var(--faint)', border:active?'none':'1px solid var(--line-2)'}}>
                      {past ? <Icon name="check" size={11}/> : i+1}
                    </span>
                    <div className="grow">
                      <div style={{fontWeight:600, fontSize:13.5, color:active?'var(--green-800)':'var(--ink-2)'}}>{ls.label}</div>
                      <div style={{fontSize:12, color:'var(--muted)'}}>{ls.sub}</div>
                    </div>
                    {active && <StateBadge state={ls.id}/>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Visibility */}
          <div>
            <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--faint)', marginBottom:10}}>Client visibility</div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {visOpts.map(v=>{
                const active = vis===v.id;
                return (
                  <div key={v.id} onClick={()=>setVis(v.id)}
                    style={{display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:9, cursor:'pointer', border:'1px solid '+(active?'var(--green-300)':'var(--line)'), background:active?'var(--green-50)':'var(--surface)'}}>
                    <Icon name={v.icon} size={16} style={{color:active?'var(--green-700)':'var(--muted)', flex:'none'}}/>
                    <div className="grow"><div style={{fontWeight:600, fontSize:13.5}}>{v.label}</div><div style={{fontSize:12, color:'var(--muted)'}}>{v.sub}</div></div>
                    {active && <span style={{width:18,height:18,borderRadius:'50%',background:'var(--green-600)',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name="check" size={11} style={{color:'#fff'}}/></span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--faint)', marginBottom:8}}>Internal description</div>
            <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3}
              style={{width:'100%', padding:'10px 12px', borderRadius:9, border:'1px solid var(--line-2)', fontFamily:'var(--sans)', fontSize:13.5, color:'var(--ink)', resize:'vertical', outline:'none'}}
              onFocus={e=>e.target.style.borderColor='var(--green-300)'} onBlur={e=>e.target.style.borderColor='var(--line-2)'}/>
          </div>

          {vis!=='internal-only' && (
            <div>
              <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--faint)', marginBottom:4}}>Client-visible description</div>
              <div style={{fontSize:12, color:'var(--muted)', marginBottom:8}}>Shown to clients in the portal — no methodology detail</div>
              <textarea value={cDesc} onChange={e=>setCDesc(e.target.value)} rows={3}
                style={{width:'100%', padding:'10px 12px', borderRadius:9, border:'1px solid var(--line-2)', fontFamily:'var(--sans)', fontSize:13.5, color:'var(--ink)', resize:'vertical', outline:'none'}}
                onFocus={e=>e.target.style.borderColor='var(--green-300)'} onBlur={e=>e.target.style.borderColor='var(--line-2)'}/>
            </div>
          )}

          {/* Tags */}
          <div>
            <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--faint)', marginBottom:8}}>Tags <span style={{fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:11}}>(comma-separated)</span></div>
            <input value={tags} onChange={e=>setTags(e.target.value)} style={{width:'100%', padding:'9px 12px', borderRadius:9, border:'1px solid var(--line-2)', fontFamily:'var(--sans)', fontSize:13.5, color:'var(--ink)', outline:'none'}}
              onFocus={e=>e.target.style.borderColor='var(--green-300)'} onBlur={e=>e.target.style.borderColor='var(--line-2)'}/>
            <div className="row gap6" style={{marginTop:8, flexWrap:'wrap'}}>
              {tags.split(',').map(t=>t.trim()).filter(Boolean).map(t=><span key={t} className="tag">{t}</span>)}
            </div>
          </div>

          {/* Runtime (read-only) */}
          <div>
            <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--faint)', marginBottom:8}}>Runtime</div>
            <div style={{padding:'9px 12px', borderRadius:9, background:'var(--surface-sunk)', fontSize:13, color:'var(--muted)', fontFamily:'var(--mono)'}}>{skill.runtime}</div>
          </div>
        </div>

        {/* footer */}
        <div style={{padding:'14px 22px', borderTop:'1px solid var(--line)', flex:'none', background:'var(--surface-2)'}} className="row gap10">
          <button className="btn btn-ghost" onClick={onClose}>Discard</button>
          <div className="grow"></div>
          {saved
            ? <span className="row gap8" style={{color:'var(--green-600)', fontWeight:600, fontSize:13.5}}><Icon name="check" size={15}/> Saved</span>
            : <button className="btn btn-primary" onClick={save}><Icon name="check" size={14}/> Save changes</button>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ManageSkillModal });

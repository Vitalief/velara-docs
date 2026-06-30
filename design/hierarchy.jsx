/* Velara — Organizational Hierarchy Management (ORG-01 → ORG-05) */

// Extend icon set with hierarchy-specific icons
Object.assign(I, {
  pin:   'M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7zm0 4a3 3 0 100 6 3 3 0 000-6z',
  flask: 'M9 3h6m-3 0v6l-4 8h10L14 9V3M5 19h14',
});

const ENTITY = {
  org:      { label:'Organization', icon:'building', color:'#1c4b40', bg:'#dbe7e2' },
  client:   { label:'Client',       icon:'users',    color:'#3d5a8a', bg:'#e4e9f4' },
  project:  { label:'Project',      icon:'layers',   color:'#7a5c33', bg:'#f0e8da' },
  study:    { label:'Study',        icon:'flask',    color:'#5a4a7a', bg:'#ece8f4' },
  location: { label:'Location',     icon:'pin',      color:'#2e7a6a', bg:'#e0f0ec' },
};

function EntityBadge({ type, small }) {
  const m = ENTITY[type] || ENTITY.org;
  return (
    <span className="row gap6" style={{display:'inline-flex', alignItems:'center', gap:6,
      fontSize: small?11:12, fontWeight:700, color:m.color,
      background:m.bg, padding: small?'2px 7px':'4px 10px', borderRadius:999, whiteSpace:'nowrap'}}>
      <Icon name={m.icon} size={small?12:14}/>{m.label}
    </span>
  );
}

function HierarchyPath({ type, id, onSelect }) {
  const segs = DATA.entityPath(type, id).filter(s=>s.type!=='org'); // org is backend-only
  return (
    <div className="row gap6" style={{flexWrap:'wrap', alignItems:'center'}}>
      {segs.map((s,i)=>(
        <React.Fragment key={s.id}>
          {i>0 && <Icon name="chevron" size={13} style={{color:'var(--faint)', transform:'none'}}/>}
          <button onClick={()=>onSelect&&onSelect(s.type,s.id)} style={{
            border:0, background:'transparent', cursor:onSelect?'pointer':'default',
            fontSize:12.5, fontWeight: i===segs.length-1?700:500,
            color: i===segs.length-1?'var(--ink)':'var(--muted)',
            padding:'2px 4px', borderRadius:5, fontFamily:'var(--sans)',
          }}
          onMouseEnter={e=>{ if(onSelect&&i<segs.length-1) e.currentTarget.style.background='var(--surface-sunk)'; }}
          onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; }}>
            {s.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------- Tree — starts at Client level (org is a hidden tenant concept) ---------- */
function HierarchyTree({ sel, onSelect, expanded, setExpanded }) {
  const toggle = (id) => setExpanded(ex => { const s=new Set(ex); s.has(id)?s.delete(id):s.add(id); return s; });
  const isExp = id => expanded.has(id);
  const isOn  = (type,id) => sel&&sel.type===type&&sel.id===id;

  const TreeNode = ({ type, id, name, depth=0, hasChildren }) => {
    const on = isOn(type,id);
    const exp = isExp(id);
    const m = ENTITY[type];
    return (
      <div>
        <div className="row gap6" onClick={()=>{ onSelect(type,id); if(hasChildren) toggle(id); }}
          style={{ padding:'6px 10px 6px '+(10+depth*14)+'px', cursor:'pointer', borderRadius:8, margin:'1px 6px',
            background: on?'var(--green-50)':'transparent',
            color: on?'var(--green-800)':'var(--ink-2)',
          }}
          onMouseEnter={e=>{ if(!on) e.currentTarget.style.background='var(--surface-sunk)'; }}
          onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent'; }}>
          {hasChildren && (
            <span style={{color:'var(--faint)', flex:'none', width:14, display:'flex', alignItems:'center', justifyContent:'center',
              transform: exp?'rotate(90deg)':'none', transition:'transform .15s'}}>
              <Icon name="chevron" size={13}/>
            </span>
          )}
          {!hasChildren && <span style={{width:14, flex:'none'}}></span>}
          <span style={{width:20, height:20, borderRadius:6, background:m.bg, display:'flex', alignItems:'center', justifyContent:'center', flex:'none'}}>
            <Icon name={m.icon} size={12} style={{color:m.color}}/>
          </span>
          <span style={{fontSize:13, fontWeight: on?700:500, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{name}</span>
        </div>
        {exp && <div>{hasChildren && renderChildren(type,id,depth+1)}</div>}
      </div>
    );
  };

  const renderChildren = (parentType, parentId, depth) => {
    if (parentType==='client') {
      return DATA.projects.filter(p=>p.client===parentId).map(p=>(
        <TreeNode key={p.id} type="project" id={p.id} name={p.name} depth={depth}
          hasChildren={DATA.studies.some(s=>s.project===p.id)}/>
      ));
    }
    if (parentType==='project') {
      return DATA.studies.filter(s=>s.project===parentId).map(s=>(
        <TreeNode key={s.id} type="study" id={s.id} name={s.name} depth={depth}
          hasChildren={DATA.locations.some(l=>l.study===s.id)}/>
      ));
    }
    if (parentType==='study') {
      return DATA.locations.filter(l=>l.study===parentId).map(l=>(
        <TreeNode key={l.id} type="location" id={l.id} name={l.name} depth={depth} hasChildren={false}/>
      ));
    }
    return null;
  };

  return (
    <div style={{flex:1, overflowY:'auto', paddingBottom:20}}>
      {/* Top level = clients (org is a hidden tenant layer) */}
      {DATA.clients.map(c=>(
        <TreeNode key={c.id} type="client" id={c.id} name={c.name} depth={0}
          hasChildren={DATA.projects.some(p=>p.client===c.id)}/>
      ))}
    </div>
  );
}

/* ---------- Entity Detail ---------- */
function EntityDetail({ type, id, onSelect, onAdd }) {
  const m = ENTITY[type];
  let entity, children = [], childType = null, childLabel = '';

  if (type==='org') {
    entity = DATA.orgs.find(x=>x.id===id);
    children = DATA.clients.filter(c=>c.org===id);
    childType='client'; childLabel='Clients';
  } else if (type==='client') {
    entity = DATA.clients.find(x=>x.id===id);
    children = DATA.projects.filter(p=>p.client===id);
    childType='project'; childLabel='Projects';
  } else if (type==='project') {
    entity = DATA.projects.find(x=>x.id===id);
    children = DATA.studies.filter(s=>s.project===id);
    childType='study'; childLabel='Studies';
  } else if (type==='study') {
    entity = DATA.studies.find(x=>x.id===id);
    children = DATA.locations.filter(l=>l.study===id);
    childType='location'; childLabel='Locations';
  } else if (type==='location') {
    entity = DATA.locations.find(x=>x.id===id);
  }

  if (!entity) return null;

  const assignments = DATA.skillAssignments.filter(a=>a.entityType===type&&a.entityId===id);
  const parentAssignments = (() => {
    if (type==='location') {
      const loc = entity;
      return DATA.skillAssignments.filter(a=>a.entityType==='study'&&a.entityId===loc.study);
    }
    if (type==='study') {
      const prj = DATA.studies.find(x=>x.id===id)?.project;
      return DATA.skillAssignments.filter(a=>a.entityType==='project'&&a.entityId===prj);
    }
    return [];
  })();

  const statusColor = (s) => s==='active'?'var(--st-client-tx)':s==='paused'?'var(--st-internal-tx)':'var(--muted)';
  const statusBg    = (s) => s==='active'?'var(--st-client-bg)':s==='paused'?'var(--st-internal-bg)':'var(--surface-sunk)';

  return (
    <div className="fade-in" style={{display:'flex', flexDirection:'column', gap:18}}>
      {/* header */}
      <div className="card card-pad">
        <div className="row gap10" style={{marginBottom:12}}>
          <EntityBadge type={type}/>
          {entity.status && (
            <span style={{fontSize:11.5, fontWeight:700, background:statusBg(entity.status), color:statusColor(entity.status),
              padding:'3px 10px', borderRadius:999}}>{entity.status}</span>
          )}
          {entity.active===false && type==='client' && (
            <span style={{fontSize:11.5, fontWeight:700, background:'var(--st-retired-bg)', color:'var(--st-retired)',
              padding:'3px 10px', borderRadius:999}}>paused</span>
          )}
        </div>
        <div className="row gap16" style={{alignItems:'flex-start'}}>
          <div className="grow">
            <h2 style={{fontSize:24, marginBottom:8}}>{entity.name}</h2>
            <p className="muted" style={{margin:'0 0 12px', fontSize:14, lineHeight:1.5}}>{entity.desc}</p>
            <HierarchyPath type={type} id={id} onSelect={onSelect}/>
          </div>
          {type!=='org' && (
            <div style={{width:36, height:36, borderRadius:10, background:m.bg, display:'flex', alignItems:'center', justifyContent:'center', flex:'none'}}>
              <Icon name={m.icon} size={20} style={{color:m.color}}/>
            </div>
          )}
        </div>

        {/* meta strip */}
        <div className="row gap0" style={{marginTop:14, paddingTop:14, borderTop:'1px solid var(--line)', gap:24, flexWrap:'wrap'}}>
          {entity.code && <MetaChip k="Code" v={entity.code} mono/>}
          {entity.created && <MetaChip k="Created" v={entity.created}/>}
          {entity.lead && <MetaChip k="Lead" v={DATA.people[entity.lead]?.name}/>}
          {entity.phase && <MetaChip k="Phase" v={entity.phase}/>}
          {entity.sponsor && <MetaChip k="Sponsor" v={entity.sponsor}/>}
          {entity.pi && <MetaChip k="Principal Investigator" v={entity.pi}/>}
          {entity.city && <MetaChip k="Site city" v={entity.city}/>}
          {entity.activated && <MetaChip k="Activated" v={entity.activated}/>}
          {type==='project' && <MetaChip k="Skill level" v={entity.skillsAtProject?'Project-level (no studies)':'Study-level'}/>}
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns: children.length?'1fr 1fr':'1fr', gap:18, alignItems:'start'}}>
        {/* children */}
        {childType && (
          <div className="card card-pad">
            <div className="row" style={{justifyContent:'space-between', marginBottom:14}}>
              <h3 style={{fontSize:15}}>{childLabel} <span className="faint mono" style={{fontSize:12}}>· {children.length}</span></h3>
              {childType!=='location' || type==='study' ? (
                <button className="btn btn-primary btn-sm" onClick={()=>onAdd(childType, type, id)}>
                  <Icon name="plus" size={13}/> Add {ENTITY[childType].label}
                </button>
              ) : null}
            </div>
            {children.length ? (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {children.map(c=>{
                  const cm = ENTITY[childType];
                  return (
                    <div key={c.id} className="row gap12" onClick={()=>onSelect(childType, c.id)}
                      style={{padding:'11px 13px', borderRadius:10, border:'1px solid var(--line)', cursor:'pointer', background:'var(--surface)'}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor='var(--line-strong)'}
                      onMouseLeave={e=>e.currentTarget.style.borderColor='var(--line)'}>
                      <span style={{width:32, height:32, borderRadius:8, background:cm.bg, display:'flex', alignItems:'center', justifyContent:'center', flex:'none'}}>
                        <Icon name={cm.icon} size={16} style={{color:cm.color}}/>
                      </span>
                      <div className="grow">
                        <div style={{fontWeight:600, fontSize:13.5}}>{c.name}</div>
                        <div className="muted" style={{fontSize:12}}>{c.code||c.city||''}</div>
                      </div>
                      {c.status && <span style={{fontSize:11, fontWeight:700, background:statusBg(c.status), color:statusColor(c.status), padding:'2px 8px', borderRadius:999}}>{c.status}</span>}
                      {c.active===false && childType==='client' && <span style={{fontSize:11, fontWeight:700, background:'var(--st-retired-bg)', color:'var(--st-retired)', padding:'2px 8px', borderRadius:999}}>paused</span>}
                      <Icon name="chevron" size={15} style={{color:'var(--faint)'}}/>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{fontSize:13.5, padding:'8px 0'}}>
                No {childLabel.toLowerCase()} yet.
                {type==='project'&&childType==='study'&&entity.skillsAtProject&&(
                  <span> Skills are attached at project level for this engagement.</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* skills — always visible for project and study level */}
        {(type==='project' || type==='study' || (type==='location' && (assignments.length>0||parentAssignments.length>0))) && (
          <div className="card card-pad">
            <div className="row" style={{justifyContent:'space-between', marginBottom:14}}>
              <div>
                <h3 style={{fontSize:15}}>Attached skills <span className="faint mono" style={{fontSize:12}}>· {assignments.length}</span></h3>
                {type==='project' && !entity.skillsAtProject && assignments.length===0 && (
                  <div style={{fontSize:12, color:'var(--muted)', marginTop:3}}>Skills attached here are available across all studies in this project</div>
                )}
              </div>
              {(type==='project'||type==='study') && <button className="btn btn-ghost btn-sm" onClick={()=>onAdd('skill-attach', type, id)}><Icon name="plus" size={13}/> Attach</button>}
            </div>
            {assignments.length ? (
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {assignments.map(a=>{
                  const s = DATA.skillById(a.skillId);
                  if (!s) return null;
                  return (
                    <div key={a.id} className="row gap10" style={{padding:'10px 12px', borderRadius:10, border:'1px solid var(--line)', background:'var(--surface)'}}>
                      <Icon name={TYPE_META[s.type].icon} size={15} style={{color:'var(--muted)'}}/>
                      <div className="grow">
                        <div style={{fontWeight:600, fontSize:13}}>{s.name}</div>
                        <div className="muted" style={{fontSize:11.5}}>v{s.version} · granted {a.grantedAt} by {DATA.people[a.grantedBy]?.short}</div>
                      </div>
                      <StateBadge state={s.state}/>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{fontSize:13.5}}>No skills directly attached at this level.</div>
            )}
            {parentAssignments.length>0 && (
              <>
                <div style={{fontSize:11, fontWeight:700, letterSpacing:'.05em', color:'var(--faint)', margin:'14px 0 8px', textTransform:'uppercase'}}>Inherited from parent level</div>
                {parentAssignments.map(a=>{
                  const s = DATA.skillById(a.skillId);
                  if(!s) return null;
                  return (
                    <div key={a.id} className="row gap10" style={{padding:'8px 12px', borderRadius:10, border:'1px dashed var(--line-2)', background:'var(--surface-2)'}}>
                      <Icon name={TYPE_META[s.type].icon} size={14} style={{color:'var(--faint)'}}/>
                      <div className="grow"><div style={{fontWeight:500, fontSize:13, color:'var(--muted)'}}>{s.name}</div></div>
                      <StateBadge state={s.state}/>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* path reference */}
      <div className="card card-pad" style={{background:'var(--surface-2)'}}>
        <div className="row gap8" style={{marginBottom:8}}>
          <Icon name="audit" size={15} style={{color:'var(--muted)'}}/>
          <div style={{fontSize:12, fontWeight:700, letterSpacing:'.04em', color:'var(--muted)', textTransform:'uppercase'}}>Context path</div>
        </div>
        <div className="mono" style={{fontSize:12.5, color:'var(--ink-2)', padding:'8px 12px', background:'var(--surface-sunk)', borderRadius:8, border:'1px solid var(--line)'}}>
          {DATA.displayPath(type, id)}
        </div>
        <div className="muted" style={{fontSize:12, marginTop:8}}>All access control policies, audit events, and invocation records for this entity carry this context path.</div>
      </div>
    </div>
  );
}

function MetaChip({ k, v, mono }) {
  return (
    <div style={{display:'flex', flexDirection:'column', gap:2}}>
      <span style={{fontSize:10.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--faint)'}}>{k}</span>
      <span style={{fontSize:13, color:'var(--ink-2)', fontFamily: mono?'var(--mono)':'inherit', fontWeight:500}}>{v}</span>
    </div>
  );
}

/* ---------- Add Entity Modal ---------- */
const ADD_FIELDS = {
  client:   [{id:'name',label:'Client name',ph:'Beth Israel Lahey Health'},{id:'code',label:'Code',ph:'BILH'},{id:'desc',label:'Description',ph:'Brief engagement context'}],
  project:  [{id:'name',label:'Project name',ph:'Oncology Network Startup'},{id:'code',label:'Code',ph:'BILH-ONC'},{id:'desc',label:'Description',ph:'Scope summary'},{id:'lead',label:'Lead',ph:'Consultant name'}],
  study:    [{id:'name',label:'Study name',ph:'ONC-204 Phase II'},{id:'code',label:'Protocol code',ph:'ONC-204'},{id:'phase',label:'Phase',ph:'Phase II'},{id:'sponsor',label:'Sponsor',ph:'BILH Oncology'},{id:'desc',label:'Description',ph:'Brief'}],
  location: [{id:'name',label:'Site name',ph:'Mass General Hospital'},{id:'code',label:'Site code',ph:'MGH-01'},{id:'city',label:'City',ph:'Boston, MA'},{id:'pi',label:'Principal Investigator',ph:'Dr. A. Chen'}],
  'skill-attach': [],
};

function AddEntityModal({ childType, parentType, parentId, onClose }) {
  const [vals, setVals] = React.useState({});
  const isSkill = childType==='skill-attach';
  const [selSkill, setSelSkill] = React.useState('');
  const fields = ADD_FIELDS[childType] || [];
  const m = ENTITY[isSkill?parentType:childType];
  const parentName = (() => {
    if(parentType==='client') return DATA.clients.find(x=>x.id===parentId)?.name;
    if(parentType==='project') return DATA.projects.find(x=>x.id===parentId)?.name;
    if(parentType==='study') return DATA.studies.find(x=>x.id===parentId)?.name;
    return '';
  })();
  const availableSkills = DATA.skills.filter(s=>!s.isClientVariant && (s.state==='client-ready'||s.state==='internal-ready'));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{padding:0, overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
        {/* header */}
        <div style={{padding:'20px 22px 16px', borderBottom:'1px solid var(--line)'}}>
          <div className="row gap10" style={{marginBottom:6}}>
            {isSkill ? <Icon name="layers" size={16} style={{color:'var(--muted)'}}/> : <EntityBadge type={childType} small/>}
            {isSkill && <span style={{fontSize:13, fontWeight:700, color:'var(--muted)'}}>Attach skill</span>}
          </div>
          <h2 style={{fontSize:20}}>{isSkill?'Attach skill to '+ENTITY[parentType].label:'Add '+ENTITY[childType].label}</h2>
          {parentName && <div className="muted" style={{fontSize:13, marginTop:4}}>Under: <b style={{color:'var(--ink-2)'}}>{parentName}</b></div>}
        </div>

        {/* form */}
        <div style={{padding:'18px 22px', display:'flex', flexDirection:'column', gap:14}}>
          {isSkill ? (
            <>
              <div>
                <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.04em', color:'var(--faint)', marginBottom:7, textTransform:'uppercase'}}>Select skill</div>
                <select value={selSkill} onChange={e=>setSelSkill(e.target.value)} style={selStyle}>
                  <option value="">— choose a skill —</option>
                  {availableSkills.map(s=><option key={s.id} value={s.id}>{s.name} · v{s.version}</option>)}
                </select>
              </div>
              {selSkill && (() => {
                const s = DATA.skillById(selSkill);
                return <div style={{padding:'12px 14px', borderRadius:10, background:'var(--green-50)', border:'1px solid var(--green-100)', fontSize:13}}>
                  <div className="row gap8"><StateBadge state={s.state}/><VisChip visibility={s.visibility}/></div>
                  <div style={{fontWeight:600, marginTop:6}}>{s.name}</div>
                  <div className="muted" style={{marginTop:3}}>{s.desc}</div>
                </div>;
              })()}
              <div style={{padding:'10px 14px', borderRadius:9, background:'var(--surface-sunk)', fontSize:12.5, color:'var(--muted)'}}>
                <Icon name="audit" size={13} style={{verticalAlign:'middle', marginRight:6}}/>
                Full path will be stamped on all invocation records for audit (ORG-04)
              </div>
            </>
          ) : fields.map(f=>(
            <div key={f.id}>
              <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.04em', color:'var(--faint)', marginBottom:7, textTransform:'uppercase'}}>{f.label}</div>
              <input value={vals[f.id]||''} onChange={e=>setVals(v=>({...v,[f.id]:e.target.value}))} placeholder={f.ph}
                style={{width:'100%', padding:'9px 12px', borderRadius:9, border:'1px solid var(--line-2)', background:'var(--surface)', fontFamily:'var(--sans)', fontSize:13.5, color:'var(--ink)', outline:'none'}}
                onFocus={e=>e.target.style.borderColor='var(--green-300)'}
                onBlur={e=>e.target.style.borderColor='var(--line-2)'}/>
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="row gap10" style={{padding:'14px 22px', borderTop:'1px solid var(--line)', justifyContent:'flex-end', background:'var(--surface-2)'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onClose}><Icon name="check" size={14}/>
            {isSkill?'Attach skill':'Create '+ENTITY[childType].label}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Search Results (flat filtered list) ---------- */
function SearchResults({ query, typeFilter, statusFilter, onSelect }) {
  const statusColor = s => s==='active'?'var(--st-client-tx)':s==='paused'?'var(--st-internal-tx)':'var(--muted)';
  const statusBg    = s => s==='active'?'var(--st-client-bg)':s==='paused'?'var(--st-internal-bg)':'var(--surface-sunk)';

  const all = [
    ...DATA.clients.map(e   => ({ type:'client',   entity:e, tokens:[e.name,e.code,e.desc,DATA.people[e.lead]?.name].filter(Boolean).join(' ') })),
    ...DATA.projects.map(e  => ({ type:'project',  entity:e, tokens:[e.name,e.code,e.desc,DATA.people[e.lead]?.name].filter(Boolean).join(' ') })),
    ...DATA.studies.map(e   => ({ type:'study',    entity:e, tokens:[e.name,e.code,e.phase,e.sponsor,e.desc].filter(Boolean).join(' ') })),
    ...DATA.locations.map(e => ({ type:'location', entity:e, tokens:[e.name,e.code,e.city,e.pi].filter(Boolean).join(' ') })),
  ];

  const q = query.trim().toLowerCase();

  const results = all.filter(item => {
    const tLabel = item.type === 'location' ? 'site' : item.type;
    if (typeFilter !== 'all' && tLabel !== typeFilter) return false;
    const entityStatus = item.entity.status || (item.entity.active === false ? 'paused' : item.entity.active === true ? 'active' : null);
    if (statusFilter !== 'all' && entityStatus !== statusFilter) return false;
    if (q && !item.tokens.toLowerCase().includes(q)) return false;
    return true;
  });

  if (results.length === 0) {
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, gap:8 }}>
        <Icon name="search" size={22} style={{ color:'var(--faint)' }}/>
        <div style={{ fontSize:13, color:'var(--faint)', textAlign:'center' }}>
          {q ? <>No results for <b>"{query}"</b></> : 'No matching entities.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'6px 8px 20px' }}>
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.07em', color:'var(--faint)', padding:'6px 8px 6px' }}>
        {results.length} result{results.length !== 1 ? 's' : ''}{q ? ` · "${query}"` : ''}
      </div>
      {results.map(({ type, entity }) => {
        const path     = DATA.displayPath(type, entity.id);
        const segs     = path.split(' / ');
        const parentPath = segs.slice(0, -1).join(' / ');
        const entityStatus = entity.status || (entity.active === false ? 'paused' : entity.active === true ? 'active' : null);
        return (
          <div key={entity.id}
            onClick={() => onSelect(type, entity.id)}
            style={{ padding:'9px 10px', borderRadius:8, cursor:'pointer', margin:'1px 0', border:'1px solid transparent' }}
            onMouseEnter={e => { e.currentTarget.style.background='var(--surface-sunk)'; e.currentTarget.style.borderColor='var(--line)'; }}
            onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.borderColor='transparent'; }}>
            <div className="row gap6" style={{ marginBottom:4 }}>
              <EntityBadge type={type} small/>
              {entity.code && (
                <span className="mono" style={{ fontSize:10, color:'var(--faint)', background:'var(--surface-sunk)', padding:'1px 5px', borderRadius:4, border:'1px solid var(--line)' }}>{entity.code}</span>
              )}
              {entityStatus && (
                <span style={{ marginLeft:'auto', fontSize:10, fontWeight:700, background:statusBg(entityStatus), color:statusColor(entityStatus), padding:'1px 7px', borderRadius:999 }}>{entityStatus}</span>
              )}
            </div>
            <div style={{ fontWeight:600, fontSize:13, color:'var(--ink)', marginBottom: parentPath ? 2 : 0 }}>{entity.name}</div>
            {parentPath && (
              <div style={{ fontSize:11, color:'var(--faint)', fontFamily:'var(--mono)', lineHeight:1.4 }}>{parentPath}</div>
            )}
            {entity.lead && (
              <div className="row gap4" style={{ marginTop:4 }}>
                <Avatar p={entity.lead} size={14}/>
                <span style={{ fontSize:11, color:'var(--muted)' }}>{DATA.people[entity.lead]?.short}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Main Engagements View ---------- */
function OrgHierarchy() {
  const [sel,          setSel]          = React.useState({ type:'client', id:'cli-bilh' });
  const [expanded,     setExpanded]     = React.useState(new Set(['cli-bilh','prj-bilh-onc']));
  const [addModal,     setAddModal]     = React.useState(null);
  const [query,        setQuery]        = React.useState('');
  const [typeFilter,   setTypeFilter]   = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const searchRef = React.useRef(null);

  const isFiltered = query.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all';

  // Expand tree path to reveal a selected entity
  const expandToEntity = (type, id) => {
    setExpanded(ex => {
      const next = new Set(ex);
      if (type === 'client')   { next.add(id); }
      if (type === 'project')  { const p = DATA.projectById(id);  if(p) { next.add(p.client); next.add(id); } }
      if (type === 'study')    { const s = DATA.studyById(id);    if(s) { const p = DATA.projectById(s.project); if(p) { next.add(p.client); } next.add(s.project); next.add(id); } }
      if (type === 'location') { const l = DATA.locationById(id); if(l) { const s = DATA.studyById(l.study); if(s) { const p = DATA.projectById(s.project); if(p) { next.add(p.client); } next.add(s.project); next.add(s.id); } next.add(id); } }
      return next;
    });
  };

  const handleSelect = (type, id) => {
    setSel({ type, id });
    expandToEntity(type, id);
    // Clear search so tree view returns with selection visible
    if (isFiltered) { setQuery(''); setTypeFilter('all'); setStatusFilter('all'); }
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
          <button className="btn btn-primary btn-sm" onClick={() => setAddModal({ childType:'client', parentType:'org', parentId:'org-vitalief' })}>
            <Icon name="plus" size={14}/> New client
          </button>
        </div>
      }/>
      <div className="content">
        <div style={{ display:'flex', height:'100%' }}>

          {/* ── Tree panel ── */}
          <div style={{ width:272, flex:'none', borderRight:'1px solid var(--line)', background:'var(--surface-2)', display:'flex', flexDirection:'column' }}>

            {/* Search + filters */}
            <div style={{ padding:'10px 10px 10px', borderBottom:'1px solid var(--line)' }}>

              {/* Search input */}
              <div style={{ position:'relative', display:'flex', alignItems:'center', marginBottom:8 }}>
                <Icon name="search" size={13} style={{ position:'absolute', left:9, color:'var(--faint)', pointerEvents:'none', flexShrink:0 }}/>
                <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search clients, projects, studies…"
                  style={{
                    width:'100%', padding:'7px 30px 7px 28px', border:'1px solid var(--line-2)',
                    borderRadius:8, background:'var(--surface)', fontFamily:'var(--sans)',
                    fontSize:12.5, color:'var(--ink)', outline:'none', boxSizing:'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--green-300)'}
                  onBlur={e  => e.target.style.borderColor = 'var(--line-2)'}
                />
                {query && (
                  <button onClick={() => setQuery('')} style={{ position:'absolute', right:7, border:'none', background:'none', cursor:'pointer', color:'var(--faint)', padding:2, display:'flex', alignItems:'center' }}>
                    <Icon name="x" size={12}/>
                  </button>
                )}
              </div>

              {/* Type filter */}
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
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
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
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
                    padding:'3px 7px', border:'none', background:'none', cursor:'pointer',
                    fontFamily:'var(--sans)',
                  }}>Clear</button>
                )}
              </div>
            </div>

            {/* Tree or search results */}
            {isFiltered
              ? <SearchResults query={query} typeFilter={typeFilter} statusFilter={statusFilter} onSelect={handleSelect}/>
              : <HierarchyTree sel={sel} onSelect={handleSelect} expanded={expanded} setExpanded={setExpanded}/>
            }

            <div style={{ padding:'10px 12px', borderTop:'1px solid var(--line)', fontSize:12, color:'var(--faint)' }}>
              {DATA.clients.length} clients · {DATA.projects.length} projects · {DATA.studies.length} studies · {DATA.locations.length} sites
            </div>
          </div>

          {/* ── Detail panel ── */}
          <div style={{ flex:1, overflowY:'auto' }}>
            <div style={{ maxWidth:900, margin:'0 auto', padding:'24px 26px 80px' }}>
              <EntityDetail type={sel.type} id={sel.id} onSelect={handleSelect} onAdd={(ct,pt,pi) => setAddModal({ childType:ct, parentType:pt, parentId:pi })}/>
            </div>
          </div>
        </div>
      </div>

      {addModal && (
        <AddEntityModal childType={addModal.childType} parentType={addModal.parentType} parentId={addModal.parentId} onClose={() => setAddModal(null)}/>
      )}
    </>
  );
}

Object.assign(window, { OrgHierarchy, EntityBadge, HierarchyPath, MetaChip });

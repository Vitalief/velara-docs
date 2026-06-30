/* Root app — role switch (Internal ⇄ Client), internal routing, command palette */

function App() {
  const [role, setRole] = React.useState('internal');
  const [view, setView] = React.useState('registry');
  const [skillId, setSkillId] = React.useState(null);
  const [cmdOpen, setCmdOpen] = React.useState(false);

  React.useEffect(()=>{
    const h = e=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); setCmdOpen(o=>!o); } if(e.key==='Escape') setCmdOpen(false); };
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h);
  },[]);

  const openSkill = (id)=>{ setSkillId(id); setView('skill'); setCmdOpen(false); window.scrollTo(0,0); };
  const goView = (v)=>{ setView(v); setSkillId(null); };

  return (
    <div className="app">
      <div className="rolebar">
        <div className="brand"><VLogo size={22} color="#fff"/> Velara <span style={{fontFamily:'var(--sans)', fontSize:10.5, fontWeight:700, letterSpacing:'.1em', color:'#9fb5ac', alignSelf:'center'}}>A VITALIEF SKILLS PLATFORM</span></div>
        <div className="sep"></div>
        <span className="ctx">{role==='internal'?'internal workspace · velara.vitalief.io':'client portal · bilh.velara.io'}</span>
        <div className="spacer"></div>
        <span style={{fontSize:11, color:'#8fa49b'}}>Viewing as</span>
        <div className="roleswitch">
          <button className={role==='internal'?'on':''} onClick={()=>setRole('internal')}><Icon name="users" size={14}/> Vitalief team</button>
          <button className={role==='client'?'on':''} onClick={()=>setRole('client')}><Icon name="building" size={14}/> Client</button>
        </div>
        <div className="pill"><span className="dot" style={{background:role==='internal'?'#6fd6b8':'#7cc0d8'}}></span>{role==='internal'?'Full methodology access':'Outputs only'}</div>
      </div>

      {role==='internal' ? (
        <InternalShell view={view==='skill'?'registry':view} setView={goView} onSearch={()=>setCmdOpen(true)}>
          {view==='registry' && <Registry onOpen={openSkill}/>}
          {view==='skill' && <SkillDetail id={skillId} onBack={()=>goView('registry')} onOpen={openSkill}/>}
          {view==='run' && <RunConsole/>}
          {view==='validation' && <ValidationQueue onOpen={openSkill}/>}
          {view==='cert' && <Certification onOpen={openSkill}/>}
          {view==='access' && <AccessControl onOpen={openSkill}/>}
          {view==='hierarchy' && <OrgHierarchy/>}
          {view==='analytics' && <Analytics/>}
          {view==='audit' && <AuditLog/>}
        </InternalShell>
      ) : (
        <ClientApp/>
      )}

      {cmdOpen && <CmdPalette onClose={()=>setCmdOpen(false)} onOpen={openSkill} onView={goView}/>}
    </div>
  );
}

function CmdPalette({ onClose, onOpen, onView }) {
  const [q,setQ] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(()=>{ inputRef.current && inputRef.current.focus(); },[]);
  const skills = DATA.skills.filter(s=>!s.isClientVariant && (s.name+s.tags.join()).toLowerCase().includes(q.toLowerCase())).slice(0,6);
  const views = [['registry','Skill Registry','registry'],['cert','Certification','cert'],['validation','Validation Queue','inbox'],['analytics','Usage & Value','chart'],['audit','Audit Log','audit'],['run','Run Console','play']]
    .filter(v=>v[1].toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="overlay" style={{alignItems:'flex-start', justifyContent:'center', paddingTop:'12vh'}} onClick={onClose}>
      <div className="modal" style={{width:'min(580px,92vw)', overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
        <div className="row gap10" style={{padding:'16px 18px', borderBottom:'1px solid var(--line)'}}>
          <Icon name="search" size={18} style={{color:'var(--faint)'}}/>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search skills and views…" style={{border:0, outline:0, flex:1, fontFamily:'var(--sans)', fontSize:15.5, background:'transparent', color:'var(--ink)'}}/>
          <kbd style={{fontFamily:'var(--mono)', fontSize:11, background:'var(--surface-sunk)', border:'1px solid var(--line-2)', borderRadius:4, padding:'2px 6px', color:'var(--muted)'}}>esc</kbd>
        </div>
        <div style={{maxHeight:'46vh', overflowY:'auto', padding:'8px'}}>
          {skills.length>0 && <div style={{fontSize:11, fontWeight:700, letterSpacing:'.06em', color:'var(--faint)', padding:'8px 10px 4px'}}>SKILLS</div>}
          {skills.map(s=>(
            <div key={s.id} className="row gap12" onClick={()=>onOpen(s.id)} style={{padding:'9px 10px', borderRadius:8, cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--surface-sunk)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <Icon name={TYPE_META[s.type].icon} size={16} style={{color:'var(--muted)'}}/>
              <span className="grow" style={{fontSize:13.5, fontWeight:500}}>{s.name}</span>
              <StateBadge state={s.state}/>
            </div>
          ))}
          {views.length>0 && <div style={{fontSize:11, fontWeight:700, letterSpacing:'.06em', color:'var(--faint)', padding:'10px 10px 4px'}}>GO TO</div>}
          {views.map(([id,label,icon])=>(
            <div key={id} className="row gap12" onClick={()=>{onView(id); onClose();}} style={{padding:'9px 10px', borderRadius:8, cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--surface-sunk)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <Icon name={icon} size={16} style={{color:'var(--muted)'}}/>
              <span className="grow" style={{fontSize:13.5, fontWeight:500}}>{label}</span>
              <Icon name="arrowR" size={14} style={{color:'var(--faint)'}}/>
            </div>
          ))}
          {skills.length===0 && views.length===0 && <div className="muted" style={{padding:'24px', textAlign:'center', fontSize:13.5}}>No matches.</div>}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

/* Velara Client Portal — hierarchy-aware: Project → Study → Skills */

function ClientApp() {
  const { useState, useMemo } = React;

  // Client context: Dr. Susan Park @ BILH, project: Oncology Network Startup
  const client   = DATA.people.susan;
  const clientRec= DATA.clientById('cli-bilh');
  const project  = DATA.projectById('prj-bilh-onc');
  const studies  = DATA.studies.filter(s=>s.project==='prj-bilh-onc');

  const [view,    setView]    = useState('dashboard');  // dashboard | studies | deliverables
  const [studyId, setStudyId] = useState(null);         // drill into a study
  const [runSkill,setRunSkill]= useState(null);         // { skill, study }

  const navTo = (v) => { setView(v); setStudyId(null); setRunSkill(null); };

  return (
    <div className="client-scope" style={{display:'flex', flexDirection:'column', flex:1, minHeight:0, background:'var(--paper)'}}>
      {/* top nav */}
      <div className="client-top">
        <div className="brand">
          <VLogo size={24}/>
          <span>Velara</span>
          <span style={{fontFamily:'var(--sans)', fontSize:11, fontWeight:700, letterSpacing:'.08em', color:'var(--muted)', background:'var(--surface-sunk)', padding:'3px 8px', borderRadius:6}}>BY VITALIEF</span>
        </div>
        <div className="client-nav">
          {[['dashboard','Dashboard'],['studies','Studies'],['deliverables','Deliverables']].map(([id,l])=>(
            <div key={id} className={'ci'+(view===id&&!studyId&&!runSkill?' on':'')} onClick={()=>navTo(id)}>{l}</div>
          ))}
        </div>
        <div className="grow"></div>
        {/* project context breadcrumb */}
        <div className="row gap6" style={{fontSize:12, color:'var(--muted)', marginRight:16}}>
          <Icon name="layers" size={13}/>
          <span>{clientRec.name}</span>
          <Icon name="chevron" size={12}/>
          <span style={{fontWeight:600, color:'var(--ink-2)'}}>{project.name}</span>
        </div>
        <div className="row gap10">
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:13, fontWeight:600}}>{client.name}</div>
            <div className="muted" style={{fontSize:11.5}}>{client.role}</div>
          </div>
          <Avatar p={client} size={34}/>
        </div>
      </div>

      {/* content */}
      <div style={{flex:1, overflowY:'auto'}}>
        {runSkill
          ? <ClientRun skill={runSkill.skill} study={runSkill.study} project={project} client={clientRec}
              onBack={()=>setRunSkill(null)}/>
          : studyId
          ? <ClientStudy studyId={studyId} project={project} client={clientRec}
              onRun={(skill,study)=>setRunSkill({skill,study})}
              onBack={()=>setStudyId(null)}/>
          : view==='dashboard'
          ? <ClientDashboard project={project} client={clientRec} studies={studies}
              onStudy={setStudyId} onNav={navTo}/>
          : view==='studies'
          ? <ClientStudiesList studies={studies} project={project}
              onStudy={setStudyId}/>
          : <ClientDeliverables studies={studies}/>}
      </div>
    </div>
  );
}

/* ---- VLogo ---- */
function VLogo({ size=24, color='var(--green-700)' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 4l8 16 8-16" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="9" r="2" fill={color}/>
  </svg>;
}

/* ---- Dashboard ---- */
function ClientDashboard({ project, client: cli, studies, onStudy, onNav }) {
  const allDeliverables = DATA.deliverables.filter(d=>d.projectId===project.id);
  const allSkillCount = studies.reduce((n,s)=>n+DATA.skillsAt('study',s.id).length, 0);
  const activeStudies = studies.filter(s=>s.status==='active');

  return (
    <div className="client-wrap fade-in">
      {/* hero */}
      <div className="hero-banner" style={{marginBottom:28}}>
        <div style={{position:'absolute', right:-60, top:-60, width:240, height:240, borderRadius:'50%', background:'rgba(255,255,255,.05)'}}></div>
        <div style={{fontSize:12, fontWeight:700, letterSpacing:'.1em', opacity:.65, marginBottom:8}}>{cli.name.toUpperCase()} · {project.code}</div>
        <h1 style={{fontSize:28, color:'#fff', marginBottom:8}}>{project.name}</h1>
        <p style={{maxWidth:540, fontSize:14.5, opacity:.85, margin:'0 0 18px', lineHeight:1.5}}>{project.desc}</p>
        <div className="row gap12">
          <div style={{background:'rgba(255,255,255,.12)', borderRadius:10, padding:'10px 16px', textAlign:'center'}}>
            <div style={{fontSize:22, fontWeight:700, color:'#fff'}}>{activeStudies.length}</div>
            <div style={{fontSize:11, opacity:.75, marginTop:2}}>Active studies</div>
          </div>
          <div style={{background:'rgba(255,255,255,.12)', borderRadius:10, padding:'10px 16px', textAlign:'center'}}>
            <div style={{fontSize:22, fontWeight:700, color:'#fff'}}>{allSkillCount}</div>
            <div style={{fontSize:11, opacity:.75, marginTop:2}}>Available skills</div>
          </div>
          <div style={{background:'rgba(255,255,255,.12)', borderRadius:10, padding:'10px 16px', textAlign:'center'}}>
            <div style={{fontSize:22, fontWeight:700, color:'#fff'}}>{allDeliverables.length}</div>
            <div style={{fontSize:11, opacity:.75, marginTop:2}}>Deliverables</div>
          </div>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:22, alignItems:'start'}}>
        {/* studies */}
        <div>
          <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
            <h2 style={{fontSize:19}}>Your studies</h2>
            <button className="btn btn-quiet btn-sm" onClick={()=>onNav('studies')}>View all <Icon name="chevron" size={13}/></button>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {studies.map(s=>(<StudyCard key={s.id} study={s} onOpen={onStudy}/>))}
          </div>
        </div>

        <div style={{display:'flex', flexDirection:'column', gap:16}}>
          {/* recent deliverables */}
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
                    <div style={{fontSize:13.5, fontWeight:500}}>{d.name}</div>
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

/* ---- Study Card ---- */
function StudyCard({ study, onOpen }) {
  const skills = DATA.skillsAt('study', study.id);
  const locs   = DATA.locations.filter(l=>l.study===study.id);
  const statusC = study.status==='active' ? 'var(--st-client-tx)' : 'var(--st-internal-tx)';
  const statusBg = study.status==='active' ? 'var(--st-client-bg)' : 'var(--st-internal-bg)';
  return (
    <div className="card" style={{padding:'16px 18px', cursor:'pointer'}} onClick={()=>onOpen(study.id)}
      onMouseEnter={e=>{ e.currentTarget.style.borderColor='var(--line-strong)'; e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='var(--sh)'; }}
      onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--line)'; e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='var(--sh-sm)'; }}>
      <div className="row gap10" style={{marginBottom:8}}>
        <div style={{flex:1}}>
          <div className="row gap8" style={{marginBottom:5}}>
            <span style={{fontSize:11.5, fontWeight:700, background:statusBg, color:statusC, padding:'2px 8px', borderRadius:999}}>{study.status}</span>
            <span className="tag">{study.phase}</span>
          </div>
          <div style={{fontWeight:700, fontSize:16, fontFamily:'var(--serif)'}}>{study.name}</div>
          <div className="muted" style={{fontSize:12.5, marginTop:2}}>{study.desc}</div>
        </div>
        <Icon name="chevron" size={17} style={{color:'var(--faint)', flex:'none'}}/>
      </div>
      <div className="row gap16" style={{marginTop:10, fontSize:12.5, color:'var(--muted)'}}>
        <span className="row gap6"><Icon name="layers" size={13}/>{skills.length} skill{skills.length!==1?'s':''}</span>
        <span className="row gap6"><Icon name="pin" size={13}/>{locs.length} site{locs.length!==1?'s':''}</span>
        <span className="row gap6"><Icon name="users" size={13}/>{study.sponsor}</span>
      </div>
    </div>
  );
}

/* ---- Studies List ---- */
function ClientStudiesList({ studies, project, onStudy }) {
  return (
    <div className="client-wrap fade-in">
      <div style={{fontSize:12, fontWeight:700, letterSpacing:'.08em', color:'var(--muted)', marginBottom:6}}>{project.code}</div>
      <h1 style={{fontSize:26, marginBottom:16}}>Studies</h1>
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        {studies.map(s=><StudyCard key={s.id} study={s} onOpen={onStudy}/>)}
      </div>
    </div>
  );
}

/* ---- Study Detail ---- */
function ClientStudy({ studyId, project, client, onRun, onBack }) {
  const study = DATA.studyById(studyId);
  const skills = DATA.skillsAt('study', studyId);
  const locs   = DATA.locations.filter(l=>l.study===studyId);
  const delivs = DATA.deliverables.filter(d=>d.studyId===studyId);

  if (!study) return null;
  return (
    <div className="client-wrap fade-in">
      <button className="btn btn-quiet btn-sm" onClick={onBack} style={{marginBottom:18, marginLeft:-8}}>
        <Icon name="arrowR" size={15} style={{transform:'rotate(180deg)'}}/> All studies
      </button>

      {/* study header */}
      <div className="card card-pad" style={{marginBottom:22, background:'linear-gradient(160deg,var(--green-50),var(--surface) 55%)', borderColor:'var(--green-100)'}}>
        <div className="row gap10" style={{marginBottom:8}}>
          <span className="tag">{study.phase}</span>
          <span style={{fontSize:11.5, fontWeight:700, background:study.status==='active'?'var(--st-client-bg)':'var(--st-internal-bg)', color:study.status==='active'?'var(--st-client-tx)':'var(--st-internal-tx)', padding:'2px 8px', borderRadius:999}}>{study.status}</span>
        </div>
        <h1 style={{fontSize:26, marginBottom:6}}>{study.name}</h1>
        <p className="muted" style={{margin:'0 0 14px', fontSize:14.5, lineHeight:1.5}}>{study.desc}</p>
        <div className="row gap20" style={{flexWrap:'wrap', fontSize:13, color:'var(--muted)'}}>
          <span className="row gap6"><Icon name="users" size={14}/>{study.sponsor}</span>
          <span className="row gap6"><Icon name="pin" size={14}/>{locs.length} site{locs.length!==1?'s':''}</span>
          <span className="row gap6"><Icon name="layers" size={14}/>{project.name}</span>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:22, alignItems:'start'}}>
        {/* skill catalog for this study */}
        <div>
          <div className="row" style={{justifyContent:'space-between', marginBottom:12}}>
            <h2 style={{fontSize:19}}>Skills for this study</h2>
            <span className="chip"><Icon name="shield" size={13}/> Outputs only</span>
          </div>
          {skills.length ? (
            <div style={{display:'flex', flexDirection:'column', gap:12}}>
              {skills.map(a=>{
                const s = a.skill;
                return (
                  <div key={a.skillId} className="skill-card" onClick={()=>onRun(s, study)}>
                    <div className="row" style={{justifyContent:'space-between'}}>
                      <div style={{width:40,height:40,borderRadius:10,background:'var(--green-50)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--green-700)'}}>
                        <Icon name={TYPE_META[s.type].icon} size={18}/>
                      </div>
                      <div className="row gap8">
                        <span className="tag">{TYPE_META[s.type].label}</span>
                        <Icon name="arrowR" size={17} style={{color:'var(--faint)'}}/>
                      </div>
                    </div>
                    <div>
                      <div style={{fontWeight:700, fontSize:15.5, fontFamily:'var(--serif)', marginBottom:5}}>{s.name}</div>
                      <p className="muted" style={{fontSize:13.5, margin:0, lineHeight:1.5}}>{s.clientDesc||s.desc}</p>
                    </div>
                    <div className="row gap6" style={{marginTop:'auto', paddingTop:6, flexWrap:'wrap'}}>
                      {(s.outputs.match(/(PDF|PPTX|DOCX|XLSX)/g)||[]).map(f=><span key={f} className="tag">{f}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card card-pad muted" style={{fontSize:14}}>No skills have been granted for this study yet.</div>
          )}
        </div>

        <div style={{display:'flex', flexDirection:'column', gap:16}}>
          {/* sites */}
          <div className="card card-pad">
            <h3 style={{fontSize:15, marginBottom:12}}>Sites <span className="faint mono" style={{fontSize:12}}>· {locs.length}</span></h3>
            {locs.map((l,i)=>(
              <div key={l.id} className="row gap10" style={{padding:'9px 0', borderTop:i?'1px solid var(--line)':'none'}}>
                <span style={{width:28,height:28,borderRadius:7,background:'var(--st-client-bg)',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>
                  <Icon name="pin" size={13} style={{color:'var(--st-client-tx)'}}/>
                </span>
                <div className="grow">
                  <div style={{fontWeight:600, fontSize:13.5}}>{l.name}</div>
                  <div className="muted" style={{fontSize:12}}>{l.city} · {l.pi}</div>
                </div>
                <span style={{fontSize:11, fontWeight:700, background:l.status==='active'?'var(--st-client-bg)':'var(--surface-sunk)', color:l.status==='active'?'var(--st-client-tx)':'var(--muted)', padding:'2px 8px', borderRadius:999}}>{l.status}</span>
              </div>
            ))}
          </div>

          {/* recent deliverables for this study */}
          {delivs.length>0 && (
            <div className="card card-pad">
              <h3 style={{fontSize:15, marginBottom:12}}>Study deliverables <span className="faint mono" style={{fontSize:12}}>· {delivs.length}</span></h3>
              {delivs.map((d,i)=>(
                <div key={d.id} className="row gap10" style={{padding:'9px 0', borderTop:i?'1px solid var(--line)':'none'}}>
                  <Icon name="doc2" size={16} style={{color:'var(--green-600)'}}/>
                  <div className="grow"><div style={{fontSize:13.5, fontWeight:500}}>{d.name}</div><div className="muted" style={{fontSize:11.5}}>{d.at.slice(5,10)}</div></div>
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

/* ---- Run Flow ---- */
function ClientRun({ skill, study, project, client, onBack }) {
  const [phase, setPhase] = React.useState('upload');
  const [file,  setFile]  = React.useState(null);
  const [progress, setProgress] = React.useState(0);
  const timer = React.useRef(null);
  const outFiles = (skill.outputs.match(/(PDF|PPTX|DOCX|XLSX)/g)||['PDF']);

  const run = () => {
    setPhase('running'); setProgress(0); let p=0;
    timer.current = setInterval(()=>{ p+=Math.random()*14+5; if(p>=100){p=100; clearInterval(timer.current); setTimeout(()=>setPhase('done'),400);} setProgress(Math.min(100,p)); },260);
  };
  React.useEffect(()=>()=>clearInterval(timer.current),[]);

  const contextPath = DATA.displayPath('study', study.id);

  return (
    <div className="client-wrap fade-in" style={{maxWidth:800}}>
      <button className="btn btn-quiet btn-sm" onClick={onBack} style={{marginBottom:18, marginLeft:-8}}>
        <Icon name="arrowR" size={15} style={{transform:'rotate(180deg)'}}/> {study.name}
      </button>

      {/* context path */}
      <div className="row gap8" style={{marginBottom:18, padding:'8px 14px', background:'var(--surface)', border:'1px solid var(--line)', borderRadius:9, fontSize:12}}>
        <Icon name="layers" size={13} style={{color:'var(--muted)'}}/>
        <span className="mono" style={{color:'var(--muted)'}}>{contextPath}</span>
      </div>

      <div className="row gap16" style={{marginBottom:22}}>
        <div style={{width:52,height:52,borderRadius:13,background:'var(--green-50)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--green-700)',flex:'none'}}>
          <Icon name={TYPE_META[skill.type].icon} size={24}/>
        </div>
        <div>
          <h1 style={{fontSize:24}}>{skill.name}</h1>
          <p className="muted" style={{margin:'5px 0 0', fontSize:14, maxWidth:520}}>{skill.clientDesc||skill.desc}</p>
        </div>
      </div>

      {phase==='upload' && (
        <div className="card card-pad fade-in">
          <div style={{fontSize:12, fontWeight:700, letterSpacing:'.04em', color:'var(--faint)', marginBottom:8, textTransform:'uppercase'}}>Step 1 · Upload your input</div>
          <div className="muted" style={{fontSize:13.5, marginBottom:14}}>Accepted: {skill.inputs}</div>
          <div className="fileph" style={{height:140, flexDirection:'column', gap:10, cursor:'pointer', background:file?'var(--green-50)':undefined, borderColor:file?'var(--green-300)':undefined}}
            onClick={()=>setFile(f=>f?null:{name:study.code+'_input.xlsx', size:'3.1 MB'})}>
            {file ? <><Icon name="file" size={26} style={{color:'var(--green-600)'}}/><span style={{fontFamily:'var(--sans)', fontWeight:600, color:'var(--green-700)', fontSize:14}}>{file.name}</span><span style={{fontSize:12}}>{file.size} · click to remove</span></>
              : <><Icon name="upload" size={26}/><span style={{fontFamily:'var(--sans)', fontSize:14, color:'var(--muted)'}}>Drag a file here, or click to browse</span><span style={{fontSize:11}}>Up to 100 MB</span></>}
          </div>
          <button className="btn btn-primary btn-lg" disabled={!file} onClick={run}
            style={{marginTop:18, width:'100%', justifyContent:'center', opacity:file?1:.5, cursor:file?'pointer':'not-allowed'}}>
            <Icon name="play" size={16}/> Run skill
          </button>
        </div>
      )}

      {phase==='running' && (
        <div className="card card-pad fade-in" style={{textAlign:'center', padding:'48px 30px'}}>
          <div style={{width:62,height:62,borderRadius:15,background:'var(--green-50)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 18px',color:'var(--green-600)'}}>
            <Icon name="settings" size={28} className="spin"/>
          </div>
          <h2 style={{fontSize:20, marginBottom:8}}>Running {skill.name}…</h2>
          <p className="muted" style={{fontSize:14, marginBottom:22}}>Processing your document securely. Usually under a minute.</p>
          <div className="barwrap" style={{maxWidth:420, margin:'0 auto', height:9}}><div className="bar" style={{width:progress+'%'}}></div></div>
          <div className="mono faint" style={{fontSize:12, marginTop:10}}>{Math.round(progress)}%</div>
        </div>
      )}

      {phase==='done' && (
        <div className="fade-in">
          <div className="card card-pad" style={{background:'linear-gradient(160deg,var(--green-50),var(--surface) 55%)', borderColor:'var(--green-100)', marginBottom:18}}>
            <div className="row gap12">
              <div style={{width:46,height:46,borderRadius:'50%',background:'var(--green-600)',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}><Icon name="check" size={22} style={{color:'#fff'}}/></div>
              <div>
                <h2 style={{fontSize:20}}>Your deliverable is ready</h2>
                <div className="muted" style={{fontSize:13.5, marginTop:2}}>Generated · {study.name} · {new Date().toISOString().slice(0,10)}</div>
              </div>
            </div>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:18}}>
            {outFiles.map(f=>(
              <div key={f} className="card card-pad row gap14" style={{alignItems:'center'}}>
                <div className="fileph" style={{width:42,height:54,flex:'none',background:'var(--surface-2)'}}><span style={{fontSize:9}}>{f}</span></div>
                <div className="grow"><div style={{fontWeight:600, fontSize:14}}>{study.code}_{skill.id.split('-')[0]}</div><div className="mono faint" style={{fontSize:11.5}}>.{f.toLowerCase()} · ready</div></div>
                <button className="btn btn-primary btn-sm"><Icon name="download" size={14}/></button>
              </div>
            ))}
          </div>
          <div className="row gap10">
            <button className="btn btn-ghost" onClick={()=>{setPhase('upload'); setFile(null);}}><Icon name="play" size={14}/> Run again</button>
            <button className="btn btn-quiet" onClick={onBack}>Back to study</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Deliverables (all, grouped by study) ---- */
function ClientDeliverables({ studies }) {
  return (
    <div className="client-wrap fade-in">
      <h1 style={{fontSize:26, marginBottom:6}}>Deliverables</h1>
      <p className="muted" style={{marginTop:0, fontSize:14.5, marginBottom:26}}>Everything Velara has produced for your studies, grouped by study.</p>
      {studies.map(study=>{
        const delivs = DATA.deliverables.filter(d=>d.studyId===study.id);
        if (!delivs.length) return null;
        return (
          <div key={study.id} style={{marginBottom:28}}>
            <div className="row gap8" style={{marginBottom:12}}>
              <span style={{width:28,height:28,borderRadius:7,background:'#ece8f4',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>
                <Icon name="flask" size={13} style={{color:'#5a4a7a'}}/>
              </span>
              <h3 style={{fontSize:16}}>{study.name}</h3>
              <span className="tag">{study.phase}</span>
            </div>
            <div className="card" style={{overflow:'hidden'}}>
              {delivs.map((d,i)=>{
                const skill = DATA.skillById(d.skill);
                return (
                  <div key={d.id} className="row gap14" style={{padding:'15px 18px', borderTop:i?'1px solid var(--line)':'none'}}>
                    <div style={{width:38,height:38,borderRadius:9,background:'var(--green-50)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--green-700)',flex:'none'}}><Icon name="doc2" size={18}/></div>
                    <div className="grow">
                      <div style={{fontWeight:600, fontSize:14.5}}>{d.name}</div>
                      <div className="muted" style={{fontSize:12.5, marginTop:2}}>{skill?.name} · {d.at}</div>
                    </div>
                    <div className="row gap6">{d.files.map(f=><span key={f} className="tag">{f}</span>)}</div>
                    <button className="btn btn-ghost btn-sm"><Icon name="download" size={14}/> Download</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { ClientApp, VLogo, StudyCard, ClientStudy, ClientRun, ClientDeliverables, ClientDashboard, ClientStudiesList });

/* Internal app part 3 — Run Console (hierarchy context), Access Control (hierarchy-scoped) */

const var_r    = 'var(--r)';
const pickerSel = { width:'100%', padding:'9px 12px', border:0, borderTop:'1px solid var(--line)', background:'var(--surface)', fontFamily:'var(--sans)', fontSize:13, color:'var(--ink)', cursor:'pointer', outline:'none' };
const selStyle  = { width:'100%', padding:'9px 11px', borderRadius:9, border:'1px solid var(--line-2)', background:'var(--surface)', fontFamily:'var(--sans)', fontSize:13.5, color:'var(--ink)', cursor:'pointer' };

/* ---------- Hierarchy Context Picker ---------- */
function HierarchyPicker({ value, onChange }) {
  // value = { clientId, projectId, studyId }
  const { clientId, projectId, studyId } = value;
  const clients  = DATA.clients;
  const projects = clientId  ? DATA.projects.filter(p=>p.client===clientId)  : [];
  const selProj  = DATA.projectById(projectId);
  const studies  = projectId && !selProj?.skillsAtProject ? DATA.studies.filter(s=>s.project===projectId) : [];

  const setClient  = id => onChange({ clientId:id,  projectId:'', studyId:'' });
  const setProject = id => onChange({ clientId, projectId:id, studyId:'' });
  const setStudy   = id => onChange({ clientId, projectId, studyId:id });

  const pathParts = [
    clientId  && DATA.clientById(clientId)?.name,
    projectId && DATA.projectById(projectId)?.name,
    studyId   && DATA.studyById(studyId)?.name,
  ].filter(Boolean);

  return (
    <div style={{border:'1px solid var(--line)', borderRadius:var_r, overflow:'hidden'}}>
      {/* breadcrumb trail */}
      {pathParts.length>0 && (
        <div className="row gap8" style={{padding:'8px 14px', background:'var(--green-50)', borderBottom:'1px solid var(--green-100)', fontSize:12.5}}>
          <Icon name="layers" size={13} style={{color:'var(--green-600)'}}/>
          {pathParts.map((p,i)=>(
            <React.Fragment key={i}>
              {i>0 && <Icon name="chevron" size={12} style={{color:'var(--faint)'}}/>}
              <span style={{fontWeight:i===pathParts.length-1?700:500, color:i===pathParts.length-1?'var(--green-800)':'var(--muted)'}}>{p}</span>
            </React.Fragment>
          ))}
        </div>
      )}
      {/* selectors */}
      <div style={{display:'grid', gridTemplateColumns:studies.length?'1fr 1fr 1fr':'1fr 1fr', gap:0}}>
        <PickerStep label="Client" icon="users" required>
          <select value={clientId} onChange={e=>setClient(e.target.value)} style={pickerSel}>
            <option value="">Select client…</option>
            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </PickerStep>
        {clientId && (
          <PickerStep label="Project" icon="layers" border required>
            <select value={projectId} onChange={e=>setProject(e.target.value)} style={pickerSel}>
              <option value="">Select project…</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </PickerStep>
        )}
        {projectId && studies.length>0 && (
          <PickerStep label="Study" icon="flask" border>
            <select value={studyId} onChange={e=>setStudy(e.target.value)} style={pickerSel}>
              <option value="">All studies (project-level)</option>
              {studies.map(s=><option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </PickerStep>
        )}
        {projectId && selProj?.skillsAtProject && (
          <PickerStep label="Study" icon="flask" border>
            <div style={{padding:'9px 12px', fontSize:13, color:'var(--muted)', fontStyle:'italic'}}>
              Skills attached at project level — no study required
            </div>
          </PickerStep>
        )}
      </div>
    </div>
  );
}

function PickerStep({ label, icon, border, children }) {
  return (
    <div style={{borderLeft:border?'1px solid var(--line)':'none'}}>
      <div className="row gap6" style={{padding:'7px 12px 5px', background:'var(--surface-2)', borderBottom:'1px solid var(--line)'}}>
        <Icon name={icon} size={12} style={{color:'var(--muted)'}}/>
        <span style={{fontSize:10.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--faint)'}}>{label}</span>
      </div>
      {children}
    </div>
  );
}

/* ---------- Run Console ---------- */
function RunConsole() {
  const [ctx, setCtx] = React.useState({ clientId:'cli-bilh', projectId:'prj-bilh-onc', studyId:'std-onc204' });
  const [phase, setPhase] = React.useState('idle');
  const [progress, setProgress] = React.useState(0);
  const [file, setFile] = React.useState(null);
  const [surface, setSurface] = React.useState('Web');
  const [selSkill, setSelSkill] = React.useState('');
  const timer = React.useRef(null);

  // available skills = those attached at the selected level
  const availableSkills = React.useMemo(()=>{
    const results = [];
    if (ctx.studyId) results.push(...DATA.skillsAt('study', ctx.studyId));
    if (ctx.projectId && (!ctx.studyId || DATA.projectById(ctx.projectId)?.skillsAtProject))
      results.push(...DATA.skillsAt('project', ctx.projectId));
    return results.filter(a=>a.skill?.state==='client-ready'||a.skill?.state==='internal-ready');
  }, [ctx]);

  const selAssign = availableSkills.find(a=>a.skillId===selSkill);
  const s = selAssign?.skill;

  const contextPath = (() => {
    if (ctx.studyId)   return DATA.displayPath('study',   ctx.studyId);
    if (ctx.projectId) return DATA.displayPath('project', ctx.projectId);
    return '';
  })();

  const start = () => {
    setPhase('running'); setProgress(0); let p=0;
    timer.current = setInterval(()=>{ p+=Math.random()*16+6; if(p>=100){p=100; clearInterval(timer.current); setProgress(100); setTimeout(()=>setPhase('done'),350);} setProgress(Math.min(100,p)); },240);
  };
  React.useEffect(()=>()=>clearInterval(timer.current),[]);
  const reset = ()=>{ setPhase('idle'); setProgress(0); setFile(null); };

  const steps = s ? ['Validating input file','Loading skill v'+s.version,'Executing in sandbox','Generating output','Writing audit entry'] : [];
  const activeStep = steps.length ? Math.min(steps.length-1, Math.floor(progress/(100/steps.length))) : 0;
  const outFiles = s ? (s.outputs.match(/(PDF|PPTX|DOCX|XLSX|CSV)/g)||['PDF']) : [];

  return (
    <>
      <TopBar title="Run Console" actions={<span className="chip"><Icon name="bolt" size={13}/> Sandboxed execution · audited · context-scoped</span>}/>
      <div className="content">
        <div className="wrap fade-in" style={{display:'grid', gridTemplateColumns:'1fr 1.1fr', gap:24, alignItems:'start'}}>
          {/* config */}
          <div style={{display:'flex', flexDirection:'column', gap:16}}>
            <div className="card card-pad">
              <h3 style={{fontSize:15, marginBottom:12}}>Engagement context</h3>
              <HierarchyPicker value={ctx} onChange={c=>{ setCtx(c); setSelSkill(''); reset(); }}/>
            </div>
            {ctx.projectId && (
              <div className="card card-pad">
                <h3 style={{fontSize:15, marginBottom:12}}>Skill</h3>
                {availableSkills.length ? (
                  <>
                    <select value={selSkill} onChange={e=>{ setSelSkill(e.target.value); reset(); }} style={{...selStyle, marginBottom:10}}>
                      <option value="">— select a skill —</option>
                      {availableSkills.map(a=>(
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
            {s && (
              <div className="card card-pad">
                <h3 style={{fontSize:15, marginBottom:10}}>Input · <span className="muted" style={{fontFamily:'var(--sans)', fontSize:13}}>{s.inputs}</span></h3>
                <div className="fileph" style={{height:90, flexDirection:'column', gap:8, cursor:'pointer', background:file?'var(--green-50)':undefined, borderColor:file?'var(--green-300)':undefined}}
                  onClick={()=>setFile(f=>f?null:{name:s.id+'_input.xlsx', size:'2.4 MB'})}>
                  {file ? <><Icon name="file" size={20} style={{color:'var(--green-600)'}}/><span style={{color:'var(--green-700)', fontFamily:'var(--sans)', fontWeight:600, fontSize:13}}>{file.name}</span><span style={{fontSize:11}}>{file.size} · click to remove</span></>
                    : <><Icon name="upload" size={20}/><span style={{fontFamily:'var(--sans)', fontSize:13, color:'var(--muted)'}}>Drop file or click to attach</span></>}
                </div>
                <div className="row gap8" style={{marginTop:12, flexWrap:'wrap'}}>
                  {['Web','Claude','API','Client Portal'].map(x=>(
                    <button key={x} onClick={()=>setSurface(x)} className="btn btn-sm" style={{background:surface===x?'var(--green-50)':'var(--surface)', color:surface===x?'var(--green-800)':'var(--ink-2)', border:'1px solid '+(surface===x?'var(--green-300)':'var(--line-2)')}}>{x}</button>
                  ))}
                </div>
                <button className="btn btn-primary btn-lg" disabled={!file||phase==='running'} onClick={start}
                  style={{width:'100%', justifyContent:'center', marginTop:14, opacity:(!file||phase==='running')?.5:1}}>
                  {phase==='running'?<><Icon name="settings" size={15} className="spin"/> Running…</>:<><Icon name="play" size={15}/> Invoke skill</>}
                </button>
              </div>
            )}
          </div>

          {/* result */}
          <div className="card card-pad" style={{minHeight:340}}>
            {phase==='idle' && !s && (
              <div style={{textAlign:'center', padding:'60px 20px', color:'var(--faint)'}}>
                <div style={{width:52,height:52,borderRadius:12,background:'var(--surface-sunk)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}><Icon name="bolt" size={24}/></div>
                <div style={{fontSize:14, color:'var(--muted)'}}>Select an engagement context and skill to begin</div>
              </div>
            )}
            {phase==='idle' && s && (
              <div>
                <h3 style={{fontSize:15, marginBottom:10}}>Ready to run</h3>
                <div style={{padding:'12px 14px', borderRadius:9, background:'var(--surface-sunk)', fontSize:13, color:'var(--ink-2)', marginBottom:12}} className="row gap8">
                  <Icon name="layers" size={14} style={{color:'var(--muted)'}}/>
                  <span className="mono">{contextPath}</span>
                </div>
                <div style={{fontSize:13.5}}><b>{s.name}</b></div>
                <div className="muted" style={{fontSize:13, marginTop:4, lineHeight:1.45}}>{s.desc}</div>
                <div style={{marginTop:12, fontSize:12.5, color:'var(--muted)'}}>Attach a file above to invoke.</div>
              </div>
            )}
            {phase!=='idle' && s && (
              <div>
                <div className="row" style={{justifyContent:'space-between', marginBottom:14}}>
                  <h3 style={{fontSize:16}}>{phase==='done'?'Run complete':'Executing'}</h3>
                  <span className="mono faint" style={{fontSize:12}}>inv-{Math.floor(9013+Math.random()*40)}</span>
                </div>
                <div className="barwrap" style={{height:8, marginBottom:18}}><div className="bar" style={{width:progress+'%'}}></div></div>
                {steps.map((st,i)=>{ const state=phase==='done'||i<activeStep?'done':i===activeStep?'active':'pend'; return (
                  <div key={i} className="row gap10" style={{padding:'7px 0', fontSize:13, opacity:state==='pend'?.4:1}}>
                    <span className="cb" style={{width:18,height:18,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center',flex:'none',background:state==='done'?'var(--green-600)':state==='active'?'var(--green-100)':'var(--surface-sunk)',color:state==='done'?'#fff':'var(--green-700)'}}>
                      {state==='done'?<Icon name="check" size={11}/>:state==='active'?<Icon name="settings" size={11} className="spin"/>:null}
                    </span>
                    <span>{st}</span>
                  </div>
                );})}
                {phase==='done' && (
                  <div className="fade-in" style={{marginTop:18, paddingTop:16, borderTop:'1px solid var(--line)'}}>
                    <div style={{fontSize:12, fontWeight:700, letterSpacing:'.04em', color:'var(--faint)', marginBottom:10}}>GENERATED OUTPUTS</div>
                    <div className="row gap10" style={{flexWrap:'wrap', marginBottom:16}}>
                      {outFiles.map(f=>(
                        <div key={f} className="row gap10" style={{border:'1px solid var(--line-2)', borderRadius:9, padding:'10px 14px', background:'var(--surface-2)'}}>
                          <Icon name="doc2" size={18} style={{color:'var(--green-600)'}}/>
                          <div><div style={{fontWeight:600, fontSize:13}}>{s.id.split('-').slice(0,2).join('_')}.{f.toLowerCase()}</div><div className="mono faint" style={{fontSize:11}}>{f} · Vitalief brand</div></div>
                          <button className="btn btn-quiet btn-sm"><Icon name="download" size={14}/></button>
                        </div>
                      ))}
                    </div>
                    <div className="row gap10" style={{padding:'10px 14px', borderRadius:9, background:'var(--surface-sunk)', fontSize:12.5}}>
                      <Icon name="audit" size={15} style={{color:'var(--muted)'}}/>
                      <div className="grow">
                        <div className="muted">Audit entry stamped</div>
                        <div className="mono" style={{fontSize:10.5, color:'var(--faint)', marginTop:2}}>{contextPath}</div>
                      </div>
                      <span className="badge badge-state-client"><Icon name="check" size={11}/> success</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{marginTop:14}} onClick={reset}><Icon name="play" size={13}/> Run again</button>
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

/* ---------- Access Control (hierarchy-scoped skill matrix) ---------- */
function AccessControl({ onOpen }) {
  const [selClient, setSelClient] = React.useState('cli-bilh');
  const cli = DATA.clientById(selClient);
  const projects = DATA.projects.filter(p=>p.client===selClient);

  return (
    <>
      <TopBar title="Access Control" actions={<span className="chip"><Icon name="shield" size={13}/> Scoped to Client → Project → Study</span>}/>
      <div className="content">
        <div className="wrap-wide fade-in">
          <p className="muted" style={{fontSize:14, marginTop:0, marginBottom:18, maxWidth:720}}>
            Skills are attached at specific levels in the engagement structure. Clients receive outputs only — never instructions, code, or methodology.
            The full path is stamped on every invocation record for audit.
          </p>

          {/* client selector tabs */}
          <div className="row gap8" style={{marginBottom:22, flexWrap:'wrap'}}>
            {DATA.clients.map(c=>(
              <button key={c.id} onClick={()=>setSelClient(c.id)} className="btn" style={{
                background:selClient===c.id?'var(--green-800)':'var(--surface)', color:selClient===c.id?'#fff':'var(--ink-2)',
                border:'1px solid '+(selClient===c.id?'var(--green-800)':'var(--line-2)'),
                opacity:c.active===false?.6:1,
              }}>
                <Icon name="users" size={14}/> {c.name} {c.active===false&&<span style={{fontSize:10, opacity:.7}}>(paused)</span>}
              </button>
            ))}
          </div>

          {cli && projects.map(proj=>{
            const projSkills = DATA.skillsAt('project', proj.id);
            const studiesList = DATA.studies.filter(s=>s.project===proj.id);

            return (
              <div key={proj.id} className="card" style={{overflow:'hidden', marginBottom:20}}>
                {/* project header */}
                <div className="row gap12" style={{padding:'14px 18px', borderBottom:'1px solid var(--line)', background:'var(--surface-2)'}}>
                  <div style={{width:34,height:34,borderRadius:8,background:'#f0e8da',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>
                    <Icon name="layers" size={17} style={{color:'#7a5c33'}}/>
                  </div>
                  <div className="grow">
                    <div style={{fontWeight:700, fontSize:15}}>{proj.name}</div>
                    <div className="mono faint" style={{fontSize:11}}>{proj.code} · lead {DATA.people[proj.lead]?.name}</div>
                  </div>
                  <span style={{fontSize:12, color:'var(--muted)'}}>{proj.skillsAtProject?'Skills at project level':'Skills at study level'}</span>
                  <button className="btn btn-ghost btn-sm" onClick={()=>{}}><Icon name="plus" size={13}/> Attach skill</button>
                </div>

                {/* project-level skills */}
                {projSkills.length>0 && (
                  <div style={{padding:'12px 18px', borderBottom:studiesList.length?'1px solid var(--line)':'none'}}>
                    <div style={{fontSize:11, fontWeight:700, letterSpacing:'.05em', color:'var(--faint)', marginBottom:8, textTransform:'uppercase'}}>Project-level skills</div>
                    <div className="row gap8" style={{flexWrap:'wrap'}}>
                      {projSkills.map(a=>(
                        <div key={a.skillId} className="row gap8" onClick={()=>onOpen(a.skillId)}
                          style={{border:'1px solid var(--line)', borderRadius:9, padding:'8px 12px', cursor:'pointer', background:'var(--surface)'}}
                          onMouseEnter={e=>e.currentTarget.style.borderColor='var(--line-strong)'}
                          onMouseLeave={e=>e.currentTarget.style.borderColor='var(--line)'}>
                          <Icon name={TYPE_META[a.skill.type].icon} size={14} style={{color:'var(--muted)'}}/>
                          <span style={{fontSize:13, fontWeight:600}}>{a.skill.name}</span>
                          <StateBadge state={a.skill.state}/>
                          {a.skill.visibility!=='internal-only'
                            ? <span className="badge badge-state-client" style={{fontSize:10.5}}><Icon name="eye" size={10}/> Outputs</span>
                            : <span className="badge badge-state-draft" style={{fontSize:10.5}}><Icon name="lock" size={10}/> Internal</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* study-level skills */}
                {studiesList.map(st=>{
                  const stSkills = DATA.skillsAt('study', st.id);
                  return (
                    <div key={st.id} style={{padding:'12px 18px', borderTop:'1px solid var(--line)'}}>
                      <div className="row gap10" style={{marginBottom:8}}>
                        <span style={{width:24,height:24,borderRadius:6,background:'#ece8f4',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>
                          <Icon name="flask" size={12} style={{color:'#5a4a7a'}}/>
                        </span>
                        <span style={{fontWeight:700, fontSize:13.5}}>{st.name}</span>
                        <span className="mono faint" style={{fontSize:11}}>{st.code}</span>
                        <span style={{fontSize:11, fontWeight:700, background:st.status==='active'?'var(--st-client-bg)':'var(--st-internal-bg)', color:st.status==='active'?'var(--st-client-tx)':'var(--st-internal-tx)', padding:'2px 8px', borderRadius:999}}>{st.status}</span>
                        <div className="grow"></div>
                        <button className="btn btn-quiet btn-sm" onClick={()=>{}}><Icon name="plus" size={12}/> Attach</button>
                      </div>
                      {stSkills.length ? (
                        <div className="row gap8" style={{flexWrap:'wrap', paddingLeft:34}}>
                          {stSkills.map(a=>(
                            <div key={a.skillId} className="row gap8" onClick={()=>onOpen(a.skillId)}
                              style={{border:'1px solid var(--line)', borderRadius:9, padding:'7px 11px', cursor:'pointer', background:'var(--surface)'}}
                              onMouseEnter={e=>e.currentTarget.style.borderColor='var(--line-strong)'}
                              onMouseLeave={e=>e.currentTarget.style.borderColor='var(--line)'}>
                              <Icon name={TYPE_META[a.skill.type].icon} size={13} style={{color:'var(--muted)'}}/>
                              <span style={{fontSize:12.5, fontWeight:600}}>{a.skill.name}</span>
                              <StateBadge state={a.skill.state}/>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted" style={{fontSize:13, paddingLeft:34}}>No skills attached to this study yet.</div>
                      )}
                    </div>
                  );
                })}
                {projSkills.length===0 && studiesList.length===0 && (
                  <div className="muted" style={{padding:'16px 18px', fontSize:13}}>No skills attached to this project yet.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return <div style={{marginBottom:16}}>
    <div style={{fontSize:11.5, fontWeight:700, letterSpacing:'.04em', textTransform:'uppercase', color:'var(--faint)', marginBottom:7}}>{label}</div>
    {children}
  </div>;
}

function SectionTitle({ icon, title, sub }) {
  return <div style={{marginBottom:10}}>
    <div className="row gap8"><Icon name={icon} size={16} style={{color:'var(--green-600)'}}/><h3 style={{fontSize:15.5}}>{title}</h3></div>
    {sub && <div className="muted" style={{fontSize:12.5, marginTop:3, marginLeft:24}}>{sub}</div>}
  </div>;
}

function Toggle({ on }) {
  const [v,setV] = React.useState(on);
  return <button onClick={(e)=>{e.stopPropagation(); setV(!v);}} style={{width:38, height:22, borderRadius:999, border:0, cursor:'pointer', padding:2,
    background:v?'var(--green-600)':'var(--line-strong)', transition:'background .18s', display:'flex', justifyContent:v?'flex-end':'flex-start'}}>
    <span style={{width:18, height:18, borderRadius:'50%', background:'#fff', display:'block', boxShadow:'0 1px 2px rgba(0,0,0,.25)', transition:'all .18s'}}></span>
  </button>;
}

Object.assign(window, { RunConsole, AccessControl, HierarchyPicker, Field, SectionTitle, Toggle });

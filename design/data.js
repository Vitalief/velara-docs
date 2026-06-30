/* Velara — A Vitalief Skills Platform · seed data (window.DATA) */
(function () {
  const people = {
    matt:   { id:'matt',  name:'Matthew Maxwell', short:'Matt',  role:'Chief Innovation Officer · Vitalief', org:'vitalief', color:'#1c4b40', init:'MM' },
    priya:  { id:'priya', name:'Priya Nair',      short:'Priya', role:'Lead Engineer · MA Technologies', org:'matech', color:'#3d5a8a', init:'PN' },
    dana:   { id:'dana',  name:'Dana Reyes',      short:'Dana',  role:'Principal Consultant · Vitalief', org:'vitalief', color:'#7a5c33', init:'DR' },
    tomas:  { id:'tomas', name:'Tomás Oliveira',  short:'Tomás', role:'Consultant · Vitalief', org:'vitalief', color:'#5a4a7a', init:'TO' },
    karen:  { id:'karen', name:'Karen Whitfield', short:'Karen', role:'Engagement Lead · Vitalief', org:'vitalief', color:'#8a4a5a', init:'KW' },
    susan:  { id:'susan', name:'Dr. Susan Park',  short:'Susan', role:'VP Clinical Research · BILH', org:'client', color:'#3a6a6a', init:'SP' },
  };

  const engagements = [
    { id:'eng-bilh', name:'BILH — Oncology Network Startup', client:'Beth Israel Lahey Health', code:'BILH-ONC', lead:'karen', active:true },
    { id:'eng-mci',  name:'Memorial Cancer Institute — CTMS Migration', client:'Memorial Cancer Institute', code:'MCI-CTMS', lead:'dana', active:true },
    { id:'eng-atlas',name:'Atlas Research Partners — Portfolio Feasibility', client:'Atlas Research Partners', code:'ATLAS-FEAS', lead:'karen', active:true },
    { id:'eng-north',name:'Northshore — Monitoring Optimization', client:'Northshore Health System', code:'NS-MON', lead:'tomas', active:false },
  ];

  // cert criteria templates
  const techCrit = [
    'Skill runs without error on representative inputs',
    'Handles edge cases and adversarial inputs gracefully',
    'Code passes static review (style, structure, no dead paths)',
    'Respects security & access-control boundaries',
    'Outputs match declared output schema',
  ];
  const methodCrit = [
    'Produces Vitalief-grade output quality',
    'Aligns with established Vitalief methodology',
    'Voice and style match Vitalief standards',
    'No proprietary methodology leaks to client surface',
  ];

  function cert(done, by, date, crit) {
    return { status: done===crit.length ? 'certified' : (done>0?'in-review':'not-started'),
             by, date, criteria: crit.map((c,i)=>({ label:c, done: i<done })) };
  }

  // SKILLS
  const skills = [
    {
      id:'site-activation-risk', name:'Site Activation Risk Assessment',
      type:'hybrid', visibility:'paired', state:'client-ready', version:'3.2.0', owner:'matt',
      desc:'Scores site activation risk across regulatory, contracting, staffing, and IRB dimensions, then produces a ranked mitigation plan.',
      clientDesc:'Generates a structured site activation risk report with a ranked mitigation plan from your site startup data.',
      tags:['site startup','risk','feasibility'], created:'2025-09-12', modified:'2026-05-21',
      runtime:'LLM orchestration + Python scoring helpers', inputs:'Site list (XLSX), contract status (PDF/DOCX)', outputs:'Risk report (PDF), scored matrix (XLSX)',
      runs:412, lastRun:'2026-05-28', clientFacing:true, engagements:['eng-bilh','eng-atlas'],
      tech: cert(5,'priya','2026-05-18',techCrit), method: cert(4,'matt','2026-05-20',methodCrit),
      lineageChildId:'site-activation-risk-c',
      versions:[
        {v:'3.2.0', date:'2026-05-21', author:'matt', type:'minor', note:'Added IRB turnaround dimension; recert complete', recert:'certified'},
        {v:'3.1.2', date:'2026-04-30', author:'priya', type:'patch', note:'Fixed XLSX parser on merged header cells', recert:'certified'},
        {v:'3.0.0', date:'2026-03-15', author:'matt', type:'major', note:'New scoring schema (breaking)', recert:'certified'},
        {v:'2.4.0', date:'2026-01-22', author:'matt', type:'minor', note:'Contracting sub-scores', recert:'certified'},
      ],
    },
    {
      id:'site-activation-risk-c', name:'Site Activation Risk Report', isClientVariant:true, parentId:'site-activation-risk',
      type:'hybrid', visibility:'client-facing', state:'client-ready', version:'3.2.0', owner:'priya',
      desc:'Client-facing derivative. Methodology scoring weights removed from output; produces report and matrix only.',
      clientDesc:'Generates a structured site activation risk report with a ranked mitigation plan from your site startup data.',
      tags:['site startup','risk'], created:'2025-09-20', modified:'2026-05-21',
      runtime:'LLM orchestration + Python scoring helpers', inputs:'Site list (XLSX)', outputs:'Risk report (PDF), scored matrix (XLSX)',
      runs:188, lastRun:'2026-05-27', clientFacing:true, engagements:['eng-bilh'],
      tech: cert(5,'priya','2026-05-19',techCrit), method: cert(4,'matt','2026-05-21',methodCrit),
    },
    {
      id:'protocol-feasibility', name:'Protocol Feasibility Scorecard',
      type:'prompt', visibility:'internal-only', state:'internal-ready', version:'2.1.0', owner:'matt',
      desc:'Encodes Vitalief feasibility methodology: scores a protocol against operational complexity, enrollment realism, and competitive landscape.',
      tags:['feasibility','protocol','methodology'], created:'2025-08-02', modified:'2026-05-10',
      runtime:'Prompt-based (instructions + reference frameworks)', inputs:'Protocol synopsis (PDF/DOCX)', outputs:'Feasibility scorecard (DOCX)',
      runs:301, lastRun:'2026-05-26', clientFacing:false, engagements:['eng-atlas','eng-mci'],
      tech: cert(5,'priya','2026-05-08',techCrit), method: cert(4,'matt','2026-05-10',methodCrit),
    },
    {
      id:'governance-memo', name:'Governance Memo Generator',
      type:'prompt', visibility:'paired', state:'client-ready', version:'4.0.1', owner:'matt',
      desc:'Drafts research governance memos in Vitalief house voice across committee charters, escalation paths, and decision rights.',
      clientDesc:'Drafts a research governance memo from your committee structure and decision-rights inputs.',
      tags:['governance','memo','writing'], created:'2025-06-18', modified:'2026-05-24',
      runtime:'Prompt-based (instructions + Vitalief style filter)', inputs:'Governance brief (DOCX)', outputs:'Governance memo (DOCX, PDF)',
      runs:524, lastRun:'2026-05-28', clientFacing:true, engagements:['eng-bilh','eng-mci'],
      tech: cert(5,'priya','2026-05-22',techCrit), method: cert(4,'matt','2026-05-24',methodCrit),
      lineageChildId:'governance-memo-c',
      versions:[
        {v:'4.0.1', date:'2026-05-24', author:'priya', type:'patch', note:'Footer brand spacing', recert:'certified'},
        {v:'4.0.0', date:'2026-05-02', author:'matt', type:'major', note:'Restructured decision-rights section', recert:'certified'},
        {v:'3.3.0', date:'2026-03-08', author:'matt', type:'minor', note:'Escalation path templates', recert:'certified'},
      ],
    },
    {
      id:'governance-memo-c', name:'Governance Memo', isClientVariant:true, parentId:'governance-memo',
      type:'prompt', visibility:'client-facing', state:'client-ready', version:'4.0.1', owner:'priya',
      desc:'Client-facing derivative of Governance Memo Generator. House-voice frameworks sanitized from instructions.',
      clientDesc:'Drafts a research governance memo from your committee structure and decision-rights inputs.',
      tags:['governance','memo'], created:'2025-07-01', modified:'2026-05-24',
      runtime:'Prompt-based', inputs:'Governance brief (DOCX)', outputs:'Governance memo (DOCX, PDF)',
      runs:206, lastRun:'2026-05-28', clientFacing:true, engagements:['eng-bilh','eng-mci'],
      tech: cert(5,'priya','2026-05-23',techCrit), method: cert(4,'matt','2026-05-24',methodCrit),
    },
    {
      id:'enrollment-forecast', name:'Enrollment Forecast Model',
      type:'code', visibility:'paired', state:'client-ready', version:'2.0.0', owner:'priya',
      desc:'Monte-Carlo enrollment projection from historical site accrual; outputs P10/P50/P90 timelines and a sensitivity table.',
      clientDesc:'Projects study enrollment timelines (P10/P50/P90) from your historical site accrual data.',
      tags:['enrollment','forecast','model'], created:'2025-10-04', modified:'2026-05-12',
      runtime:'Python (numpy, simulation)', inputs:'Historical accrual (XLSX)', outputs:'Forecast deck (PPTX), sensitivity table (XLSX)',
      runs:267, lastRun:'2026-05-27', clientFacing:true, engagements:['eng-atlas','eng-bilh'],
      tech: cert(5,'priya','2026-05-11',techCrit), method: cert(4,'matt','2026-05-12',methodCrit),
      lineageChildId:'enrollment-forecast-c',
    },
    {
      id:'enrollment-forecast-c', name:'Enrollment Forecast', isClientVariant:true, parentId:'enrollment-forecast',
      type:'code', visibility:'client-facing', state:'client-ready', version:'2.0.0', owner:'priya',
      desc:'Client-facing forecast. Model internals and Vitalief assumption library not exposed.',
      clientDesc:'Projects study enrollment timelines (P10/P50/P90) from your historical site accrual data.',
      tags:['enrollment','forecast'], created:'2025-10-12', modified:'2026-05-12',
      runtime:'Python', inputs:'Historical accrual (XLSX)', outputs:'Forecast deck (PPTX), sensitivity table (XLSX)',
      runs:142, lastRun:'2026-05-26', clientFacing:true, engagements:['eng-atlas','eng-bilh'],
      tech: cert(5,'priya','2026-05-11',techCrit), method: cert(4,'matt','2026-05-12',methodCrit),
    },
    {
      id:'ctms-extract', name:'CTMS Data Extract & Normalize',
      type:'code', visibility:'client-facing', state:'client-ready', version:'1.4.0', owner:'priya',
      desc:'Parses CTMS export, normalizes site/visit/subject fields to a canonical schema, flags integrity issues.',
      clientDesc:'Cleans and normalizes a CTMS export into a canonical schema and flags data integrity issues.',
      tags:['ctms','data','extraction'], created:'2025-11-20', modified:'2026-05-06',
      runtime:'Python (pandas)', inputs:'CTMS export (XLSX/CSV)', outputs:'Normalized dataset (XLSX), issues log (PDF)',
      runs:331, lastRun:'2026-05-28', clientFacing:true, engagements:['eng-mci'],
      tech: cert(5,'priya','2026-05-05',techCrit), method: cert(4,'matt','2026-05-06',methodCrit),
    },
    {
      id:'competitive-brief', name:'Competitive Positioning Brief',
      type:'prompt', visibility:'internal-only', state:'internal-ready', version:'1.2.0', owner:'matt',
      desc:'Internal-only. Generates positioning against Huron and Manet for a given opportunity, with win-theme language.',
      tags:['competitive','sales','internal'], created:'2025-12-01', modified:'2026-04-18',
      runtime:'Prompt-based (competitive intel reference)', inputs:'Opportunity brief (DOCX)', outputs:'Positioning brief (DOCX)',
      runs:88, lastRun:'2026-05-19', clientFacing:false, engagements:['eng-atlas'],
      tech: cert(5,'priya','2026-04-16',techCrit), method: cert(4,'matt','2026-04-18',methodCrit),
    },
    {
      id:'style-filter', name:'Vitalief Style Filter',
      type:'prompt', visibility:'internal-only', state:'internal-ready', version:'5.1.0', owner:'matt',
      desc:'Internal-only. Rewrites any draft into Vitalief house voice — cadence, hedging discipline, terminology.',
      tags:['writing','style','internal','utility'], created:'2025-05-10', modified:'2026-05-15',
      runtime:'Prompt-based', inputs:'Draft text (DOCX/PDF)', outputs:'Restyled draft (DOCX)',
      runs:903, lastRun:'2026-05-28', clientFacing:false, engagements:['eng-bilh','eng-mci','eng-atlas'],
      tech: cert(5,'priya','2026-05-14',techCrit), method: cert(4,'matt','2026-05-15',methodCrit),
    },
    {
      id:'startup-timeline', name:'Study Startup Timeline Builder',
      type:'hybrid', visibility:'paired', state:'client-ready', version:'2.3.0', owner:'matt',
      desc:'Builds a critical-path study startup timeline from milestones and dependencies; outputs Gantt and narrative.',
      clientDesc:'Builds a critical-path study startup timeline with a Gantt chart and narrative from your milestones.',
      tags:['timeline','startup','planning'], created:'2025-09-30', modified:'2026-05-09',
      runtime:'LLM orchestration + scheduling helper', inputs:'Milestone list (XLSX)', outputs:'Timeline (PPTX), narrative (DOCX)',
      runs:178, lastRun:'2026-05-25', clientFacing:true, engagements:['eng-bilh'],
      tech: cert(5,'priya','2026-05-07',techCrit), method: cert(4,'matt','2026-05-09',methodCrit),
      lineageChildId:null,
    },
    {
      id:'mvr-summarizer', name:'Monitoring Visit Report Summarizer',
      type:'hybrid', visibility:'client-facing', state:'client-ready', version:'1.1.0', owner:'priya',
      desc:'Summarizes monitoring visit reports into action items, findings by severity, and an executive rollup.',
      clientDesc:'Summarizes monitoring visit reports into prioritized action items and an executive rollup.',
      tags:['monitoring','summary'], created:'2026-01-15', modified:'2026-04-28',
      runtime:'LLM orchestration', inputs:'MVR documents (PDF)', outputs:'Action summary (DOCX), findings table (XLSX)',
      runs:96, lastRun:'2026-05-24', clientFacing:true, engagements:['eng-north'],
      tech: cert(5,'priya','2026-04-26',techCrit), method: cert(4,'matt','2026-04-28',methodCrit),
    },
    {
      id:'budget-logic', name:'Budget & Pricing Logic Helper',
      type:'code', visibility:'internal-only', state:'internal-ready', version:'1.0.3', owner:'priya',
      desc:'Internal-only. Applies Vitalief pricing logic to an engagement scope; returns rate-card-based estimate ranges.',
      tags:['pricing','internal','utility'], created:'2026-02-10', modified:'2026-05-02',
      runtime:'Python', inputs:'Scope sheet (XLSX)', outputs:'Estimate range (XLSX)',
      runs:64, lastRun:'2026-05-20', clientFacing:false, engagements:[],
      tech: cert(5,'priya','2026-05-01',techCrit), method: cert(4,'matt','2026-05-02',methodCrit),
    },
    // --- In the certification pipeline ---
    {
      id:'icf-readability', name:'Informed Consent Readability Auditor',
      type:'hybrid', visibility:'paired', state:'draft', version:'0.9.0', owner:'matt',
      desc:'Audits informed consent forms for reading grade level, jargon density, and required-element coverage; suggests plain-language rewrites.',
      clientDesc:'Audits an informed consent form for readability and required-element coverage and suggests plain-language edits.',
      tags:['consent','readability','quality'], created:'2026-04-22', modified:'2026-05-27',
      runtime:'LLM orchestration + readability scoring', inputs:'ICF document (PDF/DOCX)', outputs:'Audit report (PDF), redline (DOCX)',
      runs:11, lastRun:'2026-05-27', clientFacing:true, engagements:[], inQueue:true, submitted:'2026-05-26', submittedBy:'matt',
      tech: cert(3,'priya','2026-05-27',techCrit), method: cert(0,null,null,methodCrit),
    },
    {
      id:'deviation-trend', name:'Protocol Deviation Trend Analyzer',
      type:'code', visibility:'paired', state:'draft', version:'1.0.0', owner:'priya',
      desc:'Clusters protocol deviations by category and site, surfaces emerging trends, and ranks corrective-action priorities.',
      clientDesc:'Analyzes protocol deviation logs to surface trends by site and category with prioritized corrective actions.',
      tags:['deviations','quality','trend'], created:'2026-05-01', modified:'2026-05-28',
      runtime:'Python (clustering)', inputs:'Deviation log (XLSX)', outputs:'Trend report (PDF), priority table (XLSX)',
      runs:7, lastRun:'2026-05-28', clientFacing:true, engagements:[], inQueue:true, submitted:'2026-05-28', submittedBy:'priya',
      tech: cert(5,'priya','2026-05-28',techCrit), method: cert(2,'matt','2026-05-28',methodCrit),
    },
    {
      id:'reg-checklist', name:'Regulatory Submission Checklist',
      type:'prompt', visibility:'paired', state:'internal-ready', version:'1.0.0', owner:'matt',
      desc:'Generates an IND/IDE submission readiness checklist tailored to study phase and modality.',
      clientDesc:'Generates a regulatory submission readiness checklist tailored to your study phase and modality.',
      tags:['regulatory','submission','checklist'], created:'2026-03-19', modified:'2026-05-23',
      runtime:'Prompt-based', inputs:'Study profile (DOCX)', outputs:'Readiness checklist (XLSX, PDF)',
      runs:43, lastRun:'2026-05-22', clientFacing:true, engagements:['eng-atlas'], inQueue:true, submitted:'2026-05-23', submittedBy:'matt',
      tech: cert(2,'priya','2026-05-24',techCrit), method: cert(4,'matt','2026-05-23',methodCrit),
    },
    // --- Retired ---
    {
      id:'legacy-feasibility', name:'Feasibility Scorecard (legacy)',
      type:'prompt', visibility:'internal-only', state:'retired', version:'1.4.0', owner:'matt',
      desc:'Superseded by Protocol Feasibility Scorecard 2.x. Retained for audit; cannot be invoked.',
      tags:['feasibility','legacy'], created:'2025-04-01', modified:'2025-08-02',
      runtime:'Prompt-based', inputs:'Protocol synopsis (PDF)', outputs:'Scorecard (DOCX)',
      runs:0, lastRun:'2025-08-01', clientFacing:false, engagements:[],
      tech: cert(5,'priya','2025-07-20',techCrit), method: cert(4,'matt','2025-07-25',methodCrit),
      retiredDate:'2025-08-02', supersededBy:'protocol-feasibility',
    },
  ];

  // Usage time series (last 12 weeks invocations)
  const weeks = ['Mar 09','Mar 16','Mar 23','Mar 30','Apr 06','Apr 13','Apr 20','Apr 27','May 04','May 11','May 18','May 25'];
  const usageSeries = [128,142,131,165,158,181,176,203,219,241,266,288];

  const usageByProject = [
    { projectId:'prj-bilh-onc',   label:'BILH — Oncology Network', invocations:842, hours:631, color:'#1c4b40' },
    { projectId:'prj-mci-ctms',   label:'MCI — CTMS Migration',    invocations:611, hours:402, color:'#246152' },
    { projectId:'prj-atlas-feas', label:'Atlas — Portfolio Feasibility', invocations:498, hours:357, color:'#5a4a7a' },
    { projectId:'prj-ns-mon',     label:'Northshore — Monitoring', invocations:214, hours:140, color:'#7a5c33' },
  ];

  // recent invocations — context now references full hierarchy (ORG-04)
  const invocations = [
    { id:'inv-9012', skill:'governance-memo',       v:'4.0.1', user:'dana',  projectId:'prj-mci-ctms',   studyId:null,          surface:'Web',           ms:8400,  outcome:'success', at:'2026-05-28 14:22' },
    { id:'inv-9011', skill:'site-activation-risk-c',v:'3.2.0', user:'susan', projectId:'prj-bilh-onc',   studyId:'std-onc204',  surface:'Client Portal', ms:11200, outcome:'success', at:'2026-05-28 13:55' },
    { id:'inv-9010', skill:'style-filter',          v:'5.1.0', user:'tomas', projectId:'prj-bilh-onc',   studyId:'std-onc207',  surface:'Claude',        ms:3100,  outcome:'success', at:'2026-05-28 13:40' },
    { id:'inv-9009', skill:'ctms-extract',          v:'1.4.0', user:'dana',  projectId:'prj-mci-ctms',   studyId:null,          surface:'API',           ms:21800, outcome:'success', at:'2026-05-28 12:18' },
    { id:'inv-9008', skill:'enrollment-forecast',   v:'2.0.0', user:'karen', projectId:'prj-atlas-feas', studyId:null,          surface:'Web',           ms:34500, outcome:'success', at:'2026-05-28 11:02' },
    { id:'inv-9007', skill:'mvr-summarizer',        v:'1.1.0', user:'tomas', projectId:'prj-ns-mon',     studyId:'std-ns-mon01',surface:'Web',           ms:9700,  outcome:'failed',  at:'2026-05-28 10:31', error:'Input PDF exceeded 100 MB limit' },
    { id:'inv-9006', skill:'governance-memo-c',     v:'4.0.1', user:'susan', projectId:'prj-bilh-onc',   studyId:'std-onc204',  surface:'Client Portal', ms:7600,  outcome:'success', at:'2026-05-28 09:58' },
    { id:'inv-9005', skill:'protocol-feasibility',  v:'2.1.0', user:'matt',  projectId:'prj-atlas-feas', studyId:null,          surface:'Claude',        ms:5400,  outcome:'success', at:'2026-05-28 09:12' },
  ];

  // audit log — meta now carries full hierarchy path (ORG-04)
  const audit = [
    { id:'a-501', at:'2026-05-28 14:22:06', actor:'dana',  action:'skill.invoke',         target:'Governance Memo Generator v4.0.1',       meta:'MCI / CTMS Migration · Web · 8.4s · success',                               path:'Memorial Cancer Institute / CTMS Migration',              kind:'invoke'  },
    { id:'a-500', at:'2026-05-28 13:55:41', actor:'susan', action:'skill.invoke',         target:'Site Activation Risk Report v3.2.0',     meta:'BILH / Oncology Network Startup / ONC-204 Phase II · Client Portal · success', path:'Beth Israel Lahey Health / Oncology Network Startup / ONC-204 Phase II', kind:'invoke'  },
    { id:'a-499', at:'2026-05-28 11:40:12', actor:'matt',  action:'cert.method.sign',     target:'Protocol Deviation Trend Analyzer v1.0.0',meta:'methodology key · 2/4 criteria',                                                      path:null,                                                                 kind:'cert'    },
    { id:'a-498', at:'2026-05-28 10:31:55', actor:'tomas', action:'skill.invoke.failed',  target:'Monitoring Visit Report Summarizer v1.1.0',meta:'Northshore / Monitoring Optimization / CARDIO-RBM-01 · Input PDF exceeded 100 MB limit', path:'Northshore Health System / Monitoring Optimization / CARDIO-RBM-01', kind:'fail'    },
    { id:'a-497', at:'2026-05-28 09:05:02', actor:'priya', action:'cert.tech.sign',       target:'Protocol Deviation Trend Analyzer v1.0.0',meta:'technical key turned · 5/5 criteria',                                                 path:null,                                                                 kind:'cert'    },
    { id:'a-496', at:'2026-05-27 16:48:19', actor:'matt',  action:'skill.submit',         target:'Informed Consent Readability Auditor v0.9.0',meta:'submitted for validation',                                                           path:null,                                                                 kind:'submit'  },
    { id:'a-495', at:'2026-05-27 15:20:44', actor:'karen', action:'access.grant',         target:'Enrollment Forecast (client) v2.0.0',    meta:'BILH / Oncology Network Startup / ONC-204 Phase II · access granted',      path:'Beth Israel Lahey Health / Oncology Network Startup / ONC-204 Phase II', kind:'access'  },
    { id:'a-494', at:'2026-05-26 14:11:08', actor:'priya', action:'skill.version.publish',target:'Site Activation Risk Report v3.2.0',     meta:'derived from parent v3.2.0',                                                          path:null,                                                                 kind:'version' },
    { id:'a-493', at:'2026-05-24 11:30:51', actor:'matt',  action:'cert.method.sign',     target:'Governance Memo Generator v4.0.1',       meta:'methodology key turned · 4/4',                                                        path:null,                                                                 kind:'cert'    },
    { id:'a-492', at:'2026-05-24 10:02:33', actor:'priya', action:'cert.tech.sign',       target:'Governance Memo Generator v4.0.1',       meta:'technical key turned · 5/5',                                                          path:null,                                                                 kind:'cert'    },
    { id:'a-491', at:'2026-05-21 09:14:00', actor:'matt',  action:'lineage.flag',         target:'Site Activation Risk Report v3.1.2',     meta:'parent updated to v3.2.0 — derived flagged for review',                              path:null,                                                                 kind:'lineage' },
  ];

  // ---- Org Hierarchy ----
  const orgs = [
    { id:'org-vitalief', name:'Vitalief', type:'org', desc:'Clinical research consultancy — platform operator', created:'2020-01-01' },
  ];
  const clients = [
    { id:'cli-bilh',  org:'org-vitalief', name:'Beth Israel Lahey Health',  code:'BILH',  desc:'Academic health system, Boston MA — oncology network startup', created:'2025-06-01', lead:'karen', active:true },
    { id:'cli-mci',   org:'org-vitalief', name:'Memorial Cancer Institute', code:'MCI',   desc:'NCI-designated cancer center — CTMS migration engagement', created:'2025-09-15', lead:'dana',  active:true },
    { id:'cli-atlas', org:'org-vitalief', name:'Atlas Research Partners',   code:'ATLAS', desc:'Dedicated phase I–III CRO — portfolio feasibility', created:'2025-11-01', lead:'karen', active:true },
    { id:'cli-ns',    org:'org-vitalief', name:'Northshore Health System',  code:'NS',    desc:'Integrated health system, Chicago metro — monitoring optimization', created:'2026-01-10', lead:'tomas', active:false },
  ];
  const projects = [
    { id:'prj-bilh-onc',   client:'cli-bilh',  name:'Oncology Network Startup', code:'BILH-ONC',  desc:'Site activation and study startup across BILH oncology portfolio', created:'2025-06-01', lead:'karen', skillsAtProject:false },
    { id:'prj-mci-ctms',   client:'cli-mci',   name:'CTMS Migration',           code:'MCI-CTMS',  desc:'Full migration from legacy CTMS to Medidata Rave with data validation', created:'2025-09-15', lead:'dana',  skillsAtProject:true },
    { id:'prj-atlas-feas', client:'cli-atlas', name:'Portfolio Feasibility',     code:'ATLAS-FEAS',desc:'Rapid feasibility assessment across 12-protocol portfolio', created:'2025-11-01', lead:'karen', skillsAtProject:true },
    { id:'prj-ns-mon',     client:'cli-ns',    name:'Monitoring Optimization',   code:'NS-MON',   desc:'Risk-based monitoring design and site performance analytics', created:'2026-01-10', lead:'tomas', skillsAtProject:false },
  ];
  const studies = [
    { id:'std-onc204',   project:'prj-bilh-onc', name:'ONC-204 Phase II',  code:'ONC-204',    desc:'Phase II efficacy study, HER2+ breast cancer — 3 sites', sponsor:'BILH Oncology', phase:'Phase II',  created:'2025-07-01', status:'active' },
    { id:'std-onc207',   project:'prj-bilh-onc', name:'ONC-207 Phase I',   code:'ONC-207',    desc:'First-in-human dose escalation, advanced solid tumors — 1 site', sponsor:'BILH Oncology', phase:'Phase I',  created:'2025-10-15', status:'active' },
    { id:'std-ns-mon01', project:'prj-ns-mon',   name:'CARDIO-RBM-01',     code:'NS-MON-01',  desc:'Cardiovascular risk-based monitoring pilot — 2 sites', sponsor:'Northshore', phase:'Phase III', created:'2026-01-20', status:'paused' },
  ];
  const locations = [
    { id:'loc-mgh',   study:'std-onc204',   name:'Mass General Hospital',                code:'MGH-01',   city:'Boston, MA',   pi:'Dr. A. Chen',     status:'active', activated:'2025-08-12' },
    { id:'loc-dfci',  study:'std-onc204',   name:'Dana-Farber Cancer Institute',          code:'DFCI-01',  city:'Boston, MA',   pi:'Dr. R. Patel',    status:'active', activated:'2025-09-03' },
    { id:'loc-bidmc', study:'std-onc204',   name:'Beth Israel Deaconess Medical Center',  code:'BIDMC-01', city:'Boston, MA',   pi:'Dr. L. Kim',      status:'active', activated:'2025-09-28' },
    { id:'loc-bidc2', study:'std-onc207',   name:'Beth Israel Deaconess Medical Center',  code:'BIDMC-01', city:'Boston, MA',   pi:'Dr. L. Kim',      status:'active', activated:'2026-01-05' },
    { id:'loc-nse',   study:'std-ns-mon01', name:'Northshore Evanston',                   code:'NSE-01',   city:'Evanston, IL', pi:'Dr. M. Torres',   status:'paused', activated:'2026-02-01' },
    { id:'loc-nsg',   study:'std-ns-mon01', name:'Northshore Glenbrook',                  code:'NSG-01',   city:'Glenview, IL', pi:'Dr. S. Reeves',   status:'paused', activated:'2026-02-15' },
  ];
  // skill assignments — which skills are attached at which level
  const skillAssignments = [
    { id:'sa-1',  entityType:'project', entityId:'prj-mci-ctms',   skillId:'ctms-extract',         grantedBy:'dana',  grantedAt:'2025-10-01' },
    { id:'sa-2',  entityType:'project', entityId:'prj-mci-ctms',   skillId:'governance-memo-c',    grantedBy:'dana',  grantedAt:'2025-10-01' },
    { id:'sa-3',  entityType:'project', entityId:'prj-atlas-feas', skillId:'protocol-feasibility', grantedBy:'karen', grantedAt:'2025-11-05' },
    { id:'sa-4',  entityType:'project', entityId:'prj-atlas-feas', skillId:'enrollment-forecast',  grantedBy:'karen', grantedAt:'2025-11-05' },
    { id:'sa-5',  entityType:'project', entityId:'prj-atlas-feas', skillId:'reg-checklist',        grantedBy:'karen', grantedAt:'2026-03-20' },
    { id:'sa-6',  entityType:'study',   entityId:'std-onc204',     skillId:'site-activation-risk', grantedBy:'karen', grantedAt:'2025-08-01' },
    { id:'sa-7',  entityType:'study',   entityId:'std-onc204',     skillId:'governance-memo',      grantedBy:'karen', grantedAt:'2025-08-01' },
    { id:'sa-8',  entityType:'study',   entityId:'std-onc204',     skillId:'enrollment-forecast',  grantedBy:'karen', grantedAt:'2025-09-01' },
    { id:'sa-9',  entityType:'study',   entityId:'std-onc204',     skillId:'startup-timeline',     grantedBy:'karen', grantedAt:'2025-10-01' },
    { id:'sa-10', entityType:'study',   entityId:'std-onc207',     skillId:'site-activation-risk', grantedBy:'karen', grantedAt:'2025-11-01' },
    { id:'sa-11', entityType:'study',   entityId:'std-ns-mon01',   skillId:'mvr-summarizer',       grantedBy:'tomas', grantedAt:'2026-01-25' },
  ];

  // Client deliverables — scoped to project/study
  const deliverables = [
    { id:'d-31', skill:'governance-memo-c',     name:'Tumor Board Governance Memo',      files:['DOCX','PDF'], at:'2026-05-28 09:58', by:'susan', status:'ready', projectId:'prj-bilh-onc', studyId:'std-onc204' },
    { id:'d-30', skill:'site-activation-risk-c',name:'Q2 Site Activation Risk Report',   files:['PDF','XLSX'],  at:'2026-05-28 13:55', by:'susan', status:'ready', projectId:'prj-bilh-onc', studyId:'std-onc204' },
    { id:'d-29', skill:'enrollment-forecast-c', name:'ONC-204 Enrollment Forecast',      files:['PPTX','XLSX'], at:'2026-05-24 15:12', by:'karen', status:'ready', projectId:'prj-bilh-onc', studyId:'std-onc204' },
    { id:'d-28', skill:'governance-memo-c',     name:'Data Access Committee Charter',    files:['DOCX','PDF'], at:'2026-05-19 11:40', by:'susan', status:'ready', projectId:'prj-bilh-onc', studyId:'std-onc207' },
    { id:'d-27', skill:'site-activation-risk-c',name:'ONC-207 Site Onboarding Risk Scan',files:['PDF','XLSX'],  at:'2026-05-12 10:05', by:'karen', status:'ready', projectId:'prj-bilh-onc', studyId:'std-onc207' },
  ];

  window.DATA = { people, skills, weeks, usageSeries, usageByProject, invocations, audit, deliverables,
    techCrit, methodCrit,
    orgs, clients, projects, studies, locations, skillAssignments,
    skillById:    id => skills.find(s=>s.id===id),
    clientById:   id => clients.find(c=>c.id===id),
    projectById:  id => projects.find(p=>p.id===id),
    studyById:    id => studies.find(s=>s.id===id),
    locationById: id => locations.find(l=>l.id===id),
    // skills attached at a given entity level
    skillsAt(type, id) { return skillAssignments.filter(a=>a.entityType===type&&a.entityId===id).map(a=>({...a, skill:skills.find(s=>s.id===a.skillId)})).filter(a=>a.skill); },
    // invocation context path label
    invPath(inv) {
      if (inv.studyId)   return this.displayPath('study',   inv.studyId);
      if (inv.projectId) return this.displayPath('project', inv.projectId);
      return '';
    },
    // display path — excludes org/tenant level (org is a backend concept only)
    displayPath(type, id) {
      return this.entityPath(type, id).filter(s=>s.type!=='org').map(s=>s.name).join(' / ');
    },
    // full path for any entity as array of {type,id,name} segments
    entityPath(type, id) {
      const segs = [];
      if (type==='location') {
        const l = locations.find(x=>x.id===id); if(!l) return [];
        const s = studies.find(x=>x.id===l.study);
        const p = s && projects.find(x=>x.id===s.project);
        const c = p && clients.find(x=>x.id===p.client);
        const o = c && orgs.find(x=>x.id===c.org);
        if(o) segs.push({type:'org',id:o.id,name:o.name});
        if(c) segs.push({type:'client',id:c.id,name:c.name});
        if(p) segs.push({type:'project',id:p.id,name:p.name});
        if(s) segs.push({type:'study',id:s.id,name:s.name});
        segs.push({type:'location',id,name:l.name});
      } else if (type==='study') {
        const s = studies.find(x=>x.id===id); if(!s) return [];
        const p = projects.find(x=>x.id===s.project);
        const c = p && clients.find(x=>x.id===p.client);
        const o = c && orgs.find(x=>x.id===c.org);
        if(o) segs.push({type:'org',id:o.id,name:o.name});
        if(c) segs.push({type:'client',id:c.id,name:c.name});
        if(p) segs.push({type:'project',id:p.id,name:p.name});
        segs.push({type:'study',id,name:s.name});
      } else if (type==='project') {
        const p = projects.find(x=>x.id===id); if(!p) return [];
        const c = clients.find(x=>x.id===p.client);
        const o = c && orgs.find(x=>x.id===c.org);
        if(o) segs.push({type:'org',id:o.id,name:o.name});
        if(c) segs.push({type:'client',id:c.id,name:c.name});
        segs.push({type:'project',id,name:p.name});
      } else if (type==='client') {
        const c = clients.find(x=>x.id===id); if(!c) return [];
        const o = orgs.find(x=>x.id===c.org);
        if(o) segs.push({type:'org',id:o.id,name:o.name});
        segs.push({type:'client',id,name:c.name});
      } else if (type==='org') {
        const o = orgs.find(x=>x.id===id); if(!o) return [];
        segs.push({type:'org',id,name:o.name});
      }
      return segs;
    },
    pathString(type, id) {
      return this.entityPath(type,id).map(s=>s.name).join(' / ');
    },
  };
})();

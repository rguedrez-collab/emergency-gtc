// Embedded into the supplied artifact by prepare_ui.mjs. No browser speech API.
const BRAND = 'var(--text-color-brand)', SEC = 'var(--text-color-secondary)', OP = '#FF7900', CALLER = 'var(--text-color-primary)';
const SEV = s => s >= 85 ? ['Signal IA', 'yellow'] : ['À revoir', 'blue'];
const SEVTXT = {yellow:'var(--text-color-feedback-warning)', blue:'var(--text-color-feedback-info)'};
const STATUS = {blocked:'bloqué par le garde-fou · prenez l’appel', ringing:'décroché en cours', compose:'réplique de l’appelant', caller:'transcription STT', think:'analyse Gemma', tts:'synthèse Voxtral', operator:'en attente', gap:'en attente', error:'erreur · revue opérateur', ended:'clôturé'};
const SPEAKING = {caller:'l’appelant parle', assistant:'l’IA parle', operator:'l’opérateur parle'};
// Speaker colours are theme variables (resolved when the waveform is drawn).
const WAVE = {caller:'var(--oc-caller)', assistant:'var(--oc-ai)', operator:'var(--oc-op)'}, SPEAKER_ROW = {caller:'Appelant', assistant:'Agent IA', operator:'Vous'};
const fmt = ms => { const t = Math.floor(ms / 1000); return String(Math.floor(t / 60)).padStart(2,'0') + ':' + String(t % 60).padStart(2,'0'); };
const GREETING = "Je vous écoute. Dites-moi ce qui se passe.";
// Automatic samples stop at 24 caller turns; a human-driven call may continue to 60.
const AUTO_TURNS = 24, MAX_TURNS = 60, TURN_GAP_MS = 250;
// Up to six calls handled by the AI at once; taken-over and manual calls do not count.
// While there is room, a new call arrives every six seconds.
const AI_CALLS = 6, ARRIVAL_MS = 6000, MANUAL_CALLS = 4;
const FACT_ORDER = ['Incident','Lieu','Personnes','Rappel','Danger'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const h = (...args) => React.createElement(...args);
// A caller site answers with its audio inside the JSON (base64 WAV); durations are shown with a thin thousands separator.
const wavBlob = b64 => { const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes], {type:'audio/wav'}); };
const fmtMs = v => v == null || !Number.isFinite(v) ? '—' : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + ' ms';
// Quotes were verified against caller turns; a later analysis omitting a field must not erase it.
const mergeFacts = (old, next) => { const fields = new Set(next.map(f => f.k));
  return [...next, ...old.filter(f => !fields.has(f.k))].sort((a, b) => FACT_ORDER.indexOf(a.k) - FACT_ORDER.indexOf(b.k)).slice(0, 8); };
// Theme: the operator's last choice, else the OS preference (dark/light); « verre liquide » only by explicit choice.
const initialStyle = () => {
  try { const saved = localStorage.getItem('orange-style'); if (['sober', 'dark', 'glass'].includes(saved)) return saved; } catch (e) {}
  try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'sober'; } catch (e) { return 'sober'; }
};
// The console's layout: « focus » (default) shows one call full screen under a queue strip; « columns » is the three-column
// console (list, call, copilot). ?layout=columns or the Réglages toggle; the choice is remembered in this browser.
const initialLayout = () => {
  try { const q = new URLSearchParams(location.search).get('layout'); if (q === 'columns' || q === 'focus') return q; } catch (e) {}
  try { const saved = localStorage.getItem('orange-layout'); if (saved === 'columns' || saved === 'focus') return saved; } catch (e) {}
  return 'focus';
};
// The three services an operator can dispatch (same tool ids and labels as the gateway's catalogue).
const initialSideOpen = () => { try { return localStorage.getItem('orange-side') !== 'closed'; } catch (e) { return true; } };
const DISPATCH_TOOLS = [['dispatch_ambulance', 'SAMU', 'Déclencher le SAMU · ambulance'], ['dispatch_fire', 'Pompiers', 'Déclencher les pompiers'], ['dispatch_police', 'Police', 'Déclencher la police']];
// SCENARIOS is injected from samples.mjs: 100 synthetic caller-only test calls.
// Model names in the footnote follow the gateway's configuration (see labels()).
const footnoteText=L=>'Signal IA ≠ gravité clinique. Éléments déclarés vérifiés par correspondance textuelle ; interprétation et synthèse à valider par l’opérateur. Aucun diagnostic ni consigne médicale. STT : '+L.sttLabel+' · Analyse : '+L.llm+' · Voix : '+L.tts+'.';

// Transcript avatars: line icons drawn inline (no icon font, no emoji), coloured by the avatar's background.
const svg = (...shapes) => h('svg', {viewBox:'0 0 24 24', width:12, height:12, fill:'none', stroke:'currentColor', strokeWidth:2.2, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':'true'}, ...shapes);
const ICONS = {
  robot: svg(h('rect', {key:'head', x:4, y:9, width:16, height:11, rx:2.5}), h('path', {key:'antenna', d:'M12 9V5M9 5h6'}),
    h('circle', {key:'l', cx:9, cy:14.5, r:1.1, fill:'currentColor', stroke:'none'}), h('circle', {key:'r', cx:15, cy:14.5, r:1.1, fill:'currentColor', stroke:'none'}), h('path', {key:'mouth', d:'M9.5 17.5h5'})),
  human: svg(h('circle', {key:'head', cx:12, cy:8, r:3.6}), h('path', {key:'body', d:'M4.5 20.5a7.5 7.5 0 0 1 15 0'})),
};
// Fictional caller identity: a European mobile number (France mostly — in the ARCEP range reserved for fiction,
// 06 39 98 xx xx — some Germany, Spain, Italy) with two digits masked, so the console never shows a dialable number.
// Deterministic per sample, so a reload or a rebuild keeps the same number on the same call.
const fakePhone = seed => {
  let x = 2166136261; for (const ch of String(seed)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  const next = () => { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0; return x; };
  const pool = String(next()) + String(next()) + String(next());
  const country = ['fr', 'fr', 'fr', 'de', 'fr', 'es', 'fr', 'it', 'fr', 'fr'][next() % 10];
  const templates = {fr:'+33 6 39 98 •• ##', de:'+49 151 •• ## ###', es:'+34 6## •• ## ##', it:'+39 3## ### ••##'};
  let i = 0; return templates[country].replace(/#/g, () => pool[i++ % pool.length]);
};

class Component extends DCLogic {
  state = {calls:[], selId:null, view:'floor', audioOn:true, opText:'', mic:false, shift:0, nextIn:0, stt:'nemotron', tones:false, tools:false, settings:false, emotions:true, layout:initialLayout(), sideOpen:initialSideOpen(), more:{}, style:initialStyle(), aiVoice:'fr_female', aiPace:'posé', health:'Vérification des services…',session:{status:'idle',launched:0,finished:0,failed:0,total:100,id:0},
    callers:[], latency:null, sitePolicy:'auto', analytics:false};
  seq = 0; scIdx = 0; disposed = false; autoJobs = new Set(); playToken = 0;
  trRef = React.createRef(); waveRef = React.createRef();
  componentDidMount() {
    this.started = Date.now();
    this.tick = setInterval(() => {
      this.state.calls.forEach(c => {if (!c.ended) c.t = Date.now() - c.started;});
      this.setState({shift:Date.now()-this.started});
      this.pumpSession();
    }, 250);
    this.refreshHealth(); this.refreshLatency();
    this.healthTick = setInterval(() => {this.refreshHealth(); this.refreshLatency();}, 30000);
    // The gateway keeps the vacation: restore it, then save every 2 s while something exists.
    this.restoring = true;
    this.restore().finally(() => {this.restoring = false;});
    this.persistTick = setInterval(() => this.persist(), 2000);
    // Real callers on their phones (page /appel): adopt new lines and pull their recordings every second.
    this.lineTick = setInterval(() => {this.pollLines(); this.pollLineEvents();}, 1000);
    this.onHide = () => this.persist(true);
    window.addEventListener('pagehide', this.onHide);
    // Any later click re-arms sound if the browser blocked a clip.
    this.onGesture = () => this.resumeBlockedAudio();
    document.addEventListener('pointerdown', this.onGesture, true);
    // Escape returns to the overview, unless the user is typing.
    this.onKey = e => {if (e.key === 'Escape' && this.state.view === 'call' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) this.goFloor();};
    document.addEventListener('keydown', this.onKey);
    this.onResize = () => this.fit();
    window.addEventListener('resize', this.onResize);
    this.fit();
    this.applyStyle();
    // The mockup's waveform loop (lost with its original controller), driven by renderVals' waveMode.
    const draw = () => {
      const cv = this.waveRef.current;
      if (cv) {
        const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, t = performance.now() / 1000, m = this.waveMode || {amp:0, color:'#555'};
        ctx.clearRect(0, 0, W, H); const n = 72, bw = W / n;
        ctx.fillStyle = m.color.startsWith('var(') ? getComputedStyle(cv).getPropertyValue(m.color.slice(4, -1)).trim() || '#888' : m.color;
        for (let i = 0; i < n; i++) {
          const h = 2 + m.amp * (H - 4) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.55 + t * 9) * Math.sin(i * 0.13 + t * 2.3)));
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(i * bw + 1, (H - h) / 2, bw - 2, h, 2); ctx.fill(); } else ctx.fillRect(i * bw + 1, (H - h) / 2, bw - 2, h);
        }
      }
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }
  // The console fills the viewport below the session bar, whatever the bar needs (one or two rows, Réglages open or not).
  fit() {
    const oc = document.querySelector('.oc');
    if (!oc) return;
    const top = Math.round(oc.getBoundingClientRect().top + window.scrollY) + 'px';
    if (oc.style.getPropertyValue('--oc-top') !== top) oc.style.setProperty('--oc-top', top);
  }
  // « Style » in Réglages: sober (light, flat — default), liquid glass, or the mockup's dark theme. The style is a class on
  // <html>; the mockup's theme tokens are switched by swapping its ThemeProvider class, which React never rewrites.
  applyStyle() {
    const style = this.state.style || 'sober', root = document.documentElement;
    root.classList.toggle('glass', style === 'glass'); root.classList.toggle('sober', style === 'sober'); root.classList.toggle('dark', style === 'dark');
    root.classList.toggle('flat', style !== 'glass'); // sober and dark share the flat rules; only the palette differs
    root.setAttribute('nve-theme', style === 'sober' ? 'light' : 'dark');
    const provider = document.querySelector('.nv-dark,.nv-light');
    if (provider) {provider.classList.toggle('nv-light', style === 'sober'); provider.classList.toggle('nv-dark', style !== 'sober');}
    try { localStorage.setItem('orange-style', style); } catch (e) {}
  }
  // One bar button cycles the three looks and names the current one: clair → sombre → verre liquide.
  themeButton() {
    const names = {sober: 'clair', dark: 'sombre', glass: 'verre liquide'}, next = {sober: 'dark', dark: 'glass', glass: 'sober'};
    return this.button('Thème : ' + (names[this.state.style] || 'clair'), () => this.setState({style: next[this.state.style] || 'sober'}), false, 'orange-theme',
      'Changer de thème : clair, sombre, verre liquide', {tone: 'quiet'});
  }
  componentDidUpdate() {
    this.fit();
    this.applyStyle();
    const el = this.trRef.current, c = this.sel();
    const key = c ? c.id + ':' + c.tr.length : '';
    if (el && key !== this.lastTrKey) {this.lastTrKey=key;el.scrollTop=el.scrollHeight;}
    // The tab title counts calls waiting for a human, useful while the tab is in the background.
    const waiting = this.state.calls.filter(x => !x.ended && (x.takenOver || x.alerted && !x.snoozed)).length;
    const title = (waiting ? '(' + waiting + ') ' : '') + 'Orange · Urgences · Démonstration';
    if (document.title !== title) document.title = title;
  }
  componentWillUnmount() {
    this.disposed=true; clearInterval(this.tick);clearInterval(this.healthTick);clearInterval(this.persistTick);clearInterval(this.lineTick);cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);window.removeEventListener('pagehide', this.onHide);
    document.removeEventListener('pointerdown',this.onGesture,true);document.removeEventListener('keydown',this.onKey);
    this.cancelRecording();this.stopAudio();
    this.state.calls.forEach(c=>c.controllers.forEach(x=>x.abort()));
  }
  async refreshHealth() {
    try {const r=await fetch('/api/health',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Connexion refusée');
      const h=await r.json();const g=h.guardrail||{};const guard=g.configured?(g.enabled===false?' · garde-fou désactivé':h.services?.guardrail?.ready===false?' · garde-fou injoignable':' · garde-fou '+(g.name||'')+' actif'+(g.mode?' ('+g.mode+')':'')):'';
      const m=h.models||{},stt=Array.isArray(m.stt)&&m.stt.length?m.stt:['nemotron','parakeet'];
      if(!this.disposed)this.setState({guardrail:g,services:h.services||{},models:m,stt:stt.includes(this.state.stt)?this.state.stt:stt[0],callers:Array.isArray(h.callers)?h.callers:[],
        health:(h.ready?'Modèles connectés · STT / '+(m.llm_label||'Gemma 4')+' / '+(m.tts_label||'Voxtral'):'Modèle indisponible')+guard});
    } catch(e) {if(!this.disposed)this.setState({services:{stt:{ready:false},gemma:{ready:false},voxtral:{ready:false}},health:'Connexion indisponible'});}
  }
  // Per-site latency aggregates kept by the gateway (median, p95 of the caller round trip; the console's own steps).
  async refreshLatency() {
    try {const r=await fetch('/api/latency',{signal:AbortSignal.timeout(10000)});if(!r.ok)return;const d=await r.json();
      this.latencyRefreshedAt=Date.now();if(!this.disposed&&d&&Array.isArray(d.sites))this.setState({latency:d});
    } catch(e) {}
  }
  // Which caller site produces the next scenario call's voice: the ready sites in turn (default), a pinned site, or the
  // gateway's built-in caller ('local'). Without configured sites every call is local.
  pickLocation() {
    const sites=this.state.callers||[];if(!sites.length)return 'local';
    const policy=this.state.sitePolicy||'auto';
    if(policy==='local')return 'local';
    if(policy!=='auto')return sites.some(s=>s.name===policy)?policy:'local';
    const pool=sites.filter(s=>s.ready!==false);if(!pool.length)return 'local';
    this.siteTurn=(this.siteTurn||0)+1;return pool[this.siteTurn%pool.length].name;
  }
  siteName(name) {return !name||name==='local'?'passerelle':name;}
  sitePolicyButton() {
    const sites=this.state.callers||[];if(!sites.length)return null;
    const order=['auto',...sites.map(s=>s.name),'local'],cur=order.includes(this.state.sitePolicy)?this.state.sitePolicy:'auto';
    return this.button('Site appelant : '+(cur==='auto'?'alternance':this.siteName(cur)),()=>this.setState({sitePolicy:order[(order.indexOf(cur)+1)%order.length]}),false,'orange-site',
      'Site qui produit la voix de l’appelant pour les nouveaux appels : alternance entre les sites, un site précis, ou l’appelant intégré de la passerelle');
  }
  // Model names come from the gateway's health payload (environment-configured); the defaults are the demo's set-up.
  labels() {
    const m=this.state.models||{},stt=Array.isArray(m.stt)&&m.stt.length?m.stt:['nemotron','parakeet'];
    return {llm:m.llm_label||'Gemma 4',tts:m.tts_label||'Voxtral',stt,sttLabel:stt.map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(' / ')};
  }
  // One compact status chip: a dot per service (transcription, analysis, voice, guardrail); the health text is the tooltip.
  // Service status as exceptions only: nothing while every service is up; one dot per service as soon as one is down
  // (or the gateway is unreachable), the guardrail when one is configured, the caller sites when one is unreachable.
  // The health text is the tooltip.
  servicesChip() {
    const L=this.labels();
    const svc=this.state.services,g=this.state.guardrail||{};
    const ready=key=>svc?svc[key]?.ready:undefined; // before the first health answer: unknown, nothing to report
    const dot=(key,label,state,title)=>h('span',{key,className:'oc-svc oc-svc-'+(state===false?'warn':state?'ok':'off'),title},label);
    const core=[['stt','STT','Transcription · '+L.sttLabel],['gemma','Analyse','Analyse et dialogue · '+L.llm],['voxtral','Voix','Synthèse vocale · '+L.tts]];
    const states=core.map(([key])=>ready(key));
    const dots=states.some(x=>x===false)?core.map(([key,label,title],i)=>dot(key,label,states[i],title)):[];
    // The guardrail chip is a toggle: the configuration stays, the AI's turns bypass the proxy while it is off.
    if(g.configured){const on=g.enabled!==false,down=on&&svc?.guardrail?.ready===false;
      dots.push(h('button',{key:'guard',type:'button',id:'orange-guardrail-toggle',role:'switch','aria-checked':on?'true':'false',className:'oc-switch'+(on?' oc-switch-on':'')+(down?' oc-switch-warn':''),
        title:on?`${g.name||'Garde-fou IA'} actif${g.mode?' · '+g.mode:''} · cliquer pour désactiver`:`${g.name||'Garde-fou IA'} désactivé · l’analyse va directement au modèle · cliquer pour réactiver`,
        onClick:()=>this.toggleGuardrail()},
        h('span',{key:'track',className:'oc-switch-track'},h('span',{className:'oc-switch-knob'})),
        h('span',{key:'label',className:'oc-switch-label'},'Garde-fou · '+(g.name||'IA')),
        h('span',{key:'state',className:'oc-switch-state'},on?(down?'injoignable':'activé'):'désactivé')));}
    // Caller sites are not a console outage (the built-in caller takes over), so they only appear when one is down.
    if(svc?.callers?.ready===false)dots.push(dot('sites','Sites appelants',false,'Un site appelant est injoignable · appelant intégré de la passerelle en repli'));
    return dots.length?h('span',{key:'services',className:'oc-chip oc-services',role:'status',title:this.state.health},...dots):null;
  }
  async toggleGuardrail() {
    const g=this.state.guardrail||{};if(!g.configured||this.guardBusy)return;this.guardBusy=true;
    try{
      const r=await fetch('/api/guardrail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:g.enabled===false})});
      if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();
      if(!this.disposed)this.setState({guardrail:d.guardrail||{...g,enabled:g.enabled===false}});
    }catch(e){/* the chip keeps its state; the next health poll tells the truth */}
    finally{this.guardBusy=false;}
  }
  touch() {if(!this.disposed)this.forceUpdate();}
  sel() {return this.state.calls.find(c=>c.id===this.state.selId);}
  setPhase(c,p) {c.phase=p;this.touch();}
  append(c,who,text,source,extra) {c.tr.push({who,text,full:text,ts:fmt(c.t),source,...extra});this.touch();}
  tool(c,name,args) {const t={name,args,status:'running',result:'',started:performance.now()};c.tools.push(t);this.touch();return t;}
  done(t,result) {t.status='done';t.result=result;t.ms=Math.round(performance.now()-t.started);this.touch();}
  fail(c,e) {
    if(e.name==='AbortError'||c.ended||this.disposed)return;
    if(this.audioCallId===c.id)this.stopAudio(); // A failed turn must not keep talking.
    if(!c.alerted)c.alertAt=this.state.shift;c.score??=40;
    c.alerted=true;c.snoozed=false;
    if(e.guardrail){
      // The guardrail refused the exchange: the AI stops and the call waits for a human; nothing is closed.
      c.phase='blocked';c.guardrail={...e.guardrail,message:e.message,at:new Date().toISOString()};c.suggestion='';
      c.why='Garde-fou : contenu bloqué — l’IA ne répond plus, prenez l’appel.';
      c.tools.filter(t=>t.status==='running').forEach(t=>{t.status='error';t.result='bloqué par le garde-fou';});
      this.append(c,'Système',e.message+' Prise en charge opérateur requise.','guardrail');return;
    }
    c.phase='error';c.why='Traitement interrompu · revue opérateur requise.';
    c.tools.filter(t=>t.status==='running').forEach(t=>{t.status='error';t.result=e.message;});
    this.append(c,'Système',e.message,'error');
  }
  async api(c,path,payload,headers) {
    const ctrl=new AbortController();c.controllers.add(ctrl);
    const timeout=setTimeout(()=>ctrl.abort(),125000);
    // The gateway serves the audible or human-handled call first under contention.
    const priority=!c.auto||c.id===this.audible()?'foreground':'background';
    try {
      let r;
      for(let attempt=0;attempt<12;attempt++){
        r=await fetch(path,{method:'POST',signal:ctrl.signal,
          headers:{...(headers||{'Content-Type':'application/json'}),'X-Orange-Priority':priority},body:headers?payload:JSON.stringify(payload)});
        if(r.status!==429||attempt===11)break;
        await r.text();
        // Aborted browser requests may still be completing upstream. Allow them
        // to release gateway slots before a new request.
        await sleep(Math.min(1000,250*(attempt+1)));
        if(c.ended||this.disposed)throw new DOMException('Call closed','AbortError');
      }
      if(!r.ok){let body={};try{body=await r.json();}catch(_){}throw Object.assign(Error(body.error||'Erreur HTTP '+r.status),body.guardrail?{guardrail:body.guardrail}:{});}
      return r;
    } catch(e) {
      if(e.name==='AbortError'&&!c.ended&&!this.disposed)throw Error('Délai dépassé. Réessayez ; aucune conclusion de sécurité.');
      if(e.name==='TypeError')throw Error('Connexion au serveur interrompue. Réessayez ; aucune conclusion de sécurité.');
      throw e;
    }
    finally {clearTimeout(timeout);c.controllers.delete(ctrl);}
  }
  createCall(scenario=false,options={}) {
    const line=options.line||null;  // a real caller on a phone (mobile line), see adoptLine()
    if(!options.auto&&this.state.calls.filter(c=>!c.ended&&!c.auto).length>=MANUAL_CALLS){if(!line)window.alert('Quatre tests manuels maximum. Clôturez un test.');return;}
    const sc=scenario?SCENARIOS[options.index??this.scIdx++%SCENARIOS.length]:{cat:line?'Appel entrant · ligne mobile':'Appel micro / texte',turns:[]};
    const c={id:'TEST-'+(++this.seq),n:this.seq,sc:{cat:sc.cat,place:'Lieu non renseigné',lang:'FR · test',svc:'Revue opérateur'},
      // Automatic calls ring in as "Entrant" (no score yet), as in the original mockup.
      phone:line?'ligne mobile'+(line.name?' · '+line.name:''):fakePhone(sc.id||'test-'+this.seq),started:Date.now(),t:0,ti:0,scenario:sc.turns,phase:options.auto?'ringing':'gap',score:null,
      tr:[],facts:[],summary:'',takenOver:false,ended:false,endLabel:'',alerted:false,snoozed:false,why:'',suggestion:'',tools:[],
      info:[{k:'Identité',v:line?'Ligne mobile de démonstration':'Numéro fictif, deux chiffres masqués'},{k:'Adresse',v:'Non confirmée'},
        {k:'Source',v:scenario?'Scénario fictif → audio → STT':line?'Téléphone (page /appel) → passerelle → STT':'Micro / texte de test'}],
      busy:false,controllers:new Set(),revision:0,audit:[],lastAnalysis:null,seenSignals:[],gaps:[],prefetch:null,queued:null,
      sampleId:sc.id||null,sessionId:options.auto?this.state.session.id:null,auto:!!options.auto,liveCaller:!!options.liveCaller,reviewRequired:true,reviewed:false};
    if(c.liveCaller)c.sc.cat='Votre appel simulé';
    c.voice=sc.voice||'fr_female';c.voiceStyle=sc.voiceStyle||'urgent';c.targetDurationMs=sc.durationMs||150000;
    c.callerFacts=sc.facts||null;
    // The site whose service plays this caller (voice included), and the per-turn latency log of the call.
    c.location=scenario?this.pickLocation():'local';c.latency=[];c.lastCaller=null;c.actions=[];
    if(line){c.lineId=line.id;c.lineName=line.name||'';c.lineSeen=0;c.location='ligne';}
    // Two voice presets only: a small per-sample pitch/tempo offset keeps callers from sounding identical.
    c.voiceRate=scenario&&sc.id?0.96+((sc.family*7+sc.id.charCodeAt(sc.id.length-1))%9)/100:1;
    if(!options.background){this.cancelRecording();this.stopAudio();this.unlockAudio();}
    this.setState({calls:[...this.state.calls,c],...(options.background?{}:{selId:c.id,view:'call',opText:''})},()=>{
      if(scenario&&!options.auto)this.nextScenario(c);
      else if(!scenario){this.append(c,'Agent IA',GREETING,'fixed_demo_greeting');
        // The phone hears the greeting: synthesized whether or not the call is open here.
        if(line)this.run(c,async()=>{const b=await this.tts(c,GREETING,'assistant');await this.deliver(c,b,GREETING,'assistant');});}
    });
    return c;
  }
  startUserCall() {
    // The user supplies the caller speech; never generate a fictitious caller here.
    const c=this.createCall(false,{liveCaller:true});if(!c)return;
    if(this.state.session.status==='running')this.toggleSession();
    return c;
  }
  startSession() {
    if(['running','paused'].includes(this.state.session.status))return;
    // Jobs from a stopped session finish unwinding inside the same two-job budget.
    this.cancelRecording();this.stopAudio();this.unlockAudio();this.nextArrivalAt=0;
    const session={status:'running',launched:0,finished:0,failed:0,total:SCENARIOS.length,id:this.state.session.id+1};
    this.setState({session,view:'floor'},()=>this.pumpSession());
  }
  toggleSession() {
    const s=this.state.session;if(!['running','paused'].includes(s.status))return;
    // Resuming from a read-only tab is an explicit takeover of the vacation.
    if(this.readOnly&&s.status==='paused'){this.readOnly=false;this.takeover=true;}
    this.setState({session:{...s,status:s.status==='running'?'paused':'running'},notice:null},()=>this.pumpSession());
  }
  stopSession() {
    const s=this.state.session;if(!['running','paused'].includes(s.status))return;
    this.setState({session:{...s,status:'stopped'}});
    // Calls a human has taken over stay open until that human closes them.
    this.state.calls.filter(c=>c.auto&&c.sessionId===s.id&&!c.ended&&!c.takenOver).forEach(c=>this.endCall(c,'Session close · à revoir'));
  }
  // Sound only for the call the user has opened: the overview is silent.
  audible() {return this.state.view==='call'?this.state.selId:null;}
  // Arrivals are limited by the calls the AI is handling, so human-handled and manual calls never block them.
  aiCalls() {const s=this.state.session;return this.state.calls.filter(c=>c.auto&&c.sessionId===s.id&&!c.ended&&!c.takenOver).length;}
  async pumpSession() {
    const s=this.state.session;if(s.status!=='running'||this.disposed)return;
    const now=Date.now();
    if(s.launched<s.total&&this.aiCalls()<AI_CALLS&&now>=(this.nextArrivalAt||0)){
      const c=this.createCall(true,{auto:true,background:true,index:s.launched});
      if(c){s.launched++;this.nextArrivalAt=now+ARRIVAL_MS;this.chime();this.touch();}
    }
    if(this.recording)return;
    const focus=this.audible();
    const eligible=this.state.calls.filter(c=>c.auto&&c.sessionId===s.id&&!c.ended&&!c.takenOver&&c.phase!=='blocked'&&!c.busy&&!this.autoJobs.has(c.id)&&(c.id===focus||now>=(c.nextAutoTurnAt||0)));
    // The selected call never waits behind muted ones; muted calls and human actions share two model flows.
    const flows=[...this.autoJobs].filter(id=>id!==focus).length+this.state.calls.filter(c=>c.busy&&!this.autoJobs.has(c.id)).length;
    const c=eligible.find(x=>x.id===focus)||(flows<2?eligible.sort((a,b)=>(a.lastAutoTurn||0)-(b.lastAutoTurn||0))[0]:null);
    if(c){
      this.autoJobs.add(c.id);c.lastAutoTurn=Date.now();
      try{
        await this.nextScenario(c);
        c.nextAutoTurnAt=c.id===this.audible()?Date.now():Math.max(Date.now()+3000,c.started+c.targetDurationMs*c.ti/c.scenario.length);
        if(c.ended||c.takenOver)return;
        if(c.phase==='error')this.endCall(c,'Échec de traitement · à revoir');
        else if(c.ti>=AUTO_TURNS||(c.ti>=c.scenario.length&&Date.now()-c.started>=c.targetDurationMs)){
          this.append(c,'Système','Conversation terminée. Compte rendu disponible pour validation.','sample_complete');
          this.endCall(c,'Appel terminé · à revoir');
        }
      }finally{
        this.autoJobs.delete(c.id);this.touch();
        // Start the next turn now rather than on the next 250 ms tick.
        if(!this.disposed)setTimeout(()=>this.pumpSession(),0);
      }
    }
    const current=this.state.session;
    if(current.id===s.id&&current.status==='running'&&current.launched===current.total&&!this.state.calls.some(c=>c.sessionId===s.id&&!c.ended)){
      this.setState({session:{...current,status:'completed'}});
    }
  }
  async run(c,fn) {
    if(!c||c.ended||c.busy)return;
    c.busy=true;this.touch();
    try{await fn();}catch(e){this.fail(c,e);}
    finally{c.busy=false;this.touch();
      // Operator text typed during a busy turn is spoken once that turn ends; a phone recording that arrived meanwhile follows.
      const q=c.queued;c.queued=null;if(q&&!c.ended&&!this.disposed)this.submitText(c,q.text,q.who);
      else if(c.lineQueue?.length&&!c.ended&&!this.disposed)this.lineSpeech(c,c.lineQueue.shift());}
  }
  // The AI speaks with the selected preset; the human operator takes the other one so the two voices differ.
  voiceOptions(c,speaker) {
    if(speaker==='caller')return {voice:c.voice,style:c.voiceStyle,emotion:this.state.emotions!==false};
    const other=this.state.aiVoice==='fr_female'?'fr_male':'fr_female';
    return speaker==='assistant'?{voice:this.state.aiVoice,pace:this.state.aiPace}:{voice:other};
  }
  async tts(c,text,speaker='assistant') {
    const opts=this.voiceOptions(c,speaker);
    const t=this.tool(c,this.labels().tts+' TTS',speaker==='caller'?`${c.voice} · ${c.voiceStyle}`:`${opts.voice} · ${speaker==='assistant'?this.state.aiPace:'opérateur'}`);
    try{
      const r=await this.api(c,'/api/tts',{text,speaker,...opts});const blob=await r.blob();
      const preset=r.headers.get('X-Voice-Preset');  // the emotional variant actually spoken, when it differs from the base voice
      this.done(t,blob.size+' octets · '+r.headers.get('X-TTS-MS')+' ms'+(preset&&preset!==opts.voice?' · '+preset:''));
      c.lastTts={ms:Number(r.headers.get('X-TTS-MS'))||t.ms,speaker};return blob;
    }catch(e){if(t.status==='running'){t.status=c.ended?'cancelled':'error';t.result=c.ended?'annulé':e.message;}throw e;}
  }
  async transcribe(c,blob,filename='test.webm') {
    const stt=this.state.stt;this.setPhase(c,'caller');const t=this.tool(c,'STT',stt);
    const r=await this.api(c,'/api/transcribe',blob,{'Content-Type':'application/octet-stream','X-Model':stt,'X-Filename':filename});
    const data=await r.json();if(!data.text?.trim())throw Error('Aucune parole intelligible. Réessayez.');
    this.done(t,(data.ms||t.ms||0)+' ms · '+stt);c.lastStt={ms:t.ms};return data.text.trim();
  }
  unlockAudio() {
    // Prime the shared media element inside a user gesture (Safari), never over live audio.
    if(typeof Audio==='undefined'||this.audioUnlocked||this.unlocking||this.audioCallId)return;
    const pcm=new ArrayBuffer(44+4800),v=new DataView(pcm);
    const str=(offset,s)=>[...s].forEach((ch,i)=>v.setUint8(offset+i,ch.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,pcm.byteLength-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);
    v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);
    v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,4800,true);
    const a=this.player=this.player||new Audio(),url=URL.createObjectURL(new Blob([pcm],{type:'audio/wav'}));
    this.audioGraph();this.unlocking=true;a.onended=a.onerror=null;a.src=url;
    a.play().then(()=>{this.audioUnlocked=true;},()=>{}).finally(()=>{this.unlocking=false;URL.revokeObjectURL(url);});
  }
  resumeBlockedAudio() {
    if(this.graph&&this.graph.ac.state!=='running')this.graph.ac.resume().catch(()=>{});
    if(this.audioBlocked&&this.player)this.player.play().then(()=>{this.audioBlocked=false;this.audioUnlocked=true;},()=>{});
    else this.unlockAudio();
  }
  // Phone-line colouring for the caller (band-limited, lightly saturated, compressed, faint line noise)
  // and a clean path for the AI and operator voices. Built inside the first user gesture; without
  // Web Audio the element simply plays directly.
  audioGraph() {
    if(this.graph!==undefined)return this.graph;
    const AC=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!AC||!this.player)return this.graph=null;
    try{
      const ac=new AC(),src=ac.createMediaElementSource(this.player);
      const hp=ac.createBiquadFilter();hp.type='highpass';hp.frequency.value=300;
      const lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=3400;
      const shaper=ac.createWaveShaper(),curve=new Float32Array(1024);
      for(let i=0;i<1024;i++){const x=i/511.5-1;curve[i]=Math.tanh(1.8*x)/Math.tanh(1.8);}shaper.curve=curve;
      const comp=ac.createDynamicsCompressor();comp.threshold.value=-26;comp.knee.value=12;comp.ratio.value=5;comp.attack.value=0.004;comp.release.value=0.18;
      const phone=ac.createGain(),clean=ac.createGain(),hiss=ac.createGain();phone.gain.value=0;clean.gain.value=1.1;hiss.gain.value=0;
      src.connect(hp);hp.connect(lp);lp.connect(shaper);shaper.connect(comp);comp.connect(phone);phone.connect(ac.destination);
      // AI and operator: a brighter, more present read (the presets sound dark), lightly levelled.
      const rumble=ac.createBiquadFilter();rumble.type='highpass';rumble.frequency.value=80;
      const presence=ac.createBiquadFilter();presence.type='peaking';presence.frequency.value=3000;presence.Q.value=0.9;presence.gain.value=3;
      const air=ac.createBiquadFilter();air.type='highshelf';air.frequency.value=5000;air.gain.value=3;
      const level=ac.createDynamicsCompressor();level.threshold.value=-24;level.knee.value=10;level.ratio.value=3;level.attack.value=0.005;level.release.value=0.2;
      src.connect(rumble);rumble.connect(presence);presence.connect(air);air.connect(level);level.connect(clean);clean.connect(ac.destination);
      const buffer=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      const noise=ac.createBufferSource();noise.buffer=buffer;noise.loop=true;
      const band=ac.createBiquadFilter();band.type='bandpass';band.frequency.value=1500;band.Q.value=0.5;
      noise.connect(band);band.connect(hiss);hiss.connect(ac.destination);noise.start();
      return this.graph={ac,phone,clean,hiss};
    }catch(e){return this.graph=null;}
  }
  voiceFor(speaker) {
    const g=this.audioGraph();if(!g)return;
    if(g.ac.state!=='running')g.ac.resume().catch(()=>{});
    const t=g.ac.currentTime,caller=speaker==='caller';
    g.phone.gain.setTargetAtTime(caller?1.15:0,t,0.015);g.clean.gain.setTargetAtTime(caller?0:1.1,t,0.015);g.hiss.gain.setTargetAtTime(caller?0.006:0,t,0.05);
  }
  chime() {
    // Short two-note arrival tone, only if the user switched tones on.
    const g=this.state.tones?this.audioGraph():null;if(!g||g.ac.state!=='running')return;
    const t=g.ac.currentTime;
    [[880,0],[1175,0.09]].forEach(([f,d])=>{const o=g.ac.createOscillator(),v=g.ac.createGain();o.frequency.value=f;
      v.gain.setValueAtTime(0.0001,t+d);v.gain.exponentialRampToValueAtTime(0.05,t+d+0.01);v.gain.exponentialRampToValueAtTime(0.0001,t+d+0.16);
      o.connect(v);v.connect(g.ac.destination);o.start(t+d);o.stop(t+d+0.2);});
  }
  stopAudio() {
    this.playToken++;this.audioBlocked=false;
    if(this.graph)this.graph.hiss.gain.setTargetAtTime(0,this.graph.ac.currentTime,0.03);
    if(this.player){const a=this.player;a.onpause=a.onplay=a.onplaying=a.ontimeupdate=a.onloadedmetadata=a.onended=a.onerror=null;
      a.pause();a.removeAttribute('src');a.load();}
    this.audioCallId=null;this.audioSpeaker=null;
    if(!this.disposed)this.setState({playback:null});
    if(this.audioURL){URL.revokeObjectURL(this.audioURL);this.audioURL=null;}
    if(this.audioDone){const done=this.audioDone;this.audioDone=null;done();}
  }
  async play(c,blob,revision,speaker='assistant',text='') {
    if(c.ended||this.audible()!==c.id||revision!==c.revision)return;
    this.stopAudio();const token=this.playToken,a=this.player=this.player||new Audio();
    this.audioURL=URL.createObjectURL(blob);this.audioCallId=c.id;this.audioSpeaker=speaker;
    this.voiceFor(speaker);if('preservesPitch' in a)a.preservesPitch=false;a.playbackRate=speaker==='caller'?c.voiceRate||1:1;a.src=this.audioURL;
    // Callbacks from a replaced clip must not stop or annotate the current one.
    const current=()=>token===this.playToken&&!this.disposed;
    const update=()=>{if(current())this.setState({playback:{callId:c.id,category:c.sc.cat,speaker,text,
      current:a.currentTime||0,duration:Number.isFinite(a.duration)?a.duration:0,paused:a.paused}});};
    a.ontimeupdate=update;a.onloadedmetadata=update;a.onpause=update;a.onplay=update;update();
    // Silence between consecutive speakers of this call, exported for latency review.
    a.onplaying=()=>{if(!current())return;this.audioBlocked=false;const last=c.lastSpeech;c.lastSpeech=null;
      if(last&&performance.now()-last.at<15000&&c.gaps.length<500)c.gaps.push({from:last.speaker,to:speaker,ms:Math.round(performance.now()-last.at)});};
    await new Promise(resolve=>{
      this.audioDone=resolve;
      a.onended=()=>{if(current()){c.lastSpeech={speaker,at:performance.now()};this.stopAudio();}};
      a.onerror=()=>{if(current()){this.append(c,'Système','Lecture audio indisponible ; le texte reste disponible.','audio_error');this.stopAudio();}};
      a.play().catch(e=>{if(!current())return;
        // Keep the clip loaded: the next click anywhere resumes it and the conversation.
        if(e.name==='NotAllowedError'){this.audioBlocked=true;this.audioUnlocked=false;update();
          this.append(c,'Système','Son bloqué par le navigateur : cliquez dans la page pour l’activer.','audio_error');return;}
        if(e.name!=='AbortError')this.append(c,'Système','Lecture audio indisponible ; le texte reste disponible.','audio_error');
        this.stopAudio();});
    });
  }
  canAdvance(c,manual=false) {
    if(c.ti<c.scenario.length)return true;
    if(!c.callerFacts)return false;
    return manual||c.takenOver?c.ti<MAX_TURNS:c.auto&&c.ti<AUTO_TURNS&&Date.now()-c.started<c.targetDurationMs;
  }
  nextScenario(c=this.sel(),manual=false) {
    if(!c||c.busy||c.ended||!this.canAdvance(c,manual))return;
    return this.run(c,()=>this.callerTurn(c));
  }
  async callerTurn(c) {
    // An unanswered caller line (e.g. after handback) gets the AI reply first.
    if(c.ti>0&&!c.takenOver&&this.dialogue(c).at(-1)?.role==='caller')return this.analyzeCall(c);
    let text,blob=null,sample=null;
    if(c.ti>0&&c.callerFacts){
      const p=c.prefetch,valid=()=>p&&p.rev===c.revision&&p.len===this.dialogue(c).length;c.prefetch=null;
      const ready=valid()?await p.promise:null;if(c.ended)return;
      if(ready&&valid())({text,blob,sample}=ready);
      else{this.setPhase(c,'compose');({text,blob,sample}=await this.callerLine(c,this.callerContext(c),'réponse contextuelle'));if(c.ended)return;}
    } else {const u=c.scenario[Math.min(c.ti,c.scenario.length-1)];text=typeof u==='string'?u:u.text;}
    if(!blob){blob=await this.tts(c,text,'caller');if(c.ended)return;}
    // The scripted opening line is not a measurement of any site; the rest of the turn is still timed.
    sample=sample||{location:c.location||'local',requested:c.location||'local',fallback:false,scripted:true};
    // Natural turn-taking: a short beat after the previous speaker, never a long wait.
    const wait=c.lastSpeech?TURN_GAP_MS-(performance.now()-c.lastSpeech.at):0;
    if(wait>0){await sleep(wait);if(c.ended)return;}
    // Current revision: after a takeover the caller still finishes what they were saying.
    const speaking=this.play(c,blob,c.revision,'caller',text);
    const recognized=await this.transcribe(c,blob,'scenario.wav');if(c.ended)return;
    sample.stt_ms=c.lastStt?.ms??null;
    c.ti++;this.append(c,'Appelant',recognized,'scenario_audio_stt',{said:text});c.callerLineAt=performance.now();
    await this.analyzeCall(c,speaking,sample);
  }
  // One line of the simulated caller, timed for the latency log. With caller sites configured (ORANGE_CALLERS) the
  // service at c.location generates and speaks it, and the audio arrives with the text; the gateway's built-in caller
  // answers with text only, which /api/tts then speaks here. The gateway says which one actually answered (fallback).
  async callerLine(c,messages,args) {
    const site=c.location||'local';const t=this.tool(c,'Appelant · '+this.siteName(site),args),t0=performance.now();
    let d;
    try{
      const r=await this.api(c,'/api/caller',{facts:c.callerFacts,style:c.voiceStyle,voice:c.voice,emotion:this.state.emotions!==false,messages,location:site,call:c.id,turn:c.ti});
      d=await r.json();
    }catch(e){if(t.status==='running'){t.status=c.ended?'cancelled':'error';t.result=c.ended?'annulé':e.message;}throw e;}
    const used=d.location||'local',tm=d.timings||{};
    this.done(t,d.ms+' ms'+(used!==site?' · '+this.siteName(used):'')+(d.fallback?' · repli sur la passerelle':''));
    const sample={location:used,requested:site,fallback:!!d.fallback,reason:d.fallback_reason||null,llm_ms:tm.llm_ms??d.ms??null,tts_ms:tm.tts_ms??null,network_ms:tm.network_ms??null};
    let blob=d.audio?wavBlob(d.audio):null;
    if(c.ended)return {text:d.text,blob,sample};
    if(!blob){blob=await this.tts(c,d.text,'caller');sample.tts_ms=c.lastTts?.ms??null;}
    sample.caller_ms=Math.round(performance.now()-t0);
    c.lastCaller={...sample,at:Date.now(),model:d.model||null};
    return {text:d.text,blob,sample};
  }
  // Prepare the simulated caller's next line while the previous speaker is still talking.
  prefetchCaller(c,pending) {
    if(!c.callerFacts||c.ended)return;
    const messages=[...this.callerContext(c),...(pending?[pending]:[])].slice(-16);
    const p={rev:c.revision,len:this.dialogue(c).length+(pending?1:0)};
    p.promise=this.callerLine(c,messages,'préparée pendant la lecture').catch(()=>null);
    c.prefetch=p;
  }
  // Per-turn latency: who produced the caller's line (site or built-in caller), how long it took, and the console's own
  // steps (transcription, analysis, AI voice). Kept on the call (copilot, export) and posted to the gateway, which
  // aggregates it per site (GET /api/latency, tools/db_report.py --latency).
  recordLatency(c,sample) {
    if(!sample)return;
    const row={call:c.id,turn:c.ti,base:this.started,at:Date.now(),...sample};
    (c.latency=c.latency||[]).push(row);if(c.latency.length>60)c.latency.shift();
    if(typeof fetch!=='function')return;
    fetch('/api/latency',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)})
      .then(()=>{if(!this.disposed&&Date.now()-(this.latencyRefreshedAt||0)>5000)this.refreshLatency();}).catch(()=>{});
  }
  dialogue(c) {return c.tr.filter(t=>['Appelant','Agent IA','Vous'].includes(t.who)).map(t=>({role:t.who==='Appelant'?'caller':t.who==='Vous'?'operator':'assistant',text:t.text}));}
  // The simulated caller remembers what it actually said, not the STT rendering of it.
  callerContext(c) {return c.tr.filter(t=>['Appelant','Agent IA','Vous'].includes(t.who)).slice(-16)
    .map(t=>({role:t.who==='Appelant'?'caller':t.who==='Vous'?'operator':'assistant',text:t.said||t.text}));}
  analysisContext(c) {
    // Stay inside the gateway's 60-message / 24k-character limit and, as JSON, under the proxy's 20k scan
    // size (a redaction above it becomes a block); keep the opening.
    const all=this.dialogue(c);if(!all.length)return all;
    const out=[];let budget=14000-all[0].text.length;
    for(let i=all.length-1;i>0&&out.length<59;i--){if((budget-=all[i].text.length)<0)break;out.unshift(all[i]);}
    return [all[0],...out];
  }
  async analyzeCall(c,beforeSpeech=Promise.resolve(),sample=null) {
    this.setPhase(c,'think');const t=this.tool(c,this.labels().llm,'extraction + résumé');
    const r=await this.api(c,'/api/analyze',{messages:this.analysisContext(c),call:c.id,turn:c.ti,actions:this.doneActions(c)});const d=await r.json();
    if(c.ended)return;
    const verdict=d.guardrail?.configured?' · garde-fou : '+this.guardLabel(d.guardrail):'';
    this.done(t,d.ms+' ms · citations vérifiées · résumé à valider'+verdict);c.lastAnalysis=d;if(d.guardrail?.configured)c.guardrail={...d.guardrail,at:new Date().toISOString()};
    sample=sample||{location:c.location||'local',requested:c.location||'local',fallback:false};sample.analyze_ms=t.ms;
    // Who is answering this turn: the AI, or the operator who took the call over (their reaction and voice were measured in respond()).
    if(c.opSample){Object.assign(sample,c.opSample);c.opSample=null;}
    sample.handler=sample.handler||(c.takenOver?'operator':'ai');
    c.summary=d.summary;c.facts=mergeFacts(c.facts,d.facts);c.suggestion=d.reply;c.score=d.signals.length?85:40;
    this.proposeTools(c,d.tools);
    const fresh=d.signals.filter(q=>!c.seenSignals.includes(q));c.seenSignals.push(...fresh);
    c.why=d.signals.length?'Signal à vérifier : « '+(fresh[0]||d.signals[0])+' »':'Évaluation humaine requise ; absence de signal ≠ absence de danger.';
    // Every call requires human review; the model cannot clear or close it.
    // « Laisser l'IA continuer » holds until a new signal appears.
    if(!c.takenOver&&(!c.snoozed||fresh.length)){if(!c.alerted)c.alertAt=this.state.shift;c.alerted=true;c.snoozed=false;}
    this.placeLine(c);
    if(c.takenOver){this.recordLatency(c,sample);this.setPhase(c,'operator');return;}
    const rev=c.revision;let voice=null;
    // Nobody hears a call that is not selected, so its reply needs no voice synthesis — except a real caller on the line.
    if(c.id===this.audible()||c.lineId){
      this.setPhase(c,'tts');voice=await this.tts(c,d.reply);sample.reply_tts_ms=c.lastTts?.ms??null;
      if(c.auto&&c.id===this.audible()&&rev===c.revision&&!c.ended&&this.canAdvance(c))this.prefetchCaller(c,{role:'assistant',text:d.reply});
    }
    this.recordLatency(c,sample);
    await beforeSpeech;
    if(c.ended||c.takenOver||rev!==c.revision)return;
    this.append(c,'Agent IA',d.reply,'contextual_gemma');
    if(c.lineId&&voice)this.deliver(c,voice,d.reply,'assistant');  // to the phone; played here too when the call is open
    if(voice)await this.play(c,voice,rev,'assistant',d.reply);
    if(!c.ended)this.setPhase(c,c.takenOver?'operator':'gap');
  }
  submitText(c,text,who='Appelant') {
    text=(text||'').trim();if(!c||!text||c.ended||this.recording||text.length>3000)return;
    this.setState({opText:''});
    if(who==='Vous'&&!c.opSubmittedAt)c.opSubmittedAt=performance.now();  // the operator's answer is ready (typed), even if it waits for the line
    if(c.busy){c.queued=c.queued?.who===who?{who,text:c.queued.text+' '+text}:{who,text};this.touch();return;}
    return this.run(c,async()=>{this.append(c,who,text,'typed_test');await this.respond(c,who,text);});
  }
  async respond(c,who,text) {
    if(who==='Vous'){
      const rev=c.revision;this.setPhase(c,'tts');
      // The operator's own latency, kept apart from the AI's: reaction time from the caller's last words (end of their
      // audio, else their transcript) to the answer, then the voice synthesis; the mic transcription when they spoke.
      const since=Math.max(c.callerLineAt||0,c.lastSpeech?.speaker==='caller'?c.lastSpeech.at:0);
      const reacted=since?Math.max(0,Math.round((c.opSubmittedAt||performance.now())-since)):null;
      const b=await this.tts(c,text,'operator');
      c.opSample={handler:'operator',operator_ms:reacted,op_tts_ms:c.lastTts?.ms??null,op_stt_ms:c.opStt??null};c.opStt=null;c.opSubmittedAt=null;
      if(c.lineId)this.deliver(c,b,text,'operator');
      // A scenario caller answers the operator; that answer is prepared while the operator speaks.
      const answer=!!c.callerFacts&&this.canAdvance(c,true);
      if(answer)this.prefetchCaller(c);
      await this.play(c,b,rev,'operator',text);
      if(answer&&!c.ended)return this.callerTurn(c);
      // A real caller answers in their own time: the operator's turn is complete, record it now.
      if(c.lineId){this.recordLatency(c,{location:'ligne',requested:'ligne',fallback:false,...c.opSample});c.opSample=null;this.setPhase(c,'operator');return;}
    }
    if(this.dialogue(c).some(m=>m.role==='caller'))await this.analyzeCall(c);
    else this.setPhase(c,'operator');
  }
  sayOp(text) {const c=this.sel();return this.submitText(c,text,c?.takenOver?'Vous':'Appelant');}
  async toggleMic(who) {
    if(this.recording){this.recording.rec.stop();return;}
    const c=this.sel();if(!c||c.ended||c.busy||this.micPending)return;
    who=who||(c.takenOver?'Vous':'Appelant');
    this.stopAudio();const request=(this.micRequestId||0)+1;this.micRequestId=request;this.micPending=request;this.touch();const id=c.id;
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Micro indisponible : HTTPS et autorisation du navigateur requis.');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(request!==this.micRequestId||c.ended||this.sel()?.id!==id||this.disposed){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
      if(!mime){stream.getTracks().forEach(t=>t.stop());throw Error('Format micro non pris en charge.');}
      const rec=new MediaRecorder(stream,{mimeType:mime});const chunks=[];
      const capture={rec,stream,c,cancelled:false,who,mime,started:Date.now(),startedPerf:performance.now()};this.recording=capture;
      rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      rec.onerror=()=>{capture.cancelled=true;stream.getTracks().forEach(t=>t.stop());this.recording=null;clearTimeout(this.micTimer);this.setState({mic:false});this.fail(c,Error('Échec capture micro.'));};
      rec.onstop=async()=>{
        clearTimeout(this.micTimer);stream.getTracks().forEach(t=>t.stop());if(this.recording===capture)this.recording=null;
        if(!this.disposed)this.setState({mic:false});
        if(capture.cancelled||c.ended||this.disposed)return;
        await this.run(c,async()=>{
          const blob=new Blob(chunks,{type:mime});if(blob.size<100)throw Error('Enregistrement vide.');
          const text=await this.transcribe(c,blob,mime.includes('mp4')?'micro.mp4':'micro.webm');
          if(c.ended)return;
          if(who==='Vous'){c.opSubmittedAt=capture.startedPerf;c.opStt=c.lastStt?.ms??null;}  // the operator reacted when they started speaking
          this.append(c,who,text,'microphone_stt');await this.respond(c,who,text);
        });
      };
      rec.start();this.setPhase(c,'gap');this.setState({mic:true});this.micTimer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},30000);
    } catch(e){if(request===this.micRequestId){
      const message=({NotAllowedError:'Micro refusé. Autorisez le microphone dans votre navigateur, puis cliquez sur Parler.',
        NotFoundError:'Aucun microphone trouvé. Branchez un micro ou saisissez votre phrase.',
        NotReadableError:'Microphone occupé ou indisponible. Fermez les autres applications qui l’utilisent, puis réessayez.'})[e.name];
      this.fail(c,message?Error(message):e);this.setState({mic:false});
    }}finally{if(request===this.micRequestId){this.micPending=false;this.touch();}}
  }
  cancelRecording() {
    this.micRequestId=(this.micRequestId||0)+1;this.micPending=false;
    if(this.recording){const cap=this.recording;cap.cancelled=true;try{cap.rec.stop();}catch(_){}cap.stream.getTracks().forEach(t=>t.stop());this.recording=null;}
    clearTimeout(this.micTimer);if(!this.disposed)this.setState({mic:false});
  }
  open(id) {
    this.cancelRecording();
    if(this.audioCallId&&this.audioCallId!==id)this.stopAudio();
    // Selecting a call is what enables its sound; its next turn starts right away.
    this.unlockAudio();this.setState({selId:id,view:'call',opText:''},()=>this.pumpSession());
  }
  goFloor() {this.cancelRecording();this.stopAudio();this.setState({view:'floor',opText:''});}
  takeOverCall(c) {
    if(!c||c.ended||c.takenOver||c.liveCaller)return;this.cancelRecording();
    // The caller may finish the sentence in progress; automatic AI speech stops now.
    if(this.audioCallId===c.id&&this.audioSpeaker==='assistant')this.stopAudio();
    c.revision++;c.prefetch=null;c.takenOver=true;c.takenAt=this.state.shift;c.alerted=false;c.snoozed=false;
    this.append(c,'Système','Vous avez pris l’appel · l’IA suggère, vous répondez.','operator_takeover');
    c.audit.push({action:'takeover',at:new Date().toISOString()});if(!c.busy)this.setPhase(c,'operator');
  }
  handBackCall(c) {
    if(!c||c.ended||!c.takenOver)return;this.cancelRecording();c.revision++;c.takenOver=false;if(c.phase==='blocked')c.phase='gap';
    this.append(c,'Système','Prise en charge IA rétablie.','operator_handback');
    c.audit.push({action:'handback',at:new Date().toISOString()});
    if(c.busy)return;
    const pending=this.dialogue(c).at(-1)?.role==='caller',s=this.state.session;
    // No running session can continue this sample: answer the caller, then close it for review.
    if(c.auto&&!(c.sessionId===s.id&&['running','paused'].includes(s.status))){
      this.run(c,async()=>{if(pending)await this.analyzeCall(c);this.endCall(c,'Session close · à revoir');});return;}
    // An unanswered caller line gets the AI reply before the sample continues.
    if(pending)this.run(c,()=>this.analyzeCall(c));else this.setPhase(c,'gap');
  }
  endCall(c,label='Clôturé') {
    if(!c||c.ended)return;c.ended=true;c.revision++;c.endedAt=this.state.shift;c.endLabel=label;c.phase='ended';c.prefetch=c.queued=null;
    c.controllers.forEach(x=>x.abort());
    c.tools.filter(t=>t.status==='running').forEach(t=>{t.status='cancelled';t.result='annulé';});
    if(this.recording?.c===c)this.cancelRecording();
    if(this.audioCallId===c.id)this.stopAudio();
    if(c.lineId&&typeof fetch==='function')fetch('/api/line/'+c.lineId+'/end',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});  // the phone hears the end
    if(c.auto&&c.sessionId===this.state.session.id){
      this.state.session.finished++;
      if(label.startsWith('Échec'))this.state.session.failed++;
    }
    c.audit.push({action:'close',at:new Date().toISOString()});this.touch();
  }
  // Case lifecycle: an ended call waits under « Clôturés » until the operator has reviewed it; closing the case files it.
  closeCase(c) {
    if(!c||!c.ended||c.reviewed)return;
    c.reviewed=true;c.reviewedAt=this.state.shift;c.revision++;
    this.append(c,'Système','Dossier clos par l’opérateur après relecture.','case_closed');
    c.audit.push({action:'case_closed',actor:'demo_operator',at:new Date().toISOString(),external_action:false});
    if(this.state.view==='call'&&this.state.selId===c.id)this.goFloor();else this.touch();
  }
  // ---------------- Tool calls proposed by the AI (copilot « Actions · outils ») ----------------
  // The address lookup runs at once (read-only, the national address base). Dispatch tools wait for the operator's
  // validation and are then recorded as simulated decisions — nothing is transmitted, the spoken reply never says otherwise.
  // The header's place line and the « Adresse » row: the address base's match once a lookup found one, else the caller's words.
  verifiedAddress(c) {const a=(c.actions||[]).filter(x=>x.tool==='lookup_address'&&x.status==='done'&&x.result?.label).at(-1);return a?a.result:null;}
  placeLine(c) {
    const place=c.facts.find(f=>f.k==='Lieu'),v=this.verifiedAddress(c);
    c.sc.place=v?'Vérifié : '+v.label:place?'Déclaré : '+place.v:'Lieu non renseigné';
    const info=c.info&&c.info.find(f=>f.k==='Adresse');
    if(info)info.v=v?`Vérifiée (${v.source||'base adresse'}) : ${v.label}${v.score!=null?' · confiance '+Math.round(v.score*100)+' %':''}`:place?'Déclarée, non vérifiée : '+place.v:'Non confirmée';
  }
  // What the operator validated so far, for the AI's next line: done tool calls (service dispatched, address verified).
  doneActions(c) {return (c.actions||[]).filter(a=>a.status==='done').map(a=>({tool:a.tool,status:'done',label:a.result?.label||null}));}
  proposeTools(c,tools) {
    if(!Array.isArray(tools))return;c.actions=c.actions||[];
    for(const t of tools){
      const key=t.tool+(t.args?.address?' · '+t.args.address:'');
      if(c.actions.some(a=>a.key===key||(a.kind==='dispatch'&&a.tool===t.tool)))continue;  // proposed once; a declined dispatch is not re-proposed
      const a={id:'A'+(++this.actionSeq||(this.actionSeq=1)),key,tool:t.tool,label:t.label,kind:t.kind,args:t.args||{},reason:t.reason||'',status:'proposed',by:'ia',at:this.state.shift,turn:c.ti,result:null,note:null,ms:null};
      c.actions.push(a);
      if(a.kind==='lookup')this.runTool(c,a);
    }
    this.touch();
  }
  async runTool(c,a,approve=false) {
    a.status='running';this.touch();const t0=performance.now();
    try{
      const r=await this.api(c,'/api/tool',{call:c.id,turn:c.ti,tool:a.tool,args:a.args,approve});const d=await r.json();
      a.status=d.status==='error'?'error':'done';a.result=d.result??null;a.note=d.note||d.error||null;a.simulated=!!d.simulated;a.ms=d.ms??Math.round(performance.now()-t0);a.doneAt=this.state.shift;
      if(a.tool==='lookup_address')this.placeLine(c);
      if(a.kind==='dispatch'&&a.status==='done'){
        c.audit.push({action:'simulated_dispatch',tool:a.tool,actor:'demo_operator',at:new Date().toISOString(),external_action:false});
        this.append(c,'Système',a.label+' · décision enregistrée (simulation, aucune transmission aux secours).','simulated_dispatch');
      }
    }catch(e){if(e.name==='AbortError')return;a.status='error';a.note=e.message;}
    this.touch();
  }
  approveTool(c,a) {if(a.status!=='proposed'||c.ended)return;a.by='opérateur';return this.runTool(c,a,true);}
  declineTool(c,a) {if(a.status!=='proposed')return;a.status='declined';a.by='opérateur';a.doneAt=this.state.shift;c.audit.push({action:'tool_declined',tool:a.tool,actor:'demo_operator',at:new Date().toISOString()});this.touch();}
  actionsBlock(c) {
    const acts=c.actions||[],words={proposed:'à valider',running:'en cours…',done:'fait',declined:'refusé',error:'échec'};
    const rows=acts.slice().reverse().slice(0,8).map(a=>h('div',{key:a.id,className:'oc-action oc-action-'+a.status},
      h('div',{className:'oc-actionhead'},h('span',{className:'oc-actionname'},a.label),
        h('span',{className:'oc-actionstatus'},(a.kind==='dispatch'&&a.status==='done'?'simulation · ':'')+words[a.status]+(a.ms!=null&&a.status==='done'?' · '+fmtMs(a.ms):''))),
      a.args?.address?h('span',{className:'oc-muted oc-ellipsis'},'« '+a.args.address+' »'):a.reason?h('span',{className:'oc-muted oc-ellipsis'},a.reason):null,
      a.result?.label?h('span',{className:'oc-actionresult'},'→ '+a.result.label+(a.result.score!=null?' · confiance '+Math.round(a.result.score*100)+' %':'')):
        a.result?.note?h('span',{className:'oc-muted'},a.result.note):a.note?h('span',{className:'oc-muted'},a.note):null,
      a.status==='proposed'&&a.kind==='dispatch'&&!c.ended?h('div',{className:'oc-actions'},
        this.button('Valider',()=>this.approveTool(c,a),false,'orange-approve-'+a.id,'Enregistre la décision · simulation, aucune transmission aux secours',{emphasis:true}),
        this.button('Refuser',()=>this.declineTool(c,a),false,'orange-decline-'+a.id,undefined,{tone:'quiet'})):null));
    // The call's decisions end here too: the free-form decision while the call is live, filing the case once it ended.
    const footer=c.ended?(c.reviewed?[h('span',{key:'closed',className:'oc-end'},'Dossier clos · '+fmt(c.reviewedAt))]
        :[h('div',{key:'close',className:'oc-actions'},this.button('Clore le dossier',()=>this.closeCase(c),false,'orange-close-case',undefined,{emphasis:true})),
          h('span',{key:'end',className:'oc-muted'},c.endLabel+' · relecture, puis clôture du dossier')])
      :[h('div',{key:'other',className:'oc-actions'},this.button('Autre décision…',()=>this.dispatch(),false,'orange-decision','Enregistre une décision opérateur · démonstration, aucune transmission aux secours',{tone:'quiet'}))];
    return h('div',{key:'Actions',className:'oc-block'},h('span',{className:'oc-h'},'Actions'+(acts.length?' · '+acts.length:'')),
      ...(rows.length?rows:c.ended?[]:[h('span',{className:'oc-muted'},'Les actions proposées par l’IA apparaissent ici : adresse, secours à valider.')]),...footer);
  }
  dispatch() {
    const c=this.sel();if(!c||c.ended)return;
    if(!window.confirm('Enregistrer la décision opérateur ? Environnement de démonstration : aucune transmission aux secours.'))return;
    this.append(c,'Système','Décision opérateur enregistrée localement · aucune transmission aux secours (environnement de démonstration).','simulated_dispatch');
    c.audit.push({action:'simulated_dispatch',actor:'demo_operator',at:new Date().toISOString(),external_action:false});
    this.endCall(c,'Décision enregistrée');
  }
  download() {
    const data={mode:'demonstration',exported_at:new Date().toISOString(),dispatch_connected:false,session:this.state.session,
      caller_sites:(this.state.callers||[]).map(s=>s.name),latency:this.state.latency,
      calls:this.state.calls.map(({controllers,prefetch,queued,lastSpeech,lastTts,lastStt,lineQueue,linePolling,opSample,...c})=>c)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='orange-session-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  // ---------------- Persistence: the gateway keeps the vacation so a reload restores it ----------------
  // One tab owns the vacation (its id lives in sessionStorage, so a reload keeps it). A second tab that finds a live
  // owner gets the vacation read-only (paused) with a notice; « Reprendre » there takes it over explicitly.
  ownerId() {
    try{let id=sessionStorage.getItem('orange-owner');if(!id){id=crypto.randomUUID();sessionStorage.setItem('orange-owner',id);}return id;}
    catch(e){return this.tabId||(this.tabId=String(Math.random()).slice(2));}
  }
  // Serializable state only: no abort controllers, prefetched audio, queued speech or transient busy flags.
  snapshot() {
    return {owner:this.ownerId(),takeover:!!this.takeover,startedAt:this.started,session:this.state.session,seq:this.seq,scIdx:this.scIdx,
      calls:this.state.calls.map(({controllers,prefetch,queued,lastSpeech,busy,lastTts,lastStt,lineQueue,linePolling,opSample,...c})=>c)};
  }
  persist(final=false) {
    if(this.disposed||this.restoring||this.readOnly||this.state.session.status==='idle'&&!this.state.calls.length)return;
    const body=JSON.stringify(this.snapshot());if(body===this.lastPersisted)return;
    this.lastPersisted=body;
    fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:final&&body.length<60000}).then(r=>{
      if(this.disposed)return;
      if(r.status===409){this.readOnly=true;const s=this.state.session;
        this.setState({session:s.status==='running'?{...s,status:'paused'}:s,notice:'Session reprise depuis un autre poste · lecture seule ici'});}
      else if(r.ok)this.takeover=false;
      else this.lastPersisted=null;
    }).catch(()=>{this.lastPersisted=null;});
  }
  async restore() {
    try{
      const r=await fetch('/api/session',{signal:AbortSignal.timeout(10000)});if(r.status!==200)return false;
      const s=await r.json();if(!s||!s.session||!Array.isArray(s.calls)||s.session.status==='idle'&&!s.calls.length)return false;
      this.readOnly=s.owner!==this.ownerId()&&Date.now()/1000-(s.savedAt||0)<15;
      this.started=s.startedAt||this.started; // shift-based stamps (alerts, closures, reviews) keep their base
      this.seq=Math.max(this.seq,s.seq||0,...s.calls.map(c=>c.n||0));this.scIdx=Math.max(this.scIdx,s.scIdx||0);
      this.nextArrivalAt=Date.now()+ARRIVAL_MS;
      const now=Date.now();
      const calls=s.calls.map(c=>{const call={...c,controllers:new Set(),prefetch:null,queued:null,busy:false,t:now-c.started,latency:c.latency||[],
          phone:c.phone&&c.phone.startsWith('+')?c.phone:fakePhone(c.sampleId||c.id),  // snapshots from before the fictional numbers
          actions:(c.actions||[]).map(a=>a.status==='running'?{...a,status:'error',note:'interrompu au rechargement'}:a),
          phase:c.ended?'ended':['caller','think','tts','compose'].includes(c.phase)?'gap':c.phase};
        call.tools.forEach(t=>{if(t.status==='running'){t.status='cancelled';t.result='interrompu au rechargement';}});
        // A live microphone capture does not survive a reload.
        if(call.liveCaller&&!call.ended){call.ended=true;call.phase='ended';call.endLabel='Appel de test interrompu';call.endedAt=now-this.started;}
        return call;});
      const session={...s.session,status:this.readOnly&&s.session.status==='running'?'paused':s.session.status};
      this.setState({calls,session,view:'floor',selId:null,shift:now-this.started,notice:this.readOnly?'Session suivie depuis un autre poste · lecture seule ici':null},()=>this.pumpSession());
      this.lastPersisted=null;return true;
    }catch(e){return false;}
  }
  resetAll() {
    if(!window.confirm('Effacer la session enregistrée sur la passerelle et recharger la page ?'))return;
    this.readOnly=true;
    fetch('/api/session/clear',{method:'POST'}).catch(()=>{}).finally(()=>location.reload());
  }
  // ---------------- Mobile line: a real caller on a phone (page /appel) ----------------
  // The gateway lists the lines that are ringing; the console adopts each as an incoming call, then pulls its events
  // every second: the caller's recordings (transcribed, answered by the AI or by the operator who took the call) and the
  // hang-up. Replies are posted back as audio for the phone to play (deliver()).
  lineFetch(path,init) {
    const signal=typeof AbortSignal!=='undefined'&&AbortSignal.timeout?AbortSignal.timeout(10000):undefined;
    return fetch(path,{...(init||{}),...(signal?{signal}:{})});
  }
  async pollLines() {
    if(this.disposed||this.readOnly||this.linesBusy||typeof fetch!=='function')return;this.linesBusy=true;
    try{const r=await this.lineFetch('/api/line/pending');if(!r.ok)return;const d=await r.json();
      for(const l of d.lines||[])if(!this.state.calls.some(c=>c.lineId===l.id))this.adoptLine(l);
    }catch(e){}finally{this.linesBusy=false;}
  }
  adoptLine(l) {
    const c=this.createCall(false,{background:true,line:l});if(!c)return null;  // four manual calls at most: the line keeps ringing
    this.append(c,'Système','Appel réel depuis un téléphone (ligne mobile de démonstration). Rien n’est transmis aux secours.','line_open');
    c.alerted=true;c.alertAt=this.state.shift;  // a person is waiting: straight to « À traiter »
    if(typeof fetch==='function')fetch('/api/line/'+l.id+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({call:c.id})}).catch(()=>{});
    this.touch();return c;
  }
  pollLineEvents() {
    if(this.disposed||this.readOnly||typeof fetch!=='function')return;
    for(const c of this.state.calls.filter(c=>c.lineId&&!c.ended&&!c.linePolling)){
      c.linePolling=true;
      (async()=>{try{
        const r=await this.lineFetch('/api/line/'+c.lineId+'/events?since='+(c.lineSeen||0));if(!r.ok)return;const d=await r.json();
        for(const e of d.events||[]){c.lineSeen=Math.max(c.lineSeen||0,e.idx+1);
          if(e.type==='speech')this.lineSpeech(c,e);
          else if(e.type==='end'&&e.by!=='console'&&!c.ended){this.append(c,'Système','L’appelant a raccroché.','line_end');this.endCall(c,'Appel terminé · à revoir');}
        }
      }catch(e){}finally{c.linePolling=false;}})();
    }
  }
  // One recording from the phone: fetched, played to the operator when the call is open, transcribed, then answered
  // by the AI (or left to the operator who took the call; the AI only suggests).
  lineSpeech(c,e) {
    if(c.ended)return;
    if(c.busy){(c.lineQueue=c.lineQueue||[]).push(e);return;}
    return this.run(c,async()=>{
      const r=await this.lineFetch('/api/line/'+c.lineId+'/audio/'+e.idx);if(!r.ok)throw Error('Enregistrement de l’appelant indisponible.');
      const blob=await r.blob();if(c.ended)return;
      const speaking=this.play(c,blob,c.revision,'caller','');
      const text=await this.transcribe(c,blob,e.filename||'speech.webm');if(c.ended)return;
      this.append(c,'Appelant',text,'line_stt');c.callerLineAt=performance.now();
      await this.analyzeCall(c,speaking,{location:'ligne',requested:'ligne',fallback:false,handler:c.takenOver?'operator':'ai',stt_ms:c.lastStt?.ms??null});
    });
  }
  deliver(c,blob,text,speaker) {
    if(!c.lineId||typeof fetch!=='function')return Promise.resolve();
    return fetch('/api/line/'+c.lineId+'/reply',{method:'POST',headers:{'Content-Type':'audio/wav','X-Text':encodeURIComponent(text||''),'X-Speaker':speaker},body:blob}).catch(()=>{});
  }
  // ---------------- Rendering: one console (list · selected call · copilot) over the mockup's header ----------------
  // One button system (NVIDIA Elements) everywhere, styled per theme through its CSS variables.
  // opts: emphasis (primary), tone 'quiet' | 'danger' | 'ai', key when the label changes, size.
  button(label,action,disabled=false,id,title,opts={}) {
    const emphasis=opts.emphasis||id==='orange-start-session';
    return h('nve-button',{key:id||opts.key||label,id,title,size:opts.size||'sm',...(emphasis?{interaction:'emphasis'}:{}),...(opts.tone?{'data-tone':opts.tone}:{}),
      ref:el=>{if(el){el.disabled=disabled;el.onclick=e=>{e.stopPropagation();if(!disabled)action();};}}},label);
  }
  // The mockup's KUI components (Badge, Button, TextInput) when the bundle exposes them; plain elements otherwise.
  kui(name,props,...children) {
    const lib=globalThis.KuiFoundationsReact,comp=lib&&lib[name];
    if(comp)return h(comp,props,...children);
    const {kind,color,size,...rest}=props||{};
    return h(name==='Badge'?'span':name==='TextInput'?'input':'button',{...rest,'data-kui':name,'data-kind':kind},...children);
  }
  controls() {
    const s=this.state.session,active=['running','paused'].includes(s.status);
    const chip=(key,text,tone,title)=>h('span',{key,className:'oc-chip oc-chip-'+tone,title:title||text,role:'status'},text);
    const services=this.servicesChip(); // null unless something needs attention (the demonstration boundary is stated on the decision action)
    if(s.status==='idle'&&!this.state.calls.length)return h('div',{className:'oc-bar'},h('div',{className:'oc-bartop'},
      h('div',{className:'oc-bargroup'}),h('div',{className:'oc-bargroup oc-barstatus'},services,this.themeButton())));
    const words={running:'en cours',paused:'en pause',completed:'terminée',stopped:'arrêtée'};
    // Counters as figures with quiet labels, behind « Analytique »; the text content stays "n/100 arrivés · n terminés · n échecs · état" for the scripts.
    const kpi=(key,value,label)=>h('span',{key,className:'oc-kpi'},h('b',null,String(value)),label);
    const progress=h('span',{key:'progress',id:'orange-session-progress',role:'status',className:'oc-chip oc-chip-plain oc-kpis'+(s.failed?' oc-chip-warn':'')},
      kpi('a',`${s.launched}/${s.total}`,' arrivés · '),kpi('f',s.finished,' terminés · '),kpi('e',s.failed,' échecs · '),
      h('span',{key:'state',className:'oc-kpistate oc-kpistate-'+s.status},words[s.status]||s.status));
    // Two groups: a narrow window wraps the status group under the actions instead of truncating chips.
    // One dominant action per state (open, or pause/close); unavailable actions are hidden rather than greyed, and
    // everything secondary sits behind two toggles — « Analytique » (counters, latencies) and « Réglages » (theme, voice,
    // export, test calls) — actions on demand.
    const actions=active?[this.button(s.status==='paused'?'Reprendre':'Pause',()=>this.toggleSession(),false,'orange-pause-session'),
        this.button('Clore la session',()=>this.stopSession(),false,'orange-stop-session',undefined,{tone:'quiet'})]
      :[this.button(s.status==='idle'?'Ouvrir la session':'Nouvelle session',()=>this.startSession(),false,'orange-start-session'),
        this.button('Appel de test · micro',()=>this.startUserCall(),false,'orange-user-call',undefined,{tone:'quiet'})];
    const status=[...(this.state.notice?[chip('notice',this.state.notice,'warn')]:[]),services,
      this.button(this.state.analytics?'Analytique ▴':'Analytique ▾',()=>this.setState({analytics:!this.state.analytics}),false,'orange-analytics','Compteurs de la session et latences',{tone:'quiet'}),
      this.button(this.state.settings?'Réglages ▴':'Réglages ▾',()=>this.setState({settings:!this.state.settings}),false,'orange-settings',undefined,{tone:'quiet'})];
    const analytics=this.state.analytics?this.analyticsPanel(progress):null;
    const settings=this.state.settings?h('div',{key:'settings',className:'oc-settings'},
      h('span',{key:'l',className:'oc-h'},'Réglages'),
      this.themeButton(),
      this.sitePolicyButton(),
      this.button('Voix IA : '+(this.state.aiVoice==='fr_female'?'femme':'homme'),()=>this.setState({aiVoice:this.state.aiVoice==='fr_female'?'fr_male':'fr_female'}),false,'orange-ai-voice'),
      this.button('Débit IA : '+this.state.aiPace,()=>this.setState({aiPace:this.state.aiPace==='posé'?'vif':'posé'}),false,'orange-ai-pace'),
      this.button('Voix appelants : '+(this.state.emotions!==false?'émotions':'neutres'),()=>this.setState({emotions:this.state.emotions===false}),false,'orange-emotions','Variantes émotionnelles de la voix selon le profil de l’appel (peur, inquiétude, calme) ou voix neutres.'),
      this.button('Disposition : '+(this.state.layout==='columns'?'colonnes':'plein écran'),()=>{const layout=this.state.layout==='columns'?'focus':'columns';try{localStorage.setItem('orange-layout',layout);}catch(e){}this.setState({layout});},false,'orange-layout','La liste des appels et un appel en grand avec les décisions, ou la console en trois colonnes.'),
      this.button('Sonnerie d’arrivée : '+(this.state.tones?'oui':'non'),()=>this.setState({tones:!this.state.tones}),false,'orange-tones'),
      this.button('Exporter le journal',()=>this.download(),!this.state.calls.length,'orange-export','Exporter le journal de la session (JSON)'),
      typeof location!=='undefined'?h('span',{key:'line',className:'oc-muted',title:'Une personne peut appeler cette console depuis son téléphone : ouvrez cette adresse sur le mobile (identifiants de la console), puis « Appeler ».'},'Appel réel : '+location.origin+'/appel'):null,
      ...(active?[this.button('Appel de test · micro',()=>this.startUserCall(),false,'orange-user-call')]:[]),
      this.button(this.state.tools?'Masquer les outils de test':'Outils de test',()=>this.setState({tools:!this.state.tools}),false,'orange-tools'),
      ...(this.state.tools?[h('span',{key:'sep',className:'oc-vsep'}),
        this.button('Appel de test · saisie / micro',()=>this.createCall(false),false,'orange-new'),
        this.button('Scénario de test',()=>this.createCall(true),false,'orange-scenario'),
        this.button('STT : '+this.state.stt,()=>{const L=this.labels(),i=L.stt.indexOf(this.state.stt);this.setState({stt:L.stt[(i+1)%L.stt.length]});},!!this.recording||this.labels().stt.length<2,'orange-stt'),
        this.button('Réinitialiser le poste',()=>this.resetAll(),false,'orange-reset')]:[])):null;
    return h('div',{className:'oc-bar'},
      h('div',{key:'top',className:'oc-bartop'},h('div',{key:'actions',className:'oc-bargroup'},...actions),h('div',{key:'status',className:'oc-bargroup oc-barstatus'},...status)),settings,analytics);
  }
  // « Analytique » (bar toggle): the vacation counters and the latency medians (caller per site, console steps), one row.
  analyticsPanel(progress) {
    const lat=this.state.latency,sites=this.state.callers||[];
    const names=[...sites.map(s=>s.name),...(lat?.sites||[]).map(s=>s.name).filter(n=>!sites.some(s=>s.name===n))];
    const perSite=names.map(n=>{const st=(lat?.sites||[]).find(x=>x.name===n);return this.siteName(n)+' '+(st?.caller_ms?fmtMs(st.caller_ms.median):'—');});
    const con=lat?.console,steps=con?[['STT',con.stt_ms],['analyse',con.analyze_ms],['voix IA',con.reply_tts_ms]].filter(([,v])=>v):[];
    const figure=(key,text,title)=>h('span',{key,className:'oc-chip oc-chip-plain oc-kpis',title},text);
    const op=lat?.handlers?.operator,phone=lat?.phone?.phone_ms;
    return h('div',{key:'analytics',className:'oc-settings oc-analytics'},h('span',{key:'l',className:'oc-h'},'Analytique'),progress,
      names.length?figure('sites','Appelant · '+perSite.join(' · '),'Latence médiane de l’appelant simulé par site, derniers tours'):null,
      steps.length?figure('console','Console · '+steps.map(([k,v])=>k+' '+fmtMs(v.median)).join(' · '),'Médianes des étapes de la console'):null,
      op?.operator_ms?figure('operator','Opérateur · réaction '+fmtMs(op.operator_ms.median),'Médiane du temps de réaction de l’opérateur après prise en charge (dernières paroles de l’appelant → réponse)'):null,
      phone?figure('phone','Téléphone · aller-retour '+fmtMs(phone.median),'Médiane du délai mesuré par les téléphones des appelants réels (phrase envoyée → réponse reçue)'):null,
      this.sitesBoard());
  }
  entry() {
    return h('div',{style:{minHeight:'calc(100vh - 180px)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'32px'}},
      h('div',{className:'oc-entrycard'},
      h('h1',{'nve-text':'heading'},'Supervision des appels d’urgence'),
      h('p',{'nve-text':'body muted'},'Plateau de régulation assisté par IA · file de 100 appels entrants'),
      h('div',{className:'oc-pills'},h('span',{className:'oc-pill'},`${AI_CALLS} appels pris en charge en parallèle`),h('span',{className:'oc-pill'},'Transcription et synthèse en temps réel'),h('span',{className:'oc-pill'},'Revue humaine à chaque étape')),
      h('nve-button',{id:'orange-start-session',size:'lg',interaction:'emphasis',
        style:{'--height':'72px','--font-size':'22px','--padding':'0 44px'},
        ref:el=>{if(el)el.onclick=()=>this.startSession();}},'Ouvrir la session'),
      h('p',{'nve-text':'body sm muted'},'Les appels entrants sont pris en charge par l’assistance IA et affichés sans audio. Ouvrez un appel pour l’écouter ou le reprendre.'),
      h('nve-button',{id:'orange-user-call',size:'lg',ref:el=>{if(el)el.onclick=()=>this.startUserCall();}},'Appel de test · microphone'),
      h('p',{'nve-text':'body sm muted'},'Vous tenez le rôle de l’appelant ; l’assistance IA vous répond.')));
  }
  arrivalLabel() {
    const s=this.state.session,wait=Math.ceil(((this.nextArrivalAt||0)-Date.now())/1000);
    return s.status==='paused'?'Session en pause':s.status!=='running'?'Session fermée':
      s.launched>=s.total?`File vide · ${s.total} appels reçus`:this.aiCalls()>=AI_CALLS?`${AI_CALLS} appels en cours · file en attente`:
      wait>0?`Prochain appel dans ${wait} s`:'Prochain appel imminent';
  }
  noAlertsLabel() {
    return ['running','paused'].includes(this.state.session.status)?'Aucun appel à traiter.':'Aucun appel. Ouvrez la session ou lancez un appel de test.';
  }
  activity(c) {const p=this.state.playback;
    return p&&p.callId===c.id&&!p.paused?SPEAKING[p.speaker]:STATUS[c.phase]||'Traitement…';}
  floorStatus(c) {return c.ended?c.endLabel:c.takenOver?'en ligne · opérateur':c.phase==='ringing'?'décroché en cours':'tour '+Math.max(1,c.ti)+' · '+this.activity(c);}
  latestWords(c) {
    const said=[...c.tr].reverse().find(t=>t.who==='Appelant')?.text;
    return said?'« '+(said.length>150?said.slice(0,147)+'…':said)+' »':'Prise d’appel en cours…';
  }
  // A card leads with the signal to check, else the caller's latest words.
  headline(c) {
    if(c.takenOver)return 'Appel en cours · assistance IA active.';
    if(c.phase==='error'||c.phase==='blocked'||c.lastAnalysis?.signals?.length)return c.why;
    return this.latestWords(c);
  }
  decorate(c) {
    const [sev,sevColor]=c.score==null?['Entrant','purple']:SEV(c.score);
    // Progress towards the end of an AI-handled call: 24 turns, or the scripted turns once the sample's duration has elapsed.
    const progress=c.auto&&!c.ended&&!c.takenOver?Math.min(1,Math.max(c.ti/AUTO_TURNS,Math.min(c.ti/Math.max(1,c.scenario.length),c.t/c.targetDurationMs))):null;
    // A real caller's line and the user's own test call keep their names from the start; scenario calls are « new » until analysed.
    return {id:c.id,c,sev,sevColor,progress,category:c.liveCaller||c.lineId?c.sc.cat:c.score==null?'Nouvel appel · évaluation en cours':c.sc.cat,place:c.sc.place,dur:fmt(c.t),
      status:this.floorStatus(c),headline:this.headline(c),selected:c.id===this.state.selId&&this.state.view==='call',fresh:this.state.shift-(c.alertAt??-1e9)<800};
  }
  consoleModel() {
    const S=this.state,live=S.calls.filter(c=>!c.ended);
    return {mine:live.filter(c=>c.takenOver).map(c=>this.decorate(c)),
      alerts:live.filter(c=>c.alerted&&!c.takenOver&&!c.snoozed).sort((a,b)=>b.score-a.score).map(c=>this.decorate(c)),
      ai:live.filter(c=>!c.takenOver&&!(c.alerted&&!c.snoozed)).sort((a,b)=>(b.score??50)-(a.score??50)).map(c=>this.decorate(c)),
      history:S.calls.filter(c=>c.ended&&!c.reviewed).sort((a,b)=>b.endedAt-a.endedAt).map(c=>this.decorate(c)),
      closed:S.calls.filter(c=>c.ended&&c.reviewed).sort((a,b)=>b.reviewedAt-a.reviewedAt).map(c=>this.decorate(c)),live:live.length,arrival:this.arrivalLabel()};
  }
  modeFor(c) {
    const taken=c.takenOver;
    return {title:c.ended?'Appel clôturé':c.liveCaller?'Test · vous êtes l’appelant':c.lineId?(taken?'Vous êtes en ligne · ligne mobile':'IA en ligne · ligne mobile'):taken?'Vous êtes en ligne · IA en appui':c.auto?'IA en ligne':c.callerFacts?'Scénario':'Test · saisie / micro',
      sub:c.ended?c.endLabel+' · historique conservé dans cette session de navigateur.':
        c.liveCaller?'Parler, puis Envoyer ma phrase ; l’assistance IA répond. Micro fermé pendant la réponse, 30 s maximum par prise.':
        c.lineId?(taken?'« Envoyer » ou « Parler » énonce votre réponse sur le téléphone de l’appelant.':'Une personne parle depuis son téléphone (page /appel) ; l’IA lui répond. Prenez l’appel pour répondre vous-même.'):
        taken?'« Envoyer » ou « Parler » énonce votre réponse ; l’appelant répond. « Rendre à l’IA » rétablit la prise en charge automatique.':
        c.auto?'Prenez l’appel pour répondre vous-même. Échap ferme l’écoute.':
        c.callerFacts?'« Réplique suivante » fait parler l’appelant du scénario ; « Envoyer » saisit une réplique.':
        'Saisissez une réplique de l’appelant ou utilisez le micro (appuyer pour démarrer / arrêter).',
      color:taken?OP:c.ended?SEC:BRAND};
  }
  consoleView() {
    if(this.state.session.status==='idle'&&!this.state.calls.length)return this.entry();
    const m=this.consoleModel();
    const a=this.playbackState();
    if(this.state.layout==='focus')return h('div',{id:'orange-console',className:'oc oc-focus','data-speaker':a.role,'data-playing':String(a.playing),'data-call':a.who},this.callList(m),this.focusPane(m));
    return h('div',{id:'orange-console',className:'oc'+(this.state.view==='call'?'':' oc-full'),'data-speaker':a.role,'data-playing':String(a.playing),'data-call':a.who},this.callList(m),this.callPane(m),this.copilot(m));
  }
  // ---------------- Focus layout: the call list on the left, one call full width, the decisions as big buttons ----------------
  // The open call fills the screen: who and where, the conversation, the summary with its facts and signals, then the
  // decisions; the operator's talk box when the call is theirs; the details on demand.
  focusPane(m) {
    const c=this.sel();
    if(!c||this.state.view!=='call')return this.situationBoard(m);
    const d=this.decorate(c),mode=this.modeFor(c),signals=c.lastAnalysis?.signals||[];
    this.placeLine(c);  // the place line follows the facts and the lookup, whatever set them
    const header=h('div',{className:'oc-head oc-fhead'},
      h('div',{className:'oc-top'},this.kui('Badge',{color:d.sevColor,kind:'solid'},d.sev),h('span',{className:'oc-callname'},d.category),
        h('span',{className:'oc-muted oc-ellipsis',title:c.id+' · '+c.phone},c.sc.place),h('span',{className:'oc-fstate',style:{color:mode.color},title:mode.sub},mode.title),h('span',{className:'oc-mono oc-right'},d.dur)));
    const controls=this.callControls();
    // The header runs across the whole width; under it, the conversation on the left and the rounded panel on the right.
    const centre=h('div',{className:'oc-fcenter'},controls?h('div',{className:'oc-ctl'},controls):null,this.transcriptView(c),this.waveRow(c),this.talkBox(c));
    return h('div',{className:'oc-main oc-fmain'},header,h('div',{className:'oc-fwrap'},centre,this.sidePanel(c,signals)));
  }
  // The rounded panel on the right of the conversation: the summary, what to check, the decisions, the details on demand.
  // It folds to a thin rail (the toggle stays, with an orange dot while a proposal of the AI waits for the operator).
  sidePanel(c,signals) {
    const open=this.state.sideOpen!==false,pending=(c.actions||[]).some(a=>a.kind==='dispatch'&&a.status==='proposed');
    const toggle=h('button',{key:'toggle',type:'button',id:'orange-side-toggle',className:'oc-fside-toggle','aria-expanded':String(open),title:open?'Replier le panneau':'Déplier le panneau',
      onClick:()=>this.toggleSide()},open?'›':'‹',pending&&!open?h('span',{className:'oc-fside-dot'}):null);
    if(!open)return h('aside',{className:'oc-fside collapsed'},toggle,h('span',{className:'oc-fside-rail'},'Résumé · décisions'));
    const facts=c.facts.filter(f=>f.k!=='Lieu').map(f=>f.k+' : '+f.v).join(' · ');
    return h('aside',{className:'oc-fside'},toggle,
      h('div',{className:'oc-block'},h('span',{className:'oc-h'},'Résumé'),h('span',{className:'oc-summary',style:{color:c.summary?CALLER:SEC}},c.summary||'En attente des premiers propos de l’appelant.'),
        facts?h('span',{className:'oc-muted'},facts):null),
      signals.length?h('div',{className:'oc-block'},h('span',{className:'oc-h'},'À vérifier'),...signals.map((q,i)=>h('span',{key:i,className:'oc-signal'},'« '+q+' »'))):null,
      this.decisionBar(c),
      this.more('details')?h('div',{className:'oc-fdetails'},this.guardBlock(c),this.latencyBlock(c),this.toolsBlock(c)):null);
  }
  toggleSide() {const sideOpen=this.state.sideOpen===false;try{localStorage.setItem('orange-side',sideOpen?'open':'closed');}catch(e){}this.setState({sideOpen});}
  // The decisions, as big buttons: the three services (an AI proposal is highlighted and one click validates it; otherwise the
  // click is the operator's own decision, recorded the same way, as a simulation), then taking or handing back the call.
  decisionBar(c) {
    const acts=c.actions||[];
    const big=DISPATCH_TOOLS.map(([tool,name,label])=>{const a=acts.filter(x=>x.tool===tool&&x.status!=='declined').at(-1);
      const state=a?.status==='done'?'done':a?.status==='proposed'?'proposed':a?.status==='running'?'running':'idle';
      const sub={done:'déclenché · simulation',proposed:'proposé par l’IA · valider',running:'en cours…',idle:'déclencher'}[state];
      return h('button',{key:tool,type:'button',id:'orange-big-'+tool,className:'oc-big oc-big-'+state,disabled:c.ended||state==='done'||state==='running',title:label+' · décision enregistrée en simulation, aucune transmission aux secours',
        onClick:()=>this.decide(c,tool)},h('span',{className:'oc-bigname'},name),h('span',{className:'oc-bigsub'},sub));});
    const take=c.ended||c.liveCaller?null:c.takenOver
      ?h('button',{key:'take',type:'button',id:'orange-big-take',className:'oc-big oc-big-op',onClick:()=>this.handBackCall(c)},h('span',{className:'oc-bigname'},'Rendre à l’IA'),h('span',{className:'oc-bigsub'},'l’IA reprend la conversation'))
      :h('button',{key:'take',type:'button',id:'orange-big-take',className:'oc-big oc-big-take',onClick:()=>this.takeOverCall(c)},h('span',{className:'oc-bigname'},'Prendre l’appel'),h('span',{className:'oc-bigsub'},'vous répondez, l’IA suggère'));
    const small=h('div',{className:'oc-smallrow'},
      ...(c.ended?(c.reviewed?[h('span',{key:'closed',className:'oc-end'},'Dossier clos · '+fmt(c.reviewedAt))]:[this.button('Clore le dossier',()=>this.closeCase(c),false,'orange-close-case',undefined,{emphasis:true})])
        :[this.button(c.liveCaller?'Terminer mon appel':c.auto?'Clôturer l’appel':'Clôturer le test',()=>this.endCall(c),false,'orange-close',undefined,{tone:'quiet'}),
          this.button('Autre décision…',()=>this.dispatch(),false,'orange-decision','Enregistre une décision opérateur · démonstration, aucune transmission aux secours',{tone:'quiet'})]),
      this.button('Fermer',()=>this.goFloor(),false,undefined,'Retour à la vue d’ensemble · Échap',{tone:'quiet'}),
      this.moreButton('details'));
    return h('div',{className:'oc-decisions'},h('div',{className:'oc-bigrow'},...big,take),small);
  }
  async decide(c,tool) {
    if(c.ended)return;
    c.actions=c.actions||[];
    let a=c.actions.filter(x=>x.tool===tool&&x.status!=='declined').at(-1);
    if(a&&a.status!=='proposed')return;  // done or running: nothing to do twice
    if(!a){const found=DISPATCH_TOOLS.find(t=>t[0]===tool);if(!found)return;
      a={id:'A'+(++this.actionSeq||(this.actionSeq=1)),key:tool,tool,label:found[2],kind:'dispatch',args:{},reason:'décision opérateur',status:'proposed',by:'opérateur',at:this.state.shift,turn:c.ti};c.actions.push(a);}
    await this.approveTool(c,a);
  }
  callList(m) {
    const section=(label,dot,count,extra)=>h('div',{key:'s:'+label,className:'oc-sec'},h('span',{className:'oc-dot',style:{background:dot}}),h('span',null,label),
      h('span',{className:'oc-count'},String(count)),extra?h('span',{className:'oc-secextra'},extra):null);
    const empty=(key,text)=>h('div',{key,className:'oc-emptybox'},text);
    // Cards and rows are real keyboard targets: Tab reaches them, Enter/Space opens (keys on inner buttons are theirs).
    const pressable=id=>({role:'button',tabIndex:0,'data-call':id,onClick:()=>this.open(id),
      onKeyDown:e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();this.open(id);}}});
    // Progressive disclosure: a card shows the category, the duration, one status (or signal) line and the primary action.
    // The chevron — or selecting the call — reveals the caller's latest words, the call id/place and the secondary actions.
    const stop=e=>e.stopPropagation();
    const card=d=>{const key='card:'+d.id,open=key in this.state.more?this.state.more[key]:d.selected;
      const signal=!d.c.takenOver&&(d.c.phase==='error'||d.c.phase==='blocked'||!!d.c.lastAnalysis?.signals?.length);
      // No processing chatter on cards (« tour n · transcription STT »…): the line under the title carries the signal to
      // check, or « en ligne · opérateur » for a call the operator holds; the per-call latency and the primary action
      // share the last line (left empty, no dot, until the first latency is measured).
      const lead=signal?h('div',{key:'lead',className:'oc-cardline'},h('span',{className:'oc-signal oc-ellipsis'},this.voiceMark(d.c),d.headline))
        :d.c.takenOver?h('div',{key:'lead',className:'oc-cardline'},h('span',{className:'oc-status'},this.voiceMark(d.c)||h('span',{className:'oc-dot oc-pulse',style:{background:OP}}),h('span',{className:'oc-ellipsis'},d.status))):null;
      const primary=d.c.liveCaller?this.button('Reprendre mon appel',()=>this.open(d.id),false,'orange-resume-'+d.id)
        :d.c.takenOver?this.button("Rendre à l'IA",()=>this.handBackCall(d.c),false,undefined,undefined,{tone:'quiet'})
        :this.button("Prendre l'appel",()=>{this.takeOverCall(d.c);this.open(d.id);},false,undefined,undefined,{emphasis:true});
      return h('div',{key:d.id,className:'oc-card'+(d.selected?' sel':'')+(d.c.takenOver?' mine':'')+(open?' open':''),...pressable(d.id),style:{animation:d.fresh?'slidein .5s, arrive 1.6s ease-out':'none'}},
        h('div',{className:'oc-top'},this.kui('Badge',{color:d.sevColor,kind:'solid'},d.sev),h('span',{className:'oc-title'},d.category),h('span',{className:'oc-mono oc-right',title:'Durée de l’appel'},d.dur),
          h('button',{type:'button',className:'oc-cardtoggle','aria-expanded':String(open),'aria-label':open?'Réduire':'Détails',title:open?'Réduire':'Détails',
            onClick:e=>{stop(e);this.setState({more:{...this.state.more,[key]:!open}});}},open?'▴':'▾')),
        lead,
        h('div',{className:'oc-cardline'},(open?this.callLatency(d.c):null)||h('span',{className:'oc-status'}),h('span',{className:'oc-cardact',onClick:stop},primary)),
        open?h('div',{className:'oc-cardmore'},
          signal?null:h('div',{className:'oc-quote'},this.latestWords(d.c)),
          h('div',{className:'oc-muted'},d.id+' · '+d.c.phone+(/non renseigné/.test(d.place)?'':' · '+d.place)),
          d.c.liveCaller||d.c.takenOver?null:h('div',{className:'oc-actions',onClick:stop},
            this.button('Plus tard',()=>{d.c.snoozed=true;d.c.alerted=false;this.touch();},false,undefined,'Laisser l’IA continuer ; l’appel revient ici au prochain signal',{tone:'quiet'}))):null,
        d.progress!=null?h('span',{className:'oc-progress',style:{width:Math.round(d.progress*100)+'%'},title:'Avancement de l’appel'}):null);};
    const row=d=>h('div',{key:d.id,className:'oc-row'+(d.selected?' sel':''),...pressable(d.id),
        style:{animation:d.c.phase==='ringing'?'slidein .5s':'none'}},
      this.kui('Badge',{color:d.sevColor,kind:'outline'},d.sev),
      h('div',{className:'oc-rowtext'},h('span',{className:'oc-title'},d.category),
        // A row names the call; the only state worth a word is the pick-up (« décroché en cours »), not the processing steps.
        h('span',{className:'oc-muted oc-rowstatus'},this.voiceMark(d.c),d.c.ended?(d.c.reviewed?'Dossier clos':d.c.endLabel)+' · '+(d.c.takenOver?'vous':'IA')+' · '+d.id:d.id+(d.c.phase==='ringing'?' · '+d.status:'')),
        d.c.ended?null:this.callLatency(d.c)),
      h('span',{className:'oc-mono oc-right',title:d.c.ended?'Heure de clôture':'Durée de l’appel'},d.c.ended?fmt(d.c.reviewed?d.c.reviewedAt:d.c.endedAt):d.dur),
      d.progress!=null?h('span',{className:'oc-progress',style:{width:Math.round(d.progress*100)+'%'},title:'Avancement de l’appel'}):null);
    const alerts=[...m.mine,...m.alerts];
    return h('div',{className:'oc-col oc-list'},
      section('À traiter','#FF7900',alerts.length),
      alerts.length?alerts.map(card):empty('e1',this.noAlertsLabel()),
      section('Pris en charge par l’IA','var(--color-green-500)',m.ai.length,m.arrival),
      m.ai.length?m.ai.map(row):empty('e2','Aucun appel en cours.'),
      m.history.length?section('Clôturés','var(--color-gray-500)',m.history.length):null,
      ...m.history.map(row),
      // Filed cases stay out of the way: a count, and the list on demand.
      m.closed.length?section('Dossiers clos','var(--color-gray-700)',m.closed.length,this.moreButton('closed','Afficher')):null,
      ...(this.more('closed')?m.closed.map(row):[]));
  }
  waveLabel(c) {
    const playing=this.state.playback?.callId===c.id;
    return this.state.mic?'Capture micro · 30 s maximum':c.ended?'Appel clôturé':c.busy||playing?this.activity(c):'Prêt';
  }
  callPane(m) {
    const c=this.sel();
    if(!c||this.state.view!=='call')return this.situationBoard(m);
    const d=this.decorate(c),mode=this.modeFor(c),taken=c.takenOver;
    const header=h('div',{className:'oc-head'},
      h('div',{className:'oc-top'},this.kui('Badge',{color:d.sevColor,kind:'solid'},d.sev),h('span',{className:'oc-callname'},d.category),
        h('span',{className:'oc-muted oc-ellipsis'},c.id+' · ',h('span',{className:'oc-mono',title:'Numéro fictif, deux chiffres masqués'},c.phone),' · '+c.sc.place),h('span',{className:'oc-mono oc-right'},d.dur)),
      // One line: the mode (with its help) on the left, every call-level action on the right — no separate control band.
      h('div',{className:'oc-mode'+(taken?' taken':'')},
        h('div',{className:'oc-modetext'},h('span',{className:'oc-modetitle',title:mode.sub},h('span',{style:{color:mode.color}},mode.title))),
        h('div',{className:'oc-modebtns'},
          ...(c.ended||c.liveCaller?[]:taken?[this.button("Rendre à l'IA",()=>this.handBackCall(c),false,undefined,undefined,{tone:'quiet'})]
            :[this.button("Prendre l'appel",()=>this.takeOverCall(c),false,undefined,undefined,{emphasis:true})]),
          ...(c.ended?[]:[this.button(c.liveCaller?'Terminer mon appel':c.auto?'Clôturer':'Clôturer le test',()=>this.endCall(c),false,'orange-close',undefined,{tone:'quiet'})]),
          this.button('Fermer',()=>this.goFloor(),false,undefined,'Fermer l’écoute · Échap',{tone:'quiet'}))));
    const controls=this.callControls();
    return h('div',{className:'oc-main'},header,controls?h('div',{className:'oc-ctl'},controls):null,this.transcriptView(c),this.waveRow(c),this.talkBox(c));
  }
  // Each speaker's look lives in CSS (.oc-turn-caller/-ai/-op/-sys) so the style toggle can restyle the bubbles. Each turn
  // is its bubble under an avatar only — a robot for the AI, a person for the caller and the operator; the speaker and the
  // time live in the avatar's tooltip (no label or clock in front of the bubble, asked away).
  transcriptView(c) {
    const kind=who=>who==='Agent IA'?'ai':who==='Vous'?'op':who==='Système'?'sys':'caller';
    const p=this.state.playback,playing=!!p&&p.callId===c.id&&!p.paused,spoken=playing?c.tr.map(t=>t.who).lastIndexOf(SPEAKER_ROW[p.speaker]):-1;
    return h('div',{className:'oc-tr',ref:this.trRef},...c.tr.map((t,i)=>{const k=kind(t.who);return h('div',{key:i,className:'oc-turn oc-turn-'+k},
        k==='sys'?null:h('div',{className:'oc-turnhead'},h('span',{className:'oc-avatar',role:'img','aria-label':t.who+' · '+t.ts,title:t.who+' · '+t.ts},k==='ai'?ICONS.robot:ICONS.human)),
        h('div',{className:'oc-bubble'},t.text,i===spoken?h('span',{className:'oc-cursor'},' ▍'):null));}));
  }
  waveRow(c) {
    if(!this.waveEl)this.waveEl=h('canvas',{ref:this.waveRef,width:640,height:28,style:{width:'100%',height:'28px',display:'block',borderRadius:'6px'}});
    const live=this.waveMode.amp>0.5;
    return h('div',{className:'oc-wave'},h('span',{className:'oc-dot'+(live?' oc-pulse':''),style:{background:live?this.waveMode.color:SEC}}),
      h('span',{className:'oc-wavelabel',style:{color:live?this.waveMode.color:SEC}},this.waveLabel(c)),h('div',{className:'oc-wavebox'},this.waveEl));
  }
  // With no call open, the centre is a live situation board: four figures, the arrival countdown and the activity feed.
  situationBoard(m) {
    return h('div',{className:'oc-main'},h('div',{className:'oc-board'},...this.boardChildren(m)));
  }
  boardChildren(m) {
    const s=this.state.session,alerts=m.mine.length+m.alerts.length,done=m.history.length+m.closed.length;
    const waiting=s.status==='running'&&s.launched<s.total&&this.aiCalls()<AI_CALLS;
    const frac=waiting?1-Math.min(1,Math.max(0,(this.nextArrivalAt||0)-Date.now())/ARRIVAL_MS):0;
    const tile=(key,value,label,tone)=>h('div',{key,className:'oc-tile oc-tile-'+tone},h('span',{className:'oc-tilevalue'},String(value)),h('span',{className:'oc-tilelabel'},label));
    return [
      h('div',{key:'head',className:'oc-boardhead'},h('span',{className:'oc-boardtitle'},'Vue d’ensemble'),h('span',{className:'oc-muted'},`${s.launched}/${s.total} appels arrivés`)),
      h('div',{key:'tiles',className:'oc-tiles'},tile('live',m.live,m.live>1?'appels en cours':'appel en cours','neutral'),tile('ai',m.ai.length,'pris en charge par l’IA','ai'),
        tile('alerts',alerts,'à traiter','alert'),tile('done',done,'clôturés','neutral')),
      h('div',{key:'arrival',className:'oc-arrival'},h('div',{className:'oc-arrivalbar'},h('span',{style:{width:Math.round(frac*100)+'%'}})),h('span',{className:'oc-muted oc-arrivaltext'},m.arrival)),
      h('div',{key:'fh',className:'oc-feedhead'},'Activité'),
      h('div',{key:'feed',className:'oc-feed'},...this.activityFeed(8).map((e,i)=>h('div',{key:i,className:'oc-event oc-event-'+e.kind},h('span',{className:'oc-mono'},e.at),h('span',{className:'oc-eventtext oc-ellipsis'},e.text)))),
      h('div',{key:'hint',className:'oc-boardhint oc-muted'},'Sélectionnez un appel pour l’écouter · Échap pour revenir ici.')];
  }
  activityFeed(n) {
    const events=[];
    for(const c of this.state.calls){
      events.push({t:c.started-this.started,kind:'arrival',text:`${c.id} · ${c.sc.cat} · appel entrant`});
      if(c.lastAnalysis?.signals?.length&&c.alertAt!=null)events.push({t:c.alertAt,kind:'signal',text:`${c.id} · signal : « ${c.lastAnalysis.signals[0]} »`});
      if(c.phase==='blocked'&&c.alertAt!=null)events.push({t:c.alertAt,kind:'signal',text:`${c.id} · garde-fou : contenu bloqué, prise en charge requise`});
      if(c.takenOver&&c.takenAt!=null)events.push({t:c.takenAt,kind:'takeover',text:`${c.id} · prise en charge opérateur`});
      if(c.ended&&c.endedAt!=null)events.push({t:c.endedAt,kind:'end',text:`${c.id} · ${c.endLabel}`});
      if(c.reviewed&&c.reviewedAt!=null)events.push({t:c.reviewedAt,kind:'closed',text:`${c.id} · dossier clos`});
      for(const a of c.actions||[]){
        if(a.kind==='dispatch'&&a.status==='done'&&a.doneAt!=null)events.push({t:a.doneAt,kind:'takeover',text:`${c.id} · ${a.label} · simulation`});
        if(a.kind==='lookup'&&a.status==='done'&&a.result?.label&&a.doneAt!=null)events.push({t:a.doneAt,kind:'end',text:`${c.id} · adresse reconnue : ${a.result.label}`});
      }
    }
    return events.filter(e=>Number.isFinite(e.t)).sort((a,b)=>b.t-a.t).slice(0,n).map(e=>({...e,at:fmt(Math.max(0,e.t))}));
  }
  // Caller sites on the board: readiness and round trip from the gateway's health probe, the caller's latency per site
  // (median, p95 over the recent turns) from the latency log. The built-in caller appears as « passerelle » once measured.
  sitesBoard() {
    const sites=this.state.callers||[],lat=this.state.latency,stats=name=>(lat?.sites||[]).find(s=>s.name===name);
    const names=[...sites.map(s=>s.name),...(lat?.sites||[]).map(s=>s.name).filter(n=>!sites.some(s=>s.name===n))];
    if(!names.length)return null;
    const row=name=>{const s=sites.find(x=>x.name===name),st=stats(name),state=s?(s.ready?'ok':'warn'):'off';
      return h('div',{key:name,className:'oc-siterow'},
        h('span',{className:'oc-svc oc-svc-'+state,title:s?(s.ready?'Site joignable':'Site injoignable · repli sur la passerelle'):'Appelant intégré de la passerelle'},this.siteName(name)+(s?.label&&s.label!==name?' · '+s.label:'')),
        h('span',{className:'oc-mono'},s?(s.rtt_ms!=null?'aller-retour '+fmtMs(s.rtt_ms):'injoignable'):'sur place'),
        h('span',{className:'oc-mono'},st?.caller_ms?'appelant '+fmtMs(st.caller_ms.median)+' · p95 '+fmtMs(st.caller_ms.p95):'aucune mesure'),
        st?.fallbacks?h('span',{className:'oc-mono oc-right oc-site-warn',title:'Tours repris par l’appelant intégré de la passerelle, ce site étant injoignable'},st.fallbacks+' repli'+(st.fallbacks>1?'s':'')):null);};
    const con=lat?.console,steps=con?[['Transcription',con.stt_ms],['Analyse',con.analyze_ms],['Voix IA',con.reply_tts_ms]].filter(([,v])=>v):[];
    const op=lat?.handlers?.operator,phone=lat?.phone?.phone_ms;
    return h('div',{className:'oc-sites'},h('div',{className:'oc-feedhead'},'Sites appelants · latence'),...names.map(row),
      steps.length?h('div',{className:'oc-muted'},'Console (médianes) : '+steps.map(([k,v])=>k+' '+fmtMs(v.median)).join(' · ')):null,
      // The human side, measured apart: the operator's reaction after a takeover, and what a real caller's phone saw.
      op?.operator_ms?h('div',{className:'oc-muted'},'Opérateur (prise en charge, médianes) : réaction '+fmtMs(op.operator_ms.median)+(op.op_tts_ms?' · voix '+fmtMs(op.op_tts_ms.median):'')):null,
      phone?h('div',{className:'oc-muted'},'Téléphone (ligne mobile, médiane) : aller-retour '+fmtMs(phone.median)):null);
  }
  // Where the selected call's caller voice comes from, and the last turn's round trip; shown on scenario calls once a
  // site is configured or was used.
  siteChip(c) {
    const sites=this.state.callers||[],last=c.lastCaller;
    if(!c.callerFacts||(!sites.length&&(c.location||'local')==='local'&&!last))return null;
    const used=last?.location||c.location||'local';
    const title='Site de l’appelant simulé'+(last?` · dernier tour ${fmtMs(last.caller_ms)} (modèle ${fmtMs(last.llm_ms)}, voix ${fmtMs(last.tts_ms)}${last.network_ms!=null?', réseau '+fmtMs(last.network_ms):''})`:'')
      +(last?.fallback?' · site demandé injoignable, appelant intégré de la passerelle en repli':'');
    return h('span',{key:'site',className:'oc-site'+(last?.fallback?' oc-site-warn':''),title},this.siteName(used)+(last?' · '+fmtMs(last.caller_ms):''));
  }
  // Per-call latency at a glance: one compact line on every list card and row with the site playing the caller and the
  // last measured round trip (the same figure as the board's « appelant »); the call's median and the network share
  // sit in the tooltip. Its own line, so the status text and the action keep their room.
  callLatency(c) {
    const turn=(c.latency||[]).at(-1);
    // The operator's own turns (after a takeover) are measured apart: their reaction time, on the card as « vous ».
    const op=turn?.handler==='operator'&&turn.operator_ms!=null?' · vous '+fmtMs(turn.operator_ms):'';
    if(c.lineId){
      // A real caller: what matters is how long they waited for an answer (transcription + analysis + voice, or the operator).
      if(!turn)return null;
      const wait=turn.handler==='operator'?turn.operator_ms:(turn.stt_ms||0)+(turn.analyze_ms||0)+(turn.reply_tts_ms||0);
      return h('div',{key:'lat',className:'oc-callmeta oc-latency',title:'Ligne mobile · délai de réponse du dernier tour'+(turn.handler==='operator'?' (opérateur)':' (transcription + analyse + voix)')},
        'ligne mobile · réponse '+fmtMs(wait));
    }
    const last=c.lastCaller;if(!c.callerFacts||!last||last.caller_ms==null)return null;
    const rows=(c.latency||[]).map(r=>r.caller_ms).filter(v=>v!=null).sort((a,b)=>a-b),median=rows.length?rows[Math.floor(rows.length/2)]:null;
    const title='Appelant simulé · '+this.siteName(last.location)+' · dernier tour '+fmtMs(last.caller_ms)+(last.network_ms!=null?' dont réseau '+fmtMs(last.network_ms):'')
      +(rows.length>1?' · médiane '+fmtMs(median):'')+(last.fallback?' · repli sur la passerelle':'')+(op?' · réaction de l’opérateur '+fmtMs(turn.operator_ms):'');
    return h('div',{key:'lat',className:'oc-callmeta oc-latency'+(last.fallback?' oc-site-warn':''),title},this.siteName(last.location)+' · appelant '+fmtMs(last.caller_ms)+op);
  }
  // Latency of the last turn in the copilot: one line folded, the breakdown and the call's medians behind Détails.
  latencyLine(c) {
    const last=(c.latency||[]).at(-1),operator=last?.handler==='operator';
    return last?[...(operator?[['Vous',last.operator_ms]]:[]),['Appelant',last.caller_ms],['STT',last.stt_ms],['Analyse',last.analyze_ms],['Voix IA',last.reply_tts_ms]].filter(([,v])=>v!=null).map(([k,v])=>k+' '+fmtMs(v)).join(' · ')||'Mesure en cours.':'Aucune mesure pour l’instant.';
  }
  latencyBlock(c) {
    const rows=c.latency||[],last=rows.at(-1),operator=last?.handler==='operator';
    const body=[h('span',{key:'line',className:'oc-muted oc-ellipsis'},this.latencyLine(c))];
    if(this.more('latency')&&last){
      const median=(k,only)=>{const v=rows.filter(r=>!only||r.handler===only).map(r=>r[k]).filter(x=>x!=null).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
      const kv=[['Site',c.lineId?'ligne mobile (appelant réel)':this.siteName(last.location)+(last.fallback?' · repli (site demandé : '+this.siteName(last.requested)+')':'')],
        ['Réponse par',operator?'l’opérateur (prise en charge)':'l’assistance IA'],
        // The operator's turn is its own measurement: reaction, their voice, their mic transcription when they spoke.
        ...(operator?[['Opérateur','réaction '+fmtMs(last.operator_ms)+(last.op_tts_ms!=null?' · voix '+fmtMs(last.op_tts_ms):'')+(last.op_stt_ms!=null?' · STT '+fmtMs(last.op_stt_ms):'')]]:[]),
        ...(c.lineId?[]:[['Appelant',fmtMs(last.caller_ms)+(last.llm_ms!=null?' · modèle '+fmtMs(last.llm_ms):'')+(last.tts_ms!=null?' · voix '+fmtMs(last.tts_ms):'')+(last.network_ms!=null?' · réseau '+fmtMs(last.network_ms):'')]]),
        ['Transcription',fmtMs(last.stt_ms)],['Analyse',fmtMs(last.analyze_ms)+(operator?' (suggestion)':'')],['Voix IA',fmtMs(last.reply_tts_ms)],
        ['Médianes',(c.lineId?'':fmtMs(median('caller_ms'))+' appelant · ')+fmtMs(median('analyze_ms'))+' analyse'+(median('operator_ms','operator')!=null?' · '+fmtMs(median('operator_ms','operator'))+' réaction opérateur':'')]];
      body.push(h('div',{key:'kv',className:'oc-kv'},...kv.flatMap(([k,v],i)=>[h('span',{key:'k'+i,className:'oc-muted'},k),h('span',{key:'v'+i},v)])));
    }
    return h('div',{key:'Latence',className:'oc-block'},h('div',{className:'oc-blockhead'},h('span',{className:'oc-h'},'Latence · dernier tour'),this.moreButton('latency')),...body);
  }
  // Three tiny bars for the call whose audio is actually playing: motion only where something is happening.
  voiceMark(c) {
    const p=this.state.playback;
    return p&&p.callId===c.id&&!p.paused?h('span',{className:'oc-voice','aria-hidden':'true'},h('i'),h('i'),h('i')):null;
  }
  // The talk box is for the operator after takeover, or for the user playing the caller in a manual test.
  talkBox(c) {
    if(c.ended||!(c.takenOver||(!c.auto&&!c.lineId)))return null;  // a real caller's line: the operator talks only after taking the call
    const S=this.state;
    return h('div',{className:'oc-talk'},
      c.liveCaller?h('div',{id:'orange-live-call','nve-layout':'column gap:sm'},
        h('span',{id:'orange-mic-status',role:'status','nve-text':'body'},
          S.mic?'Micro ouvert · parlez, puis envoyez votre phrase':this.micPending?'Autorisez le microphone dans votre navigateur…':
          c.busy?'Micro fermé · '+this.activity(c):'Micro fermé · cliquez sur Parler pour commencer'),
        h('nve-button',{id:'orange-live-mic',size:'lg',interaction:'emphasis',ref:el=>{if(el){el.disabled=!!this.micPending||c.busy;
          el.onclick=()=>{if(!el.disabled)this.toggleMic('Appelant');};}}},S.mic?'Envoyer ma phrase':this.micPending?'Autorisation du micro…':c.busy?'Réponse en cours…':'Parler'),
        S.mic?this.button('Annuler la prise',()=>this.cancelRecording(),false,'orange-cancel-mic'):null):null,
      c.takenOver&&c.suggestion&&!c.busy?h('div',{className:'oc-suggest'},h('span',{className:'oc-h',style:{color:BRAND}},'Suggestion IA'),h('span',{className:'oc-suggesttext'},c.suggestion),
        this.button('Utiliser',()=>this.sayOp(c.suggestion),false,undefined,undefined,{tone:'ai'})):null,
      c.busy||c.queued?h('span',{className:'oc-muted oc-pulse'},c.queued?'Votre réponse sera énoncée après la réplique en cours…':this.activity(c)):null,
      h('div',{className:'oc-talkrow'},
        h('div',{className:'oc-talkinput'},this.kui('TextInput',{value:S.opText,onChange:e=>this.setState({opText:e.target.value}),onKeyDown:e=>{if(e.key==='Enter')this.sayOp(S.opText);},
          placeholder:c.takenOver?'Votre réponse à l’appelant…':'Phrase de l’appelant (test)…'})),
        this.button('Envoyer',()=>this.sayOp(S.opText),false,undefined,undefined,{emphasis:!!S.opText.trim()}),
        c.liveCaller?null:this.button(S.mic?'Stop':'Parler',()=>this.toggleMic(),false,undefined,undefined,{tone:S.mic?'danger':undefined,key:'mic'})));
  }
  // Only the controls that fit what the user is doing: listening, operating, or testing.
  callControls() {
    const c=this.sel();if(!c)return null;
    const row=(...items)=>h('div',{className:'oc-ctlrow','nve-layout':'row gap:sm wrap align:vertical-center'},...items);
    if(c.ended){const next=this.nextLiveCall(c);
      return next?row(this.button('Écouter l’appel suivant → '+next.sc.cat,()=>this.open(next.id),false,'orange-next-call')):null;}
    const test=!c.auto&&!c.lineId,listening=c.auto&&!c.takenOver;
    // Closing lives in the header with the other call-level actions; this row only carries test and recovery tools.
    const items=[
      ...(test&&!c.liveCaller?[this.button(this.state.mic?'Arrêter le micro':'Micro appelant',()=>this.toggleMic('Appelant'),c.busy,'orange-caller-mic')]:[]),
      ...(c.callerFacts&&!listening?[this.button(c.takenOver?'Faire parler l’appelant':'Réplique suivante',()=>this.nextScenario(c,true),c.busy||!!this.recording||!this.canAdvance(c,true),'orange-next')]:[]),
      ...(!listening||c.phase==='error'||c.phase==='blocked'?[this.button('Relancer l’analyse',()=>this.run(c,()=>this.analyzeCall(c)),c.busy||!!this.recording||!this.dialogue(c).some(m=>m.role==='caller'),'orange-retry')]:[])];
    return items.length?row(...items):null;
  }
  nextLiveCall(from) {const s=this.state.session,others=this.state.calls.filter(c=>c!==from&&!c.ended);
    return others.find(c=>c.auto&&!c.takenOver&&c.sessionId===s.id)||others[0];}
  // Secondary text (explanations, logs, disclaimers) is folded by default; each block has its own toggle.
  more(key) {return !!this.state.more[key];}
  moreButton(key,label='Détails') {
    const open=this.more(key);
    return h('button',{key:'more:'+key,type:'button',className:'oc-more',id:'orange-more-'+key,'aria-expanded':String(open),
      onClick:e=>{e.stopPropagation();this.setState({more:{...this.state.more,[key]:!open}});}},open?'Masquer ▴':label+' ▾');
  }
  guardLabel(g) {return {allowed:'conforme',flagged:'signalé',redacted:'caviardé',blocked:'bloqué',error:'injoignable'}[g?.kind]||(g?.outcome?String(g.outcome):'sans verdict');}
  guardBlock(c) {
    const g=this.state.guardrail||{},v=c?.guardrail;
    if(!g.configured&&!v)return null;
    const name=g.name||v?.name||'garde-fou';
    const mode=g.mode||v?.mode;
    // One line by default: the last verdict (and the block message when the AI was stopped); the rest behind Détails.
    const summary=v?h('span',{key:'last',className:v.kind==='blocked'?'oc-signal':'oc-muted'},'Dernier verdict : '+this.guardLabel(v)+(v.note?' · '+v.note:''))
      :h('span',{key:'state',className:'oc-muted'},g.configured?`${name} actif${mode?' · '+mode:''}`:`${name} non configuré.`);
    const body=[summary];
    if(v?.kind==='blocked'&&v.message)body.push(h('span',{key:'msg',className:'oc-muted'},v.message));
    if(this.more('guard')){
      body.push(h('span',{key:'path',className:'oc-muted'},g.configured?`${name}${mode?' · '+mode:''} sur le chemin LLM de l’analyse (/api/analyze). La simulation d’appelant n’y passe pas.`:`${name} non configuré.`));
      if(v){if(v.scan_id)body.push(h('span',{key:'scan',className:'oc-muted'},'scan '+v.scan_id));
        // Out-of-band mode scans both directions; show each when present.
        for(const [dir,label] of [['request','propos de l’appelant'],['response','réponse de l’IA']])if(v[dir])
          body.push(h('span',{key:dir,className:'oc-muted'},label+' : '+this.guardLabel(v[dir])+(v[dir].scanners?.length?' · '+v[dir].scanners.map(x=>String(x.scannerId||'').slice(0,8)).join(', '):'')));
        if(v.message&&v.kind!=='blocked')body.push(h('span',{key:'msg',className:'oc-muted'},v.message));}}
    return h('div',{key:'Garde-fou',className:'oc-block'},h('div',{className:'oc-blockhead'},h('span',{className:'oc-h'},'Garde-fou IA'),this.moreButton('guard')),
      ...(g.configured&&g.enabled===false?[h('span',{key:'off',className:'oc-signal'},'Désactivé par l’opérateur · l’analyse va directement au modèle')]:[]),...body);
  }
  copilot(m) {
    const c=this.sel(),show=!!c&&this.state.view==='call',s=this.state.session;
    const block=(title,...body)=>h('div',{key:title,className:'oc-block'},h('span',{className:'oc-h'},title),...body);
    const fold=(title,key,...body)=>h('div',{key:title,className:'oc-block'},h('div',{className:'oc-blockhead'},h('span',{className:'oc-h'},title),this.moreButton(key)),...body);
    if(!show)return h('div',{className:'oc-col oc-side'},
      block('Assistance IA',h('span',{className:'oc-muted'},'Sélectionnez un appel : synthèse, actions et éléments à vérifier.')),
      this.footnote());
    const signals=c.lastAnalysis?.signals||[];
    // Three things at a glance — what the caller said (with the facts), what to do, what to check — and the rest folded.
    return h('div',{className:'oc-col oc-side'},
      block('Synthèse',h('span',{className:'oc-summary',style:{color:c.summary?CALLER:SEC}},c.summary||'En attente des premiers propos de l’appelant.'),
        c.facts.length?h('div',{className:'oc-kv'},...c.facts.flatMap((f,i)=>[h('span',{key:'k'+i,className:'oc-muted'},f.k),h('span',{key:'v'+i},f.v)])):null),
      this.actionsBlock(c),
      signals.length?block('À vérifier',...signals.map((q,i)=>h('span',{key:i,className:'oc-signal'},'« '+q+' »'))):null,
      this.detailsBlock(c),
      this.footnote());
  }
  // The processing log: the real model calls; folded, the count and the latest call on one line.
  toolsBlock(c) {
    const tools=[...c.tools].reverse();
    return h('div',{key:'Journal',className:'oc-block'},h('div',{className:'oc-blockhead'},h('span',{className:'oc-h'},'Journal des traitements · '+c.tools.length),this.moreButton('tools')),
      this.more('tools')?h('div',{className:'oc-tools'},...tools.slice(0,8).map((t,i)=>h('div',{key:i,className:'oc-tool'},
        h('span',{className:t.status==='running'?'oc-pulse':'',style:{color:t.status==='error'?OP:t.status==='cancelled'?SEC:BRAND}},({done:'✓',error:'!',cancelled:'×'})[t.status]||'◌'),
        h('span',{className:'oc-mono'},t.name),h('span',{className:'oc-muted oc-ellipsis'},t.args),h('span',{className:'oc-toolres'},t.status==='running'?'en cours…':t.result))))
      :h('span',{className:'oc-muted oc-ellipsis'},this.toolsLine(c)));
  }
  toolsLine(c) {const t=c.tools.at(-1);return t?t.name+' · '+t.args+' · '+(t.status==='running'?'en cours…':t.result):'Aucun traitement pour l’instant.';}
  // What the operator does not need at a glance — the guardrail's verdict, the last turn's latency, the processing log —
  // folds into one block: a line each, the full blocks on « Détails ».
  detailsBlock(c) {
    const head=h('div',{className:'oc-blockhead'},h('span',{className:'oc-h'},'Détails'),this.moreButton('details'));
    if(this.more('details'))return h('div',{key:'Détails',className:'oc-block oc-details'},head,this.guardBlock(c),this.latencyBlock(c),this.toolsBlock(c));
    const g=this.state.guardrail||{},v=c.guardrail,lines=[];
    if(v)lines.push(h('span',{key:'g',className:(v.kind==='blocked'?'oc-signal':'oc-muted')+' oc-ellipsis'},'Garde-fou · Dernier verdict : '+this.guardLabel(v)+(v.note?' · '+v.note:'')));
    else if(g.configured)lines.push(h('span',{key:'g',className:'oc-muted oc-ellipsis'},'Garde-fou · '+(g.enabled===false?'désactivé par l’opérateur':'actif · sans verdict pour cet appel')));
    lines.push(h('span',{key:'l',className:'oc-muted oc-ellipsis'},'Latence · dernier tour · ',this.siteChip(c),this.siteChip(c)?' · ':'',this.latencyLine(c)));
    lines.push(h('span',{key:'t',className:'oc-muted oc-ellipsis'},'Journal des traitements · '+c.tools.length+' · '+this.toolsLine(c)));
    return h('div',{key:'Détails',className:'oc-block'},head,...lines);
  }
  footnote() {
    return h('div',{key:'foot',className:'oc-foot'},h('span',null,this.more('note')?footnoteText(this.labels()):'Validation humaine requise'),this.moreButton('note'));
  }
  // What is audible right now, exposed as data attributes on the console root (scripts read them; the user sees it in
  // the wave row and the transcript cursor). The fixed audio player strip was removed on request.
  playbackState() {
    const p=this.state.playback,rec=this.recording;
    return {role:rec?(rec.who==='Vous'?'operator':'caller'):(p?.speaker||'idle'),playing:!!rec||!!p&&!p.paused,who:p?.callId||rec?.c.id||''};
  }
  renderVals() {
    const c=this.sel(),p=this.state.playback,playing=!!c&&!!p&&p.callId===c.id&&!p.paused;
    // Waveform colour and amplitude follow what is actually audible.
    this.waveMode=this.state.mic?{amp:1,color:OP}:playing?{amp:1,color:WAVE[p.speaker]}:{amp:c?.busy?0.12:0.06,color:'var(--oc-idle)'};
    return {density:this.props.density??'standard',liveControls:this.controls(),consoleView:this.consoleView()};
  }
}

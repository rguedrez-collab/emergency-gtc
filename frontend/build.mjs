// Preserve the original user mockup; replace only its simulation controller and
// false integration claims in a generated deployment artifact. The mockup's shell
// (bundle, theme, header, fonts) stays; its floor and call views are replaced by
// one console rendered from logic.js.
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {samples} from './src/samples.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
// The mockup (urgence.html) is a separate asset: frontend/mockup/urgence.html (git-ignored), the ORANGE_MOCKUP variable or the first argument.
const sourcePath=process.argv[2]||process.env.ORANGE_MOCKUP||path.join(HERE,'mockup','urgence.html');
if(!fs.existsSync(sourcePath))throw Error('Mockup not found at '+sourcePath+': copy urgence.html to frontend/mockup/ or set ORANGE_MOCKUP.');
const source=fs.readFileSync(sourcePath,'utf8');
const pattern=/(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;
const original=JSON.parse(source.match(pattern)[2]);
// Every patch must land: a silently missed replacement ships a half-converted UI.
// String replacements go through a function so `$` sequences are never special.
const swap=(text,from,to)=>{const next=text.replace(from,typeof to==='function'?to:()=>to);
  if(next===text)throw Error('Patch did not apply: '+String(from).slice(0,80));return next;};
let template=swap(original,'<html>', '<html lang="fr" nve-theme="dark">');
const scriptPattern=/(<script type="text\/x-dc"[^>]*>)([\s\S]*?)(<\/script>)/;
const scenarios=samples;
const logic=swap(fs.readFileSync(path.join(HERE,'src','logic.js'),'utf8'),'// SCENARIOS is injected', 'const SCENARIOS = '+JSON.stringify(scenarios)+';\n// SCENARIOS is injected');
new vm.Script(logic); // Syntax only; DCLogic is supplied by the preserved bundle.
template=swap(template,scriptPattern,(_,a,b,c)=>a+logic+c);
// Floor and call views -> the console. The gradient bar and the shell's closing tags stay.
template=swap(template,/(<div style="height:3px;background:linear-gradient[^>]*><\/div>)\n\n<sc-if value="\{\{ isFloor \}\}"[\s\S]*<\/sc-if>\n(<\/div>\n<\/x-import>\n<\/x-dc>)/,
  (_,bar,tail)=>bar+'\n<div style="padding:0;">{{ consoleView }}</div>\n'+tail);
// The header keeps the brand, the title and the user only: the mockup's shift clock (« Vacation {{ shiftTime }} ») and
// its sound tag go (asked away); the sound state shows in the wave row of the open call.
template=swap(template,'<span style="font-family:var(--font-mono);font-size:13px;color:var(--text-color-secondary);">Vacation {{ shiftTime }}</span>','');
template=swap(template,/<x-import component-from-global-scope="KuiFoundationsReact.Tag"[^>]*>\{\{ audioLabel \}\}<\/x-import>/,'');
const controls=`<div class="oc-topbar">
{{ liveControls }}
</div>`;
template=swap(template,'</x-import>\n<div style="height:3px', '</x-import>\n'+controls+'\n<div style="height:3px');
// Console styles use the mockup's theme tokens; new controls use current Elements.
const css=`
/* --oc-top is measured by the controller (fit): the console runs from under the bar to the viewport bottom (no fixed player;
   playback state is exposed as data attributes on #orange-console). The page must not scroll. */
:root{--oc-caller:#e6c54a;--oc-ai:#76b900;--oc-op:#FF7900;--oc-idle:#3a3a3a;}
nve-button[data-tone=quiet]{--background:transparent;--border:1px solid transparent;}
nve-button[data-tone=danger]{--background:transparent;--border:1px solid rgba(255,122,122,.6);--color:#ff8a8a;}
nve-button[data-tone=ai]{--background:transparent;--border:1px solid rgba(118,185,0,.5);--color:var(--text-color-brand);}
.oc-topbar{padding:8px 16px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--border-color-base);}
.oc-kpis b{font-weight:600;color:var(--text-color-primary);}
.oc-kpis.oc-chip-warn::before{display:none;}
.oc-kpistate{display:inline-flex;align-items:center;gap:5px;}
.oc-kpistate::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--color-gray-500);flex:none;}
.oc-kpistate-running::before{background:var(--color-green-500);} .oc-kpistate-paused::before{background:#FF7900;}
.oc-services{gap:10px;}
.oc-svc{display:inline-flex;align-items:center;gap:5px;}
.oc-svc::before{content:"";width:7px;height:7px;border-radius:50%;flex:none;background:var(--color-gray-500);}
.oc-svc-ok{color:var(--text-color-primary);} .oc-svc-ok::before{background:var(--color-green-500);} .oc-svc-warn::before{background:#FF7900;}
.oc-details>.oc-block{padding:0;border:0;background:none;box-shadow:none;}
/* Focus layout: the call list, then one call full width with the decisions. */
.oc.oc-focus{grid-template-columns:380px minmax(0,1fr) !important;grid-template-rows:minmax(0,1fr) !important;}
.oc-fmain .oc-tr{padding:20px max(16px,8%);gap:14px;} .oc-fmain .oc-bubble{font-size:16px;max-width:min(760px,82%);}
.oc-fhead .oc-callname{font-size:22px;} .oc-fstate{font-weight:600;font-size:13px;white-space:nowrap;}
.oc-brief{flex:none;display:flex;flex-direction:column;gap:6px;padding:10px max(16px,8%) 6px;border-top:1px solid var(--border-color-base);background:var(--background-color-surface-base);}
.oc-briefline{display:flex;gap:12px;align-items:baseline;} .oc-briefline .oc-h{flex:none;min-width:76px;} .oc-briefline .oc-summary{font-size:15px;}
.oc-decisions{flex:none;display:flex;flex-direction:column;gap:8px;padding:8px max(16px,8%) 12px;background:var(--background-color-surface-base);}
.oc-bigrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.oc-big{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:14px 16px;border-radius:10px;border:2px solid var(--border-color-base);background:transparent;font:inherit;color:var(--text-color-primary);cursor:pointer;text-align:left;min-height:72px;}
.oc-big:disabled{cursor:default;} .oc-bigname{font-size:16px;font-weight:700;} .oc-bigsub{font-size:12px;color:var(--text-color-secondary);}
@keyframes bigpulse{0%,100%{box-shadow:0 0 0 0 rgba(255,121,0,.35);}50%{box-shadow:0 0 0 6px rgba(255,121,0,0);}}
.oc-big-proposed{border-color:#FF7900;background:rgba(255,121,0,.08);animation:bigpulse 1.6s ease-in-out infinite;} .oc-big-proposed .oc-bigsub{color:#FF7900;font-weight:600;}
.oc-big-done{border-color:var(--color-green-500);background:rgba(118,185,0,.10);opacity:1;} .oc-big-done .oc-bigsub{color:#4f8a00;font-weight:600;}
.oc-big-take{border-color:#111;background:#111;color:#fff;} .oc-big-take .oc-bigsub{color:rgba(255,255,255,.75);} .oc-big-op{border-color:#9b51e0;}
.oc-smallrow{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;}
.oc-fdetails{flex:none;padding:8px max(16px,8%) 12px;display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--border-color-base);max-height:40vh;overflow-y:auto;}
.oc-focus .oc-talk{padding-left:max(16px,8%);padding-right:max(16px,8%);}
@media (max-width:900px){.oc-bigrow{grid-template-columns:repeat(2,minmax(0,1fr));}}
.oc-switch{display:inline-flex;align-items:center;gap:8px;background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;}
.oc-switch-track{position:relative;width:30px;height:16px;border-radius:999px;background:var(--color-gray-500);transition:background .15s;flex:none;}
.oc-switch-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.35);transition:transform .15s;}
.oc-switch-on .oc-switch-track{background:var(--color-green-500);} .oc-switch-on .oc-switch-knob{transform:translateX(14px);} .oc-switch-warn .oc-switch-track{background:#FF7900;}
.oc-switch-state{font-weight:600;} .oc-switch:hover .oc-switch-label{text-decoration:underline;} .oc-switch:focus-visible{outline:2px solid var(--color-green-500);outline-offset:2px;border-radius:999px;}
.oc-chip-demo{border-color:rgba(243,193,75,.45);color:#f3c14b;}
.oc-chip-demo::before{content:"";width:7px;height:7px;border-radius:50%;background:#f3c14b;flex:none;}
.oc-entrycard{display:flex;flex-direction:column;align-items:center;gap:24px;max-width:760px;}
.oc{display:grid;grid-template-columns:380px minmax(0,1fr) 340px;height:calc(100vh - var(--oc-top,124px) - var(--oc-space,0px));min-height:520px;}
.oc-kpis,.oc-services,.oc-chip-demo{border-color:transparent;background:transparent;box-shadow:none;}
@media (max-width:1400px){.oc{grid-template-columns:340px minmax(0,1fr) 300px;}}
@media (max-width:1100px){.oc{grid-template-columns:320px minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,34%);}
  .oc-list{grid-row:1/3;} .oc-side{grid-column:2;border-left:none;border-top:1px solid var(--border-color-base);}}
nve-button{--text-transform:none;}
.oc-bar{display:flex;flex-direction:column;gap:6px;}
.oc-bartop{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-height:30px;}
.oc-bargroup{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;min-width:0;}
.oc-barstatus{margin-left:auto;}
.oc-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;line-height:1.2;white-space:nowrap;border:1px solid var(--border-color-base);color:var(--text-color-secondary);background:var(--background-color-surface-raised);max-width:100%;overflow:hidden;text-overflow:ellipsis;}
.oc-chip-plain{font-family:var(--font-mono);}
.oc-chip-ok{border-color:rgba(118,185,0,.45);color:var(--text-color-brand);}
.oc-chip-ok::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--color-green-500);flex:none;}
.oc-chip-warn{border-color:rgba(255,121,0,.6);color:#FF7900;}
.oc-chip-warn::before{content:"";width:7px;height:7px;border-radius:50%;background:#FF7900;flex:none;}
.oc-chip-off::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--color-gray-500);flex:none;}
.oc-settings{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:6px 10px;border:1px solid var(--border-color-base);border-radius:var(--radius-md);background:var(--background-color-surface-raised);}
.oc-vsep{width:1px;height:22px;background:var(--border-color-base);margin:0 4px;}
.oc-col{min-width:0;min-height:0;overflow-y:auto;display:flex;flex-direction:column;}
.oc-list{border-right:1px solid var(--border-color-base);background:var(--background-color-surface-base);padding-bottom:12px;}
.oc-side{border-left:1px solid var(--border-color-base);background:var(--background-color-surface-base);padding:16px;gap:16px;}
.oc-sec{display:flex;align-items:center;gap:8px;padding:14px 14px 6px;font-size:12px;font-weight:600;letter-spacing:0;color:var(--text-color-secondary);
  position:sticky;top:0;z-index:1;background:var(--background-color-surface-base);}
.oc-count{font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:0;padding:1px 7px;border-radius:999px;background:var(--background-color-surface-raised);color:var(--text-color-primary);}
.oc-sec>span{white-space:nowrap;}
.oc-sec>.oc-secextra{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400;font-size:11px;text-align:right;white-space:normal;}
.oc-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;}
.oc-pulse{animation:pulse 1.2s infinite;}
/* Alert cards and AI rows share one list rhythm: full-width rows separated by hairlines; the selection is a left accent.
   The primary action of a row appears on hover, focus or selection (actions on demand). */
.oc-card{margin:0;padding:10px 14px;border:0;border-bottom:1px solid var(--border-color-base);border-radius:0;background:transparent;cursor:pointer;display:flex;flex-direction:column;gap:6px;}
.oc-card .oc-cardact{opacity:0;transition:opacity .15s ease;}
.oc-card:hover .oc-cardact,.oc-card:focus-within .oc-cardact,.oc-card.sel .oc-cardact,.oc-card.open .oc-cardact{opacity:1;}
.oc-card,.oc-row{transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease;position:relative;}
.oc-progress{position:absolute;left:0;bottom:0;height:2px;background:var(--color-green-500);opacity:.85;border-bottom-left-radius:inherit;transition:width .6s linear;pointer-events:none;}
.oc-card:hover,.oc-row:hover{background:var(--background-color-interaction-hover);}
.oc-card:focus-visible,.oc-row:focus-visible{outline:2px solid var(--text-color-brand);outline-offset:-2px;}
.oc-more:focus-visible{outline:2px solid var(--text-color-brand);outline-offset:2px;border-radius:4px;}
.oc-ctlrow{justify-content:flex-end;}
.oc-card.sel,.oc-row.sel{box-shadow:inset 3px 0 0 var(--color-green-500);background:var(--background-color-interaction-hover);}
.oc-card.mine{box-shadow:inset 3px 0 0 #FF7900;}
.oc-top{display:flex;align-items:center;gap:8px;min-width:0;}
.oc-title{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.oc-callname{font-size:20px;font-weight:700;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oc-right{margin-left:auto;white-space:nowrap;}
.oc-quote{font-size:14px;line-height:1.35;text-wrap:pretty;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.oc-status{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-color-brand);min-width:0;}
.oc-cardline{display:flex;align-items:center;gap:8px;min-width:0;}
.oc-cardline>.oc-status,.oc-cardline>.oc-signal,.oc-cardline>.oc-callmeta{flex:1;min-width:0;}
.oc-cardact{flex:none;display:inline-flex;}
.oc-cardtoggle{background:none;border:0;padding:0 2px;margin:0;color:var(--text-color-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:1;}
.oc-cardtoggle:hover{color:var(--text-color-primary);}
.oc-cardtoggle:focus-visible{outline:2px solid var(--text-color-brand);outline-offset:2px;border-radius:4px;}
.oc-cardmore{display:flex;flex-direction:column;gap:6px;padding-top:6px;margin-top:2px;border-top:1px solid var(--border-color-base);}
.oc-actions{display:flex;gap:4px 6px;flex-wrap:wrap;align-items:center;padding-top:2px;}
.oc-muted{font-size:12px;color:var(--text-color-secondary);line-height:1.4;}
.oc-mono{font-family:var(--font-mono);font-size:12px;color:var(--text-color-secondary);}
.oc-row{display:grid;grid-template-columns:72px minmax(0,1fr) 52px;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border-color-base);cursor:pointer;}
.oc-rowtext{display:flex;flex-direction:column;gap:2px;min-width:0;}
.oc-rowtext .oc-muted{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oc-emptybox{margin:0 14px 10px;padding:6px 0;font-size:13px;color:var(--text-color-secondary);}
.oc-main{display:flex;flex-direction:column;min-width:0;min-height:0;}
.oc-head{flex:none;padding:10px 16px 8px;border-bottom:1px solid var(--border-color-base);display:flex;flex-direction:column;gap:6px;background:var(--background-color-surface-base);}
.oc-head .oc-top>.oc-muted{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}  /* id · number · declared place on one line */
.oc-mode{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 0 0;}
.oc-modetext{display:flex;flex-direction:column;min-width:0;gap:2px;}
.oc-modetitle{font-size:13px;font-weight:700;}
.oc-modebtns{display:flex;gap:8px;flex:none;}
.oc-ctl{padding:6px 16px 0;}
.oc-tr{flex:1;min-height:0;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;}
.oc-turn{display:flex;flex-direction:column;gap:4px;}
.oc-turnhead{display:flex;align-items:baseline;gap:8px;}
.oc-who{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;}
.oc-bubble{max-width:min(620px,86%);padding:10px 14px;font-size:15px;line-height:1.45;text-wrap:pretty;color:var(--text-color-primary);}
.oc-turn-caller{align-items:flex-start;} .oc-turn-ai,.oc-turn-op{align-items:flex-end;} .oc-turn-sys{align-items:center;}
.oc-turn-caller .oc-bubble{border-radius:14px 14px 14px 4px;background:var(--background-color-surface-raised);border:1px solid var(--border-color-base);}
/* The AI's bubbles are black with white text in every theme (asked for); the caller's and the operator's follow the theme. */
.oc-turn-ai .oc-bubble{border-radius:14px 14px 4px 14px;background:#000;border:1px solid #000;color:#fff;}
.oc-turn-ai .oc-cursor{color:#76b900;}
.oc-turn-op .oc-bubble{border-radius:14px 14px 4px 14px;background:rgba(255,121,0,.12);border:1px solid rgba(255,121,0,.45);}
.oc-turn-sys .oc-bubble{border-radius:999px;background:transparent;border:1px solid var(--border-color-base);color:var(--text-color-secondary);font-style:italic;}
.oc-turn-caller .oc-who,.oc-turn-caller .oc-cursor{color:var(--text-color-primary);} .oc-turn-ai .oc-who,.oc-turn-ai .oc-cursor{color:var(--text-color-brand);}
.oc-turn-op .oc-who,.oc-turn-op .oc-cursor{color:#FF7900;} .oc-turn-sys .oc-who{color:var(--text-color-secondary);}
.oc-wave{flex:none;display:flex;align-items:center;gap:10px;padding:8px 18px;border-top:1px solid var(--border-color-base);background:var(--background-color-surface-base);}
.oc-wavelabel{font-size:12px;font-weight:600;white-space:nowrap;}
.oc-wavebox{flex:1;min-width:0;height:28px;display:flex;align-items:center;}
.oc-talk{flex:none;display:flex;flex-direction:column;gap:8px;padding:10px 18px 12px;border-top:1px solid #FF7900;background:var(--background-color-surface-base);}
.oc-suggest{display:flex;align-items:center;gap:10px;min-width:0;}
.oc-suggesttext{font-size:13px;line-height:1.35;flex:1;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.oc-talkrow{display:flex;gap:8px;align-items:center;min-width:0;}
.oc-talkinput{flex:1 1 120px;min-width:0;}
.oc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:40px;color:var(--text-color-secondary);font-size:14px;}
/* Situation board (centre pane when no call is open) */
.oc-board{flex:1;min-height:0;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:18px;}
.oc-boardhead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;}
.oc-boardtitle{font-size:18px;font-weight:600;letter-spacing:-0.01em;}
.oc-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;}
.oc-tile{position:relative;overflow:hidden;padding:14px 16px 14px 18px;border:1px solid var(--border-color-base);border-radius:var(--radius-lg);background:var(--background-color-surface-raised);display:flex;flex-direction:column;gap:4px;}
.oc-tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--color-gray-500);}
.oc-tile-ai::before{background:var(--color-green-500);} .oc-tile-alert::before{background:#FF7900;}
.oc-tilevalue{font-size:30px;font-weight:600;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums;}
.oc-tilelabel{font-size:12px;color:var(--text-color-secondary);}
.oc-arrival{display:flex;align-items:center;gap:12px;}
.oc-arrivalbar{flex:1;height:4px;border-radius:999px;background:var(--border-color-base);overflow:hidden;}
.oc-arrivalbar>span{display:block;height:100%;background:#FF7900;transition:width .25s linear;}
.oc-arrivaltext{white-space:nowrap;}
.oc-feedhead{font-size:12px;font-weight:600;color:var(--text-color-secondary);}
.oc-feed{display:flex;flex-direction:column;}
.oc-event{display:grid;grid-template-columns:48px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid var(--border-color-base);font-size:13px;align-items:baseline;}
.oc-event-signal .oc-eventtext{color:var(--text-color-feedback-warning);} .oc-event-takeover .oc-eventtext{color:#FF7900;}
.oc-event-end .oc-eventtext,.oc-event-closed .oc-eventtext{color:var(--text-color-secondary);}
.oc-boardhint{margin-top:auto;font-size:12px;}
/* Caller sites: where the simulated caller's voice comes from (call header chip) and the per-site latency rows on the board */
.oc-site{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-color-secondary);white-space:nowrap;}
.oc-site::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--color-green-500);flex:none;}
.oc-site-warn{color:#FF7900;} .oc-site-warn::before{background:#FF7900;}
.oc-callmeta{font-family:var(--font-mono);font-size:11px;line-height:1.3;color:var(--text-color-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* Copilot « Actions · outils »: the AI's tool calls, their state, the operator's validation */
.oc-action{display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid var(--border-color-base);font-size:13px;}
.oc-actionhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;}
.oc-actionname{font-weight:600;}
.oc-actionstatus{font-family:var(--font-mono);font-size:11px;color:var(--text-color-secondary);white-space:nowrap;flex:none;}
.oc-action-proposed .oc-actionstatus,.oc-action-running .oc-actionstatus{color:#FF7900;}
.oc-action-done .oc-actionstatus{color:var(--text-color-brand);} .oc-action-error .oc-actionstatus{color:#cd1f3a;}
.oc-action-declined{opacity:.6;}
.oc-actionresult{font-size:13px;line-height:1.35;}
.oc-sites{display:flex;flex-direction:column;gap:4px;}
.oc-siterow{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.5fr) auto;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border-color-base);font-size:13px;}
.oc-siterow .oc-svc{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.oc-siterow .oc-mono{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* Life where something happens: voice bars for the call being heard, a warm flash on arrival, turns fading in */
.oc-voice{display:inline-flex;align-items:flex-end;gap:2px;height:10px;margin-right:2px;flex:none;}
.oc-voice i{display:block;width:2px;height:100%;background:currentColor;border-radius:1px;transform-origin:bottom;animation:voice .9s ease-in-out infinite;}
.oc-voice i:nth-child(2){animation-delay:.15s;} .oc-voice i:nth-child(3){animation-delay:.3s;}
.oc-rowstatus{display:flex;align-items:center;gap:6px;}
@keyframes voice{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
@keyframes arrive{from{background-color:rgba(255,121,0,.22)}to{background-color:transparent}}
@keyframes fadeup{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.oc-turn{animation:fadeup .25s ease-out;}
.oc-avatar{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;background:#000;flex:none;}
.oc-avatar svg{display:block;}
.oc-turn-op .oc-avatar{background:#FF7900;color:#111;}
.oc-turnhead{min-height:20px;}
html.dark .oc-avatar{box-shadow:0 0 0 1px #3a424c;} html.glass .oc-avatar{box-shadow:0 0 0 1px rgba(255,255,255,.25);}
.oc-turn-ai .oc-turnhead,.oc-turn-op .oc-turnhead{flex-direction:row-reverse;}
.oc-pills{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;}
@media (prefers-reduced-motion:reduce){.oc-voice i,.oc-turn{animation:none;}}
.oc-block{display:flex;flex-direction:column;gap:8px;}
.oc-h{font-size:12px;font-weight:600;letter-spacing:0;color:var(--text-color-secondary);}
.oc-summary{font-size:15px;line-height:1.45;}
.oc-signal{font-size:13px;line-height:1.35;color:var(--text-color-feedback-warning);}
.oc-end{font-size:14px;font-weight:600;color:var(--text-color-accent-teal);}
.oc-kv{display:grid;grid-template-columns:84px minmax(0,1fr);gap:4px 10px;font-size:13px;line-height:1.35;}
.oc-tools{display:flex;flex-direction:column;gap:4px;}
.oc-tool{display:grid;grid-template-columns:14px auto minmax(0,1fr);gap:4px 8px;font-size:12px;align-items:baseline;}
.oc-tool .oc-toolres{grid-column:2/4;color:var(--text-color-primary);font-size:12px;}
.oc-ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oc-foot{margin-top:auto;font-size:11px;line-height:1.5;color:var(--text-color-secondary);display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;}
.oc-blockhead{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.oc-more{background:none;border:0;padding:0;margin:0;font:inherit;font-size:12px;line-height:1.2;color:var(--text-color-brand);cursor:pointer;white-space:nowrap;}
.oc-more:hover{text-decoration:underline;}
.oc-modetitle{display:flex;align-items:center;gap:10px;}
/* ---- Flat, Orange-style console shared by « Style : sobre » (light, default) and « Style : sombre » (dark):
   black header, flat surfaces with 1px borders and 4px corners, orange for primary actions and the operator,
   muted green for the AI, no glow, no motion on indicators. Only the palette differs between the two. ---- */
html.flat .oc-topbar{border-bottom:none;padding:8px 16px;}
html.flat .oc-topbar+div{background:#ff7900!important;height:2px!important;}
html.flat .oc-card.sel,html.flat .oc-row.sel,html.flat .oc-card.mine{box-shadow:inset 3px 0 0 #ff7900;}
html.flat .oc-pulse{animation:none;}
html.flat .oc-progress{background:#ff7900;opacity:.9;}
html.flat .oc-talk{border-top-color:#ff7900;}
html.flat .oc-entrycard{border:1px solid var(--border-color-base);border-radius:4px;padding:40px 48px;}
html.flat .oc-mode,html.flat .oc-emptybox,html.flat .oc-settings{border-radius:4px;}
html.flat nve-button{--border-radius:4px;}
/* Primary actions (« Prendre l'appel », « Ouvrir la vacation », « Clore le dossier ») are black with white text (asked for). */
html.flat nve-button[interaction=emphasis]{--background:#000;--border:1px solid #000;--color:#fff;}
html.flat .oc-card:focus-visible,html.flat .oc-row:focus-visible,html.flat .oc-more:focus-visible,html.flat .oc-cardtoggle:focus-visible{outline-color:#ff7900;}
/* Light palette */
html.sober{color-scheme:light;--oc-caller:#5c6670;--oc-ai:#3f8500;--oc-op:#ff7900;--oc-idle:#d3d7dc;}
html.sober body{background:#f3f4f6;}
html.sober .nv-light{--radius-lg:4px;--radius-md:3px;--text-color-brand:#2f7a12;}
html.sober .nv-app-bar-root{background:#000;--text-color-primary:#fff;--text-color-secondary:#c7c7c7;--text-color-brand:#76b900;--border-color-base:#333;}
html.sober .oc-topbar,html.sober .oc-list,html.sober .oc-main,html.sober .oc-side,html.sober .oc-sec,html.sober .oc-player,html.sober .oc-entrycard{background:#fff;}
html.sober .oc-card,html.sober .oc-row{border-bottom-color:#e6e9ee;}
html.sober .oc-card:hover,html.sober .oc-row:hover{background:#f7f8fa;}
html.sober .oc-card.sel,html.sober .oc-card.mine,html.sober .oc-row.sel{background:#fff7ef;}
html.sober .oc-count{background:#eef0f3;color:#111;}
html.sober .oc-chip{background:#fff;border-color:#d9dde3;color:#5c6670;}
html.sober .oc-kpis,html.sober .oc-services,html.sober .oc-chip-demo{background:transparent;border-color:transparent;}
html.sober .oc-chip-demo{border-color:#ff7900;color:#8a4b00;} html.sober .oc-chip-demo::before{background:#ff7900;}
html.sober .oc-kpis b,html.sober .oc-svc-ok{color:#111;}
html.sober .oc-turn-caller .oc-bubble{background:#f3f4f6;border-color:#e3e6ea;}
html.sober .oc-turn-ai .oc-bubble{background:#000;border-color:#000;}
html.sober .oc-turn-op .oc-bubble{background:#fff4e8;border-color:#ffd2a8;}
html.sober .oc-turn-ai .oc-who,html.sober .oc-turn-ai .oc-cursor,html.sober .oc-status{color:#2f7a12;}
html.sober .oc-tile{background:#fff;border-color:#e3e6ea;} html.sober .oc-event,html.sober .oc-siterow{border-bottom-color:#eef0f3;} html.sober .oc-arrivalbar{background:#e6e9ee;}
html.sober .oc-site-warn{color:#8a4b00;}
html.sober .oc-emptybox,html.sober .oc-entrycard{border-color:#d9dde3;}
html.sober .oc-more,html.sober .oc-cardtoggle{color:#5c6670;} html.sober .oc-more:hover,html.sober .oc-cardtoggle:hover{color:#111;}
html.sober nve-button{--background:#fff;--border:1px solid #111;--color:#111;}
html.sober nve-button[disabled]{--background:#f3f4f6;--border:1px solid #d9dde3;--color:#8a939c;}
html.sober nve-button[data-tone=quiet]{--background:transparent;--border:1px solid transparent;--color:#111;}
html.sober nve-button[data-tone=danger]{--background:#fff;--border:1px solid #cd1f3a;--color:#cd1f3a;}
html.sober nve-button[data-tone=ai]{--background:#fff;--border:1px solid #3f8500;--color:#1f5c0a;}
/* Dark palette: the same console on soft dark neutrals (not the mockup's pure black), orange and muted green accents */
html.dark{--oc-caller:#aab3bd;--oc-ai:#7cc02a;--oc-op:#ff7900;--oc-idle:#2e343b;}
html.dark .nv-dark{--background-color-surface-sunken:#0f1114;--background-color-surface-base:#15181c;--background-color-surface-raised:#1c2026;
  --border-color-base:#2b3139;--text-color-secondary:#a3abb5;--text-color-brand:#8ccf3a;--background-color-interaction-hover:#20252b;--radius-lg:4px;--radius-md:3px;}
html.dark body{background:#0f1114;}
html.dark .oc-card,html.dark .oc-row{border-bottom-color:#262b32;}
html.dark .oc-card:hover,html.dark .oc-row:hover{background:#20252b;}
html.dark .oc-card.sel,html.dark .oc-card.mine,html.dark .oc-row.sel{background:#2a1f14;}
html.dark .oc-count{background:#2b3139;color:#fff;}
html.dark .oc-chip{background:#1a1e23;border-color:#2b3139;}
html.dark .oc-kpis,html.dark .oc-services,html.dark .oc-chip-demo{background:transparent;border-color:transparent;}
html.dark .oc-chip-demo{border-color:#ff7900;color:#ffb366;} html.dark .oc-chip-demo::before{background:#ff7900;}
html.dark .oc-turn-caller .oc-bubble{background:#1c2026;border-color:#2b3139;}
html.dark .oc-turn-ai .oc-bubble{background:#000;border-color:#3a424c;}
html.dark .oc-turn-op .oc-bubble{background:#2a1f14;border-color:#5a3a1a;}
html.dark .oc-tile{background:#1a1e23;border-color:#2b3139;}
html.dark nve-button{--background:#1c2026;--border:1px solid #3a424c;--color:#fff;}
html.dark nve-button[interaction=emphasis]{--background:#000;--border:1px solid #5a636e;--color:#fff;}
html.dark nve-button[disabled]{--background:#15181c;--border:1px solid #2b3139;--color:#6b7480;}
html.dark nve-button[data-tone=quiet]{--background:transparent;--border:1px solid transparent;--color:#e6e9ed;}
html.dark nve-button[data-tone=danger]{--background:transparent;--border:1px solid #e0516a;--color:#ff8a9a;}
html.dark nve-button[data-tone=ai]{--background:transparent;--border:1px solid #4f8a1e;--color:#8ccf3a;}
/* ---- « Style : verre liquide » (the Réglages toggle puts/removes .glass on <html>) ----
   Translucent layered surfaces over a soft colour field: blurred backdrop, hairline rims, top highlight, capsule controls.
   Only top-level surfaces blur the backdrop; nested tiles are plain translucent fills (cheaper, same look). */
/* Dark glass: panels are a dark tint over the blurred field, so text always sits on a dark surface and the colour only shows at the rims. */
html.glass{--g-bg:rgba(14,16,26,.68);--g-bg2:rgba(255,255,255,.075);--g-line:rgba(255,255,255,.15);--g-hi:rgba(255,255,255,.22);
  --g-blur:blur(26px) saturate(170%);--g-shadow:0 12px 40px rgba(0,0,0,.42);--g-r:10px;--g-r2:6px;--oc-space:14px;}  /* one flat radius scale: 10px surfaces, 6px tiles */
html.glass body{position:relative;z-index:0;background:#06080f;}
html.glass body::before{content:"";position:fixed;inset:-25%;z-index:-1;pointer-events:none;filter:blur(48px);
  background:radial-gradient(30% 36% at 6% 8%,rgba(255,121,0,.36),transparent 62%),radial-gradient(28% 34% at 95% 4%,rgba(118,185,0,.24),transparent 60%),
    radial-gradient(34% 40% at 94% 96%,rgba(56,120,255,.34),transparent 62%),radial-gradient(28% 34% at 6% 96%,rgba(168,78,255,.28),transparent 60%),#06080f;
  animation:glassdrift 60s ease-in-out infinite alternate;}
@keyframes glassdrift{from{transform:translate3d(0,0,0) scale(1.02);}to{transform:translate3d(-2.5%,2%,0) scale(1.08);}}
@media (prefers-reduced-motion:reduce){html.glass body::before{animation:none;}}
html.glass .nv-dark{--background-color-surface-sunken:transparent;--background-color-surface-base:transparent;--background-color-surface-raised:var(--g-bg2);
  --border-color-base:var(--g-line);--background-color-interaction-hover:rgba(255,255,255,.09);--radius-lg:var(--g-r2);--radius-md:6px;}
html.glass .nv-app-bar-root{background:rgba(8,10,18,.62);backdrop-filter:var(--g-blur);-webkit-backdrop-filter:var(--g-blur);border-bottom:1px solid var(--g-line);}
html.glass .oc-topbar{border-bottom:none;padding:10px 14px 4px;}
html.glass .oc-topbar+div{margin:0 14px 10px;border-radius:999px;opacity:.85;}  /* the mockup's orange/green accent line becomes an inset hairline */
html.glass .oc-bar{position:relative;}
html.glass .oc-bar::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,0) 40%);}  /* specular sheen, kept faint under text */
html.glass .oc-bar{background:var(--g-bg);backdrop-filter:var(--g-blur);-webkit-backdrop-filter:var(--g-blur);border:1px solid var(--g-line);border-radius:var(--g-r);
  padding:8px 12px;box-shadow:var(--g-shadow),inset 0 1px 0 var(--g-hi);}
html.glass .oc-settings{background:rgba(255,255,255,.05);border-radius:var(--g-r2);}
html.glass .oc-chip{background:rgba(255,255,255,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.14);}
html.glass nve-button{--background:rgba(255,255,255,.10);--border:1px solid rgba(255,255,255,.18);--border-radius:999px;}
html.glass nve-button[interaction=emphasis]{--background:rgba(0,0,0,.85);--border:1px solid rgba(255,255,255,.35);--color:#fff;}  /* solid black: the button paints --background as a colour */
html.glass nve-button[disabled]{--background:rgba(255,255,255,.04);--border:1px solid rgba(255,255,255,.08);--color:rgba(255,255,255,.45);}
html.glass nve-button[data-tone=quiet]{--background:transparent;--border:1px solid transparent;}
html.glass nve-button[data-tone=danger]{--background:rgba(255,122,122,.08);--border:1px solid rgba(255,122,122,.5);--color:#ff8a8a;}
html.glass nve-button[data-tone=ai]{--background:rgba(118,185,0,.10);--border:1px solid rgba(118,185,0,.45);}
html.glass .oc-entrycard{background:var(--g-bg);backdrop-filter:var(--g-blur);-webkit-backdrop-filter:var(--g-blur);border:1px solid var(--g-line);border-radius:var(--g-r);padding:44px 56px;
  box-shadow:var(--g-shadow),inset 0 1px 0 var(--g-hi);}
html.glass .oc{gap:12px;padding:0 14px;}
html.glass .oc-list,html.glass .oc-main,html.glass .oc-side{background:var(--g-bg);backdrop-filter:var(--g-blur);-webkit-backdrop-filter:var(--g-blur);
  border:1px solid var(--g-line);border-radius:var(--g-r);box-shadow:var(--g-shadow),inset 0 1px 0 var(--g-hi);}
html.glass .oc-card{border-bottom-color:var(--g-line);}
html.glass .oc-card:hover,html.glass .oc-row:hover{background:rgba(255,255,255,.08);}
html.glass .oc-sec{background:rgba(16,18,30,.96);}
html.glass .oc-count{background:rgba(255,255,255,.10);}
html.glass .oc-card.sel,html.glass .oc-row.sel{background:rgba(118,185,0,.12);}
html.glass .oc-card.mine{background:rgba(255,121,0,.10);}
html.glass .oc-kpis,html.glass .oc-services,html.glass .oc-chip-demo{background:transparent;border-color:transparent;box-shadow:none;}
html.glass .oc-emptybox{border-color:var(--g-line);border-radius:var(--g-r2);}
html.glass .oc-tile{background:rgba(255,255,255,.06);border-color:var(--g-line);border-radius:var(--g-r2);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);}
html.glass .oc-mode{border-radius:var(--g-r2);}
html.glass .oc-turn-caller .oc-bubble{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.16);border-radius:6px 6px 6px 2px;box-shadow:inset 0 1px 0 rgba(255,255,255,.14);}
html.glass .oc-turn-ai .oc-bubble{background:rgba(0,0,0,.8);border-color:rgba(255,255,255,.2);border-radius:6px 6px 2px 6px;}
html.glass .oc-turn-op .oc-bubble{background:rgba(255,121,0,.16);border-color:rgba(255,121,0,.5);border-radius:6px 6px 2px 6px;}
html.glass .oc button:not(.oc-more){border-radius:999px;}
html.glass .oc-talkinput input{border-radius:999px;}
html.glass .oc-col::-webkit-scrollbar,html.glass .oc-tr::-webkit-scrollbar{width:8px;}
html.glass .oc-col::-webkit-scrollbar-thumb,html.glass .oc-tr::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:999px;border:2px solid transparent;background-clip:padding-box;}
html.glass .oc-col::-webkit-scrollbar-track,html.glass .oc-tr::-webkit-scrollbar-track{background:transparent;}
`;
template=swap(template,'</head>', `<style>
@import 'https://cdn.jsdelivr.net/npm/@nvidia-elements/styles/dist/bundles/index.css';
@import 'https://cdn.jsdelivr.net/npm/@nvidia-elements/themes/dist/bundles/index.css';
@import 'https://cdn.jsdelivr.net/npm/@nvidia-elements/themes/dist/fonts/inter.css';
${css}</style><script type="module">import 'https://cdn.jsdelivr.net/npm/@nvidia-elements/core/dist/bundles/index.min.js';</script></head>`);
const output=swap(swap(swap(source,pattern,(_,a,b,c)=>a+JSON.stringify(template).replaceAll('<','\\u003c')+c),
  '<html>', '<html lang="fr" nve-theme="dark">'),
  '<title>Bundled Page</title>','<title>Orange · Urgences · Démonstration</title>');
if(JSON.parse(output.match(pattern)[2])!==template)throw Error('Bundle round-trip failed');
for(const forbidden of ['speechSynthesis','SpeechRecognition','get_medical_alerts','alert_units','request_aml_fix','const EXTRA']) {
  if(logic.includes(forbidden))throw Error('Legacy simulation leaked: '+forbidden);
}
for(const needed of ['{{ liveControls }}','{{ consoleView }}']) {
  if(!template.includes(needed))throw Error('Binding not mounted: '+needed);
}
for(const gone of ['{{ soundLabel }}','{{ audioLabel }}','{{ shiftTime }}']) {
  if(template.includes(gone))throw Error('Header label still mounted: '+gone);
}
if(/\{\{ (isFloor|isCall|alerts|aiRows|historyRows|sideGroups) \}\}/.test(template))throw Error('Mockup floor or call view still mounted');
const out=path.join(HERE,'dist');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'urgence.html'),output);
fs.writeFileSync(path.join(out,'controller.js'),logic);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const receipt={source:sourcePath,source_sha256:hash(source),deployed_sha256:hash(output),
  original_untouched:true,scenarios:scenarios.length,dispatch_connected:false};
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));

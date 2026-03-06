import { useState, useMemo, useCallback, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// API CONFIG
// ═══════════════════════════════════════════════════════════════
const API_BASE = 'https://script.google.com/macros/s/AKfycbzCtCQKf8vpLVltYF21LjA40A4L-8UDJe3qV2Fx17E8r0XEFg55QjfzB2s5_5d4Ohu8Jg/exec';

let _jsonpId = 0;
function jsonpFetch(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const cbName = '__jsonp_' + (++_jsonpId) + '_' + Date.now();
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Request timeout'));
    }, timeout);
    const script = document.createElement('script');

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => { cleanup(); reject(new Error('Network error')); };
    document.head.appendChild(script);
  });
}

function apiCall(action, params = {}) {
  let url = API_BASE + '?action=' + action;
  Object.entries(params).forEach(([k, v]) => { if (v) url += '&' + k + '=' + encodeURIComponent(v); });
  return jsonpFetch(url);
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
const fmt = (n) => n == null ? "—" : typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n;
const fmtD = (n) => n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmtPct = (n) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
const COLORS = { yr2023: "#8b5cf6", yr2024: "#3b82f6", yr2025: "#22c55e", blue: "#3b82f6", teal: "#2dd4bf", profit: "#22c55e", price: "#eab308", revenue: "#3b82f6" };
const OOS_C = { 2023: "#ef4444", 2024: "#f87171", 2025: "#fca5a5" };
const YR_C = { 2023: COLORS.yr2023, 2024: COLORS.yr2024, 2025: COLORS.yr2025 };

function getStatus(doc, lt, buf, th) {
  const cd = th?.critDays || lt, wd = th?.warnDays || (lt + buf);
  if (doc <= cd) return "critical";
  if (doc <= wd) return "warning";
  return "healthy";
}
function calcAllIn(c) { return (c.raw||0)+(c.inb||0)+(c.pp||0)+(c.jfn||0)+(c.pq||0)+(c.ji||0)+(c.fba||0); }
function calcSeasonal(coreId, hist) {
  const ms = (hist||[]).filter(h => h.core === coreId);
  if (ms.length < 6) return false;
  const ds = ms.map(m => m.avgDsr), mn = ds.reduce((a,b)=>a+b,0)/ds.length;
  if (mn === 0) return false;
  return Math.sqrt(ds.reduce((a,b)=>a+Math.pow(b-mn,2),0)/ds.length)/mn > 0.3;
}
function calcRecheck(c) { const a = calcAllIn(c); if (c.dsr<=0) return false; return Math.abs(a/c.dsr - c.doc)/(c.doc||1) > 0.25; }
function calcNeedQty(c, targetDoc) { return Math.ceil(Math.max(0, targetDoc * c.dsr - calcAllIn(c))); }
function calcDocAfter(c, qty) { return c.dsr > 0 ? +((calcAllIn(c)+qty)/c.dsr).toFixed(1) : 999; }

// ═══════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════════
function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  return (<span className="relative inline-block ml-1">
    <button onClick={e=>{e.stopPropagation();setOpen(!open)}} className="text-gray-500 hover:text-gray-300 text-xs font-bold w-4 h-4 rounded-full border border-gray-600 inline-flex items-center justify-center">i</button>
    {open && <div className="absolute z-50 bg-gray-800 text-gray-200 text-xs p-3 rounded-lg shadow-xl border border-gray-700 w-64 -left-28 top-6" onClick={e=>e.stopPropagation()}>{text}<button onClick={()=>setOpen(false)} className="block mt-2 text-gray-400 hover:text-white text-xs">Close</button></div>}
  </span>);
}
function StatusDot({ status }) {
  return <span className={`inline-block w-3 h-3 rounded-full ${status==="critical"?"bg-red-500 animate-pulse":status==="warning"?"bg-amber-500":"bg-emerald-500"}`}/>;
}
function Toggle({ label, value, onChange }) {
  return (<label className="flex items-center justify-between cursor-pointer"><span className="text-sm text-gray-300">{label}</span>
    <button onClick={()=>onChange(!value)} className={`relative w-10 h-5 rounded-full transition-colors ${value?"bg-blue-600":"bg-gray-600"}`}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{left:value?"22px":"2px"}}/></button></label>);
}
function Loader({ text }) {
  return <div className="flex items-center justify-center py-20"><div className="text-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"/><p className="text-gray-400 text-sm">{text||"Loading..."}</p></div></div>;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════
function SettingsModal({ settings, setSettings, onClose }) {
  const [l, setL] = useState({...settings});
  return (<div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={onClose}>
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e=>e.stopPropagation()}>
      <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>
      <div className="space-y-4">
        <div><label className="text-sm text-gray-400 block mb-1">Target DOC (days)</label>
          <input type="number" value={l.targetDoc} onChange={e=>setL({...l,targetDoc:+e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/></div>
        <div><label className="text-sm text-gray-400 block mb-1">Critical Threshold</label>
          <select value={l.critMode} onChange={e=>setL({...l,critMode:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full">
            <option value="lt">Lead Time (per vendor)</option><option value="custom">Custom Days</option></select>
          {l.critMode==="custom"&&<input type="number" value={l.critDays} onChange={e=>setL({...l,critDays:+e.target.value})} className="mt-2 bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/>}</div>
        <div><label className="text-sm text-gray-400 block mb-1">Warning Threshold</label>
          <select value={l.warnMode} onChange={e=>setL({...l,warnMode:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full">
            <option value="ltbuf">Lead Time + Buffer</option><option value="custom">Custom Days</option></select>
          {l.warnMode==="custom"&&<input type="number" value={l.warnDays} onChange={e=>setL({...l,warnDays:+e.target.value})} className="mt-2 bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/>}</div>
        <div className="border-t border-gray-700 pt-4"><label className="text-sm text-gray-400 block mb-3">Data Filters</label>
          <div className="space-y-3">
            <Toggle label="Show Active (active=Yes)" value={l.filterActive} onChange={v=>setL({...l,filterActive:v})}/>
            <Toggle label="Show Ignored (ignoreUntil set)" value={l.filterIgnored} onChange={v=>setL({...l,filterIgnored:v})}/>
            <Toggle label="Show Visible (visible=Yes)" value={l.filterVisible} onChange={v=>setL({...l,filterVisible:v})}/>
          </div></div>
      </div>
      <div className="flex gap-3 mt-6">
        <button onClick={()=>{setSettings(l);onClose()}} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2 font-medium">Save</button>
        <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg py-2 font-medium">Cancel</button></div>
    </div></div>);
}

// ═══════════════════════════════════════════════════════════════
// GLOSSARY (editable)
// ═══════════════════════════════════════════════════════════════
const DEFAULT_GLOSSARY = [
  { term: "C.DSR", desc: "Composite Daily Sales Rate — weighted average units sold per day across all bundles of a core." },
  { term: "7D DSR", desc: "7-Day Daily Sales Rate — average units/day over the last 7 days." },
  { term: "DOC", desc: "Days of Coverage — All-In Own Pieces ÷ C.DSR." },
  { term: "All-In Own Pieces", desc: "Total pipeline inventory: Raw + Inbound + Pre-Proc + JFN + Proc Queue + JI + FBA." },
  { term: "Seasonal", desc: "CV of monthly DSR > 0.3. CV = StdDev(monthly DSR) ÷ Mean(monthly DSR)." },
  { term: "RECHECK", desc: "Flagged when calculated DOC differs from reported DOC by >25%." },
  { term: "OOS Days", desc: "Out-of-Stock days per month from coreInv.oosDays. Only shown when > 0." },
  { term: "Qty Needed", desc: "max(0, Target DOC × DSR − All-In Own Pieces), rounded up." },
  { term: "Need $", desc: "Qty Needed × Unit Cost." },
  { term: "DOC After", desc: "(All-In Own Pieces + Qty Needed) ÷ DSR." },
  { term: "GP", desc: "Gross Profit per unit = Price − Fees − COGS − AICOGS." },
  { term: "Pipeline", desc: "Raw → Inbound → Pre-Proc → JFN → Proc Queue → JI → FBA." },
];

function GlossaryTab({ glossary, setGlossary }) {
  const [ed, setEd] = useState(null);
  const [et, setEt] = useState(""); const [edesc, setEdesc] = useState("");
  const [adding, setAdding] = useState(false); const [nt, setNt] = useState(""); const [nd, setNd] = useState("");
  return (<div className="p-4 max-w-4xl mx-auto">
    <div className="flex items-center justify-between mb-2"><h2 className="text-xl font-bold text-white">Glossary</h2>
      <button onClick={()=>setAdding(!adding)} className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg">+ Add</button></div>
    <p className="text-gray-400 text-sm mb-4">Click to edit any entry.</p>
    {adding&&<div className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700 space-y-2">
      <input value={nt} onChange={e=>setNt(e.target.value)} placeholder="Term..." className="bg-gray-900 border border-gray-600 text-white rounded px-3 py-2 w-full text-sm"/>
      <textarea value={nd} onChange={e=>setNd(e.target.value)} placeholder="Description..." className="bg-gray-900 border border-gray-600 text-white rounded px-3 py-2 w-full text-sm" rows={2}/>
      <div className="flex gap-2"><button onClick={()=>{if(nt.trim()){setGlossary([...glossary,{term:nt,desc:nd}]);setNt("");setNd("");setAdding(false)}}} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded">Save</button>
        <button onClick={()=>setAdding(false)} className="text-xs bg-gray-600 text-white px-3 py-1.5 rounded">Cancel</button></div></div>}
    <div className="space-y-1">{glossary.map((g,i)=>(<div key={i}>{ed===i?
      <div className="bg-gray-800 rounded-lg p-3 border border-blue-500/50 space-y-2">
        <input value={et} onChange={e=>setEt(e.target.value)} className="bg-gray-900 border border-gray-600 text-blue-400 font-mono rounded px-3 py-1.5 w-full text-sm font-semibold"/>
        <textarea value={edesc} onChange={e=>setEdesc(e.target.value)} className="bg-gray-900 border border-gray-600 text-gray-200 rounded px-3 py-1.5 w-full text-sm" rows={3}/>
        <div className="flex gap-2"><button onClick={()=>{const u=[...glossary];u[i]={term:et,desc:edesc};setGlossary(u);setEd(null)}} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded">Save</button>
          <button onClick={()=>setEd(null)} className="text-xs bg-gray-600 text-white px-3 py-1.5 rounded">Cancel</button>
          <button onClick={()=>{setGlossary(glossary.filter((_,x)=>x!==i));setEd(null)}} className="text-xs bg-red-600/80 text-white px-3 py-1.5 rounded ml-auto">Delete</button></div></div>
      :<div onClick={()=>{setEd(i);setEt(g.term);setEdesc(g.desc)}} className={`flex gap-4 py-3 px-4 rounded-lg cursor-pointer hover:bg-gray-800/70 ${i%2===0?"bg-gray-900/50":""}`}>
        <span className="text-blue-400 font-mono font-semibold text-sm min-w-[140px] shrink-0">{g.term}</span>
        <span className="text-gray-300 text-sm">{g.desc}</span></div>}</div>))}</div></div>);
}

// ═══════════════════════════════════════════════════════════════
// PURCHASING TAB
// ═══════════════════════════════════════════════════════════════
function PurchasingTab({ data, settings, onViewCore }) {
  const [vm, setVm] = useState("core");
  const [sortBy, setSortBy] = useState("status");
  const [vf, setVf] = useState(""); const [sf, setSf] = useState("");
  const vendorMap = useMemo(()=>{const m={};(data.vendors||[]).forEach(v=>{m[v.name]=v});return m},[data.vendors]);
  const salesMap = useMemo(()=>{const m={};(data.sales||[]).forEach(s=>{m[s.j]=s});return m},[data.sales]);
  const enriched = useMemo(()=>{
    return (data.cores||[]).filter(c=>{
      if(settings.filterActive&&c.active!=="Yes")return false;
      if(!settings.filterIgnored&&!!c.ignoreUntil)return false;
      if(settings.filterVisible&&c.visible!=="Yes")return false;
      return true;
    }).map(c=>{
      const v=vendorMap[c.ven]||{};const lt=v.lt||30;
      const cd=settings.critMode==="custom"?settings.critDays:lt;
      const wd=settings.warnMode==="custom"?settings.warnDays:lt+(c.buf||14);
      const st=getStatus(c.doc,lt,c.buf,{critDays:cd,warnDays:wd});
      const allIn=calcAllIn(c);const nq=calcNeedQty(c,settings.targetDoc);
      const jls=(c.jlsList||"").split(",").filter(Boolean);
      let ltRev=0,ltProf=0,tyRev=0,lyRev=0;
      jls.forEach(j=>{const s=salesMap[j.trim()];if(s){ltRev+=s.ltR;ltProf+=s.ltP;tyRev+=s.tyR;lyRev+=s.lyR}});
      return {...c,status:st,allIn,needQty:nq,needDollar:+(nq*c.cost).toFixed(2),docAfter:calcDocAfter(c,nq),lt,critDays:cd,warnDays:wd,ltRev,ltProf,tyRev,lyRev,recheck:calcRecheck(c)};
    }).filter(c=>{if(vf&&c.ven!==vf)return false;if(sf&&c.status!==sf)return false;return true})
    .sort((a,b)=>{
      const so={critical:0,warning:1,healthy:2};
      if(sortBy==="status")return so[a.status]-so[b.status];
      if(sortBy==="ltRevenue")return b.ltRev-a.ltRev;
      if(sortBy==="ltProfit")return b.ltProf-a.ltProf;
      if(sortBy==="tyRevenue")return b.tyRev-a.tyRev;
      return 0;
    });
  },[data,settings,vf,sf,sortBy,vendorMap,salesMap]);
  const sc=useMemo(()=>{const c={critical:0,warning:0,healthy:0};enriched.forEach(x=>c[x.status]++);return c},[enriched]);
  const dc=(doc,cd,wd)=>doc<=cd?"text-red-400":doc<=wd?"text-amber-400":"text-emerald-400";
  const vendorGroups=useMemo(()=>{if(vm!=="vendor")return[];const g={};enriched.forEach(c=>{if(!g[c.ven])g[c.ven]={vendor:vendorMap[c.ven]||{name:c.ven},cores:[],totalNeed:0,totalQty:0};g[c.ven].cores.push(c);g[c.ven].totalNeed+=c.needDollar;g[c.ven].totalQty+=c.needQty});return Object.values(g).sort((a,b)=>b.cores.filter(c=>c.status==="critical").length-a.cores.filter(c=>c.status==="critical").length)},[enriched,vm,vendorMap]);

  return (<div className="p-4">
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <div className="flex bg-gray-800 rounded-lg p-0.5">
        <button onClick={()=>setVm("core")} className={`px-3 py-1.5 rounded-md text-sm font-medium ${vm==="core"?"bg-blue-600 text-white":"text-gray-400 hover:text-white"}`}>By Core</button>
        <button onClick={()=>setVm("vendor")} className={`px-3 py-1.5 rounded-md text-sm font-medium ${vm==="vendor"?"bg-blue-600 text-white":"text-gray-400 hover:text-white"}`}>By Vendor</button></div>
      <select value={vf} onChange={e=>setVf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5">
        <option value="">All Vendors</option>{(data.vendors||[]).map(v=><option key={v.name} value={v.name}>{v.name}</option>)}</select>
      <select value={sf} onChange={e=>setSf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5">
        <option value="">All Status</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>
      {vm==="core"&&<select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5">
        <option value="status">Priority</option><option value="ltRevenue">LT Revenue</option><option value="ltProfit">LT Profit</option><option value="tyRevenue">TY Revenue</option></select>}
      <div className="flex gap-2 ml-auto text-xs">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"/>{sc.critical}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"/>{sc.warning}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"/>{sc.healthy}</span></div>
    </div>
    {vm==="core"&&<div className="overflow-x-auto rounded-xl border border-gray-800"><table className="w-full"><thead>
      <tr className="bg-gray-900/80 text-xs text-gray-400 uppercase tracking-wider">
        <th className="py-3 px-2 w-8"/><th className="py-3 px-2 text-left">Core</th><th className="py-3 px-2 text-left">Vendor</th>
        <th className="py-3 px-2 text-left">Title</th><th className="py-3 px-2 text-right">C.DSR</th><th className="py-3 px-2 text-right">7D</th>
        <th className="py-3 px-2 text-center">Trend</th><th className="py-3 px-2 text-right">DOC</th>
        <th className="py-3 px-2 text-right">All-In Pcs<InfoTip text="Raw+Inbound+PreProc+JFN+ProcQ+JI+FBA"/></th>
        <th className="py-3 px-2 text-center">Flags</th><th className="py-3 px-2 text-right">LT Rev</th>
        <th className="py-3 px-1 border-l-2 border-gray-600"/>
        <th className="py-3 px-2 text-right">Qty Need</th><th className="py-3 px-2 text-right">Need $</th>
        <th className="py-3 px-2 text-right">DOC After</th><th className="py-3 px-2 w-16"/></tr></thead>
      <tbody>{enriched.map(c=>(<tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 text-sm">
        <td className="py-2 px-2"><StatusDot status={c.status}/></td>
        <td className="py-2 px-2 text-blue-400 font-mono text-xs">{c.id}</td>
        <td className="py-2 px-2 text-gray-400 text-xs truncate max-w-[120px]">{c.ven}</td>
        <td className="py-2 px-2 text-gray-200 truncate max-w-[180px]">{c.ti}</td>
        <td className="py-2 px-2 text-right">{fmt(c.dsr)}</td><td className="py-2 px-2 text-right">{fmt(c.d7)}</td>
        <td className="py-2 px-2 text-center">{c.d7>c.dsr?<span className="text-emerald-400">▲</span>:<span className="text-red-400">▼</span>}</td>
        <td className={`py-2 px-2 text-right font-semibold ${dc(c.doc,c.critDays,c.warnDays)}`}>{fmt(c.doc)}</td>
        <td className="py-2 px-2 text-right">{fmt(c.allIn)}</td>
        <td className="py-2 px-2 text-center">{c.recheck&&<span className="text-amber-400 text-xs font-bold px-1 py-0.5 bg-amber-400/10 rounded">⚠CHK</span>}</td>
        <td className="py-2 px-2 text-right text-gray-300">{fmtD(c.ltRev)}</td>
        <td className="py-2 px-1 border-l-2 border-gray-600"/>
        <td className="py-2 px-2 text-right">{c.needQty>0?fmt(c.needQty):"—"}</td>
        <td className="py-2 px-2 text-right text-amber-300 font-semibold">{c.needDollar>0?fmtD(c.needDollar):"—"}</td>
        <td className={`py-2 px-2 text-right ${dc(c.docAfter,c.critDays,c.warnDays)}`}>{fmt(c.docAfter)}</td>
        <td className="py-2 px-2"><button onClick={()=>onViewCore(c.id)} className="text-blue-400 text-xs px-2 py-1 bg-blue-400/10 rounded">View</button></td>
      </tr>))}</tbody></table></div>}
    {vm==="vendor"&&vendorGroups.map(grp=>{const v=grp.vendor;const meets=grp.totalNeed>=(v.moqDollar||0);
      return(<div key={v.name} className="mb-6 border border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-white font-semibold">{v.name}</span><span className="text-xs text-gray-400">LT:{v.lt}d</span><span className="text-xs text-gray-400">MOQ:{fmtD(v.moqDollar)}</span>
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded ${meets?"text-emerald-400 bg-emerald-400/10":"text-red-400 bg-red-400/10"}`}>{meets?"✓ MOQ":`✗ ${fmtD(grp.totalNeed)}/${fmtD(v.moqDollar)}`}</span></div>
        <table className="w-full"><thead><tr className="text-xs text-gray-500 uppercase bg-gray-900/40">
          <th className="py-2 px-2 w-8"/><th className="py-2 px-2 text-left">Core</th><th className="py-2 px-2 text-left">Title</th>
          <th className="py-2 px-2 text-right">DSR</th><th className="py-2 px-2 text-right">DOC</th><th className="py-2 px-2 text-right">All-In</th>
          <th className="py-2 px-1 border-l-2 border-gray-600"/><th className="py-2 px-2 text-right">Qty</th><th className="py-2 px-2 text-right">Need$</th>
          <th className="py-2 px-2 text-right">After</th><th className="py-2 px-2 w-16"/></tr></thead>
        <tbody>{grp.cores.map(c=>(<tr key={c.id} className="border-t border-gray-800/30 hover:bg-gray-800/20 text-sm">
          <td className="py-2 px-2"><StatusDot status={c.status}/></td>
          <td className="py-2 px-2 text-blue-400 font-mono text-xs">{c.id}</td>
          <td className="py-2 px-2 text-gray-200 truncate max-w-[200px]">{c.ti}</td>
          <td className="py-2 px-2 text-right">{fmt(c.dsr)}</td>
          <td className={`py-2 px-2 text-right font-semibold ${dc(c.doc,c.critDays,c.warnDays)}`}>{fmt(c.doc)}</td>
          <td className="py-2 px-2 text-right">{fmt(c.allIn)}</td>
          <td className="py-2 px-1 border-l-2 border-gray-600"/>
          <td className="py-2 px-2 text-right">{c.needQty>0?fmt(c.needQty):"—"}</td>
          <td className="py-2 px-2 text-right text-amber-300">{c.needDollar>0?fmtD(c.needDollar):"—"}</td>
          <td className={`py-2 px-2 text-right ${dc(c.docAfter,c.critDays,c.warnDays)}`}>{fmt(c.docAfter)}</td>
          <td className="py-2 px-2"><button onClick={()=>onViewCore(c.id)} className="text-blue-400 text-xs px-2 py-1 bg-blue-400/10 rounded">View</button></td>
        </tr>))}
        <tr className="bg-gray-900/60 font-semibold text-sm"><td colSpan={6} className="py-2 px-2 text-right text-gray-300">Total:</td>
          <td className="border-l-2 border-gray-600"/><td className="py-2 px-2 text-right">{fmt(grp.totalQty)}</td>
          <td className="py-2 px-2 text-right text-amber-300">{fmtD(grp.totalNeed)}</td><td colSpan={2}/></tr>
        </tbody></table></div>)})}
  </div>);
}

// ═══════════════════════════════════════════════════════════════
// CORE DETAIL — loads history on demand
// ═══════════════════════════════════════════════════════════════
function CoreDetailTab({ data, settings, initialCoreId, onGoBundle }) {
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(initialCoreId||null);
  const [hist, setHist] = useState(null);
  const [histLoading, setHistLoading] = useState(false);
  useEffect(()=>{if(initialCoreId)setSel(initialCoreId)},[initialCoreId]);

  // Load history when a core is selected
  useEffect(()=>{
    if(!sel){setHist(null);return}
    setHistLoading(true);
    apiCall('coreSummary',{id:sel}).then(d=>{setHist(d);setHistLoading(false)}).catch(()=>setHistLoading(false));
  },[sel]);

  const filtered=useMemo(()=>{if(!search)return(data.cores||[]).slice(0,15);const q=search.toLowerCase();return(data.cores||[]).filter(c=>c.id.toLowerCase().includes(q)||c.ti.toLowerCase().includes(q)).slice(0,15)},[search,data.cores]);
  const core=sel?(data.cores||[]).find(c=>c.id===sel):null;
  const vendor=core?(data.vendors||[]).find(v=>v.name===core.ven):null;
  const lt=vendor?.lt||30;
  const salesMap=useMemo(()=>{const m={};(data.sales||[]).forEach(s=>{m[s.j]=s});return m},[data.sales]);
  const feesMap=useMemo(()=>{const m={};(data.fees||[]).forEach(f=>{m[f.j]=f});return m},[data.fees]);
  const coreSales=useMemo(()=>{if(!core)return null;const jls=(core.jlsList||"").split(",").filter(Boolean).map(j=>j.trim());const a={ltR:0,ltP:0,lyR:0,lyP:0,tyR:0,tyP:0};jls.forEach(j=>{const s=salesMap[j];if(s){a.ltR+=s.ltR;a.ltP+=s.ltP;a.lyR+=s.lyR;a.lyP+=s.lyP;a.tyR+=s.tyR;a.tyP+=s.tyP}});return a},[core,salesMap]);

  // Chart data from history
  const years=useMemo(()=>hist?.coreInv?[...new Set(hist.coreInv.map(h=>h.y))].sort():[],[hist]);
  const oosYears=useMemo(()=>years.filter(y=>(hist?.coreInv||[]).some(h=>h.y===y&&h.oosDays>0)),[hist,years]);
  const yearTotals=useMemo(()=>{const t={};years.forEach(y=>{const r=(hist?.coreInv||[]).filter(h=>h.y===y);t[y]=r.length?+(r.reduce((s,x)=>s+x.avgDsr,0)/r.length).toFixed(1):0});return t},[hist,years]);
  const dsrChart=useMemo(()=>{if(!hist?.coreInv)return[];return Array.from({length:12},(_,i)=>{const row={month:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i]};years.forEach(y=>{const h=hist.coreInv.find(x=>x.y===y&&x.m===i+1);row[`dsr_${y}`]=h?h.avgDsr:null;if(h&&h.oosDays>0)row[`oos_${y}`]=h.oosDays});return row})},[hist,years]);
  const unitsChart=useMemo(()=>{if(!hist?.bundleSales)return[];const byMY={};hist.bundleSales.forEach(h=>{const k=`${h.y}-${h.m}`;if(!byMY[k])byMY[k]={y:h.y,m:h.m,units:0};byMY[k].units+=h.units});return Array.from({length:12},(_,i)=>{const row={month:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i]};years.forEach(y=>{const r=byMY[`${y}-${i+1}`];row[`units_${y}`]=r?r.units:null});return row})},[hist,years]);

  const allIn=core?calcAllIn(core):0;
  const status=core?getStatus(core.doc,lt,core.buf||14,settings):"healthy";
  const totalOos=(hist?.coreInv||[]).filter(h=>h.oosDays>0).reduce((s,h)=>s+h.oosDays,0);
  const nq=core?calcNeedQty(core,settings.targetDoc):0;
  const da=core?calcDocAfter(core,nq):0;
  const pipeline=core?[{l:"Raw",v:core.raw},{l:"Inbound",v:core.inb},{l:"Pre-Proc",v:core.pp},{l:"JFN",v:core.jfn},{l:"Proc Q",v:core.pq},{l:"JI",v:core.ji},{l:"FBA",v:core.fba}]:[];
  const maxP=Math.max(...pipeline.map(p=>p.v),1);
  const coreBundles=useMemo(()=>{if(!core)return[];const jls=(core.jlsList||"").split(",").filter(Boolean).map(j=>j.trim());return(data.bundles||[]).filter(b=>jls.includes(b.j)).map(b=>({...b,fee:feesMap[b.j],sale:salesMap[b.j],pct:core.dsr>0?+((b.cd/core.dsr)*100).toFixed(1):0}))},[core,data.bundles,feesMap,salesMap]);

  if(!core) return(<div className="p-4 max-w-4xl mx-auto">
    <input type="text" placeholder="Search cores..." value={search} onChange={e=>setSearch(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full max-w-md text-sm mb-4"/>
    <div className="space-y-1">{filtered.map(c=>(<button key={c.id} onClick={()=>setSel(c.id)} className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-900/50 hover:bg-gray-800 flex items-center gap-3">
      <StatusDot status={getStatus(c.doc,(data.vendors||[]).find(v=>v.name===c.ven)?.lt||30,c.buf,settings)}/>
      <span className="text-blue-400 font-mono text-sm">{c.id}</span><span className="text-gray-300 text-sm truncate">{c.ti}</span>
      <span className="ml-auto text-gray-500 text-xs">DSR:{fmt(c.dsr)}</span></button>))}</div></div>);

  return(<div className="p-4 max-w-6xl mx-auto">
    <button onClick={()=>setSel(null)} className="text-gray-400 hover:text-white text-sm mb-4">← Back</button>
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-xl font-bold text-white">{core.id}</span><StatusDot status={status}/>
        <span className={`text-xs px-2 py-0.5 rounded font-semibold ${status==="critical"?"bg-red-500/20 text-red-400":status==="warning"?"bg-amber-500/20 text-amber-400":"bg-emerald-500/20 text-emerald-400"}`}>{status.toUpperCase()}</span>
        {totalOos>0&&<span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-semibold">OOS:{totalOos}d</span>}
      </div>
      <p className="text-gray-300 text-sm mb-1">{core.ti}</p>
      <p className="text-gray-500 text-xs">{core.ven} · {fmtD(core.cost)} · LT:{lt}d · {core.cat}</p></div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
      {[{l:"C.DSR",v:fmt(core.dsr)},{l:"7D DSR",v:fmt(core.d7)},{l:"DOC",v:fmt(core.doc),c:core.doc<=lt?"text-red-400":core.doc<=lt+(core.buf||14)?"text-amber-400":"text-emerald-400"},{l:"All-In Own Pcs",v:fmt(allIn)},{l:"Inbound",v:fmt(core.inb)}].map(k=>
        <div key={k.l} className="bg-gray-900 rounded-lg p-3 border border-gray-800"><div className="text-gray-500 text-xs mb-1">{k.l}</div><div className={`text-lg font-bold ${k.c||"text-white"}`}>{k.v}</div></div>)}</div>
    {coreSales&&<div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <h3 className="text-white font-semibold text-sm mb-3">Profitability</h3>
      <table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs uppercase"><th className="text-left py-2"/><th className="text-right py-2">Lifetime</th><th className="text-right py-2">Last Yr</th><th className="text-right py-2">This Yr</th></tr></thead>
      <tbody><tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Revenue</td><td className="py-2 text-right text-white">{fmtD(coreSales.ltR)}</td><td className="py-2 text-right">{fmtD(coreSales.lyR)}</td><td className="py-2 text-right">{fmtD(coreSales.tyR)}</td></tr>
      <tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Profit</td><td className="py-2 text-right text-emerald-400">{fmtD(coreSales.ltP)}</td><td className="py-2 text-right text-emerald-400">{fmtD(coreSales.lyP)}</td><td className="py-2 text-right text-emerald-400">{fmtD(coreSales.tyP)}</td></tr></tbody></table></div>}
    {/* Charts */}
    {histLoading?<Loader text="Loading history..."/>:hist&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h3 className="text-white font-semibold text-sm mb-1">Monthly DSR (YoY)</h3>
        {oosYears.length>0&&<p className="text-red-400 text-xs mb-2 font-semibold">🔴 OOS: {oosYears.join(", ")}</p>}
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={dsrChart}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
            <XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis yAxisId="left" tick={{fill:"#9ca3af",fontSize:11}}/>
            {oosYears.length>0&&<YAxis yAxisId="right" orientation="right" tick={{fill:"#ef4444",fontSize:11}}/>}
            <Tooltip contentStyle={{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}} formatter={(v,n)=>{if(v==null)return[null,null];if(n.startsWith("oos_"))return v===0?[null,null]:[v+"d","🔴 OOS "+n.split("_")[1]];return[v,"DSR "+n.split("_")[1]]}}/>
            <Legend formatter={v=>v.startsWith("oos_")?"🔴OOS "+v.split("_")[1]:`DSR ${v.split("_")[1]} (${yearTotals[v.split("_")[1]]||"—"})`}/>
            {years.map(y=><Bar key={`dsr_${y}`} yAxisId="left" dataKey={`dsr_${y}`} fill={YR_C[y]||"#6b7280"} opacity={0.85} radius={[2,2,0,0]}/>)}
            {oosYears.map(y=><Bar key={`oos_${y}`} yAxisId="right" dataKey={`oos_${y}`} fill={OOS_C[y]||"#ef4444"} opacity={0.8} barSize={6} radius={[2,2,0,0]}/>)}
          </ComposedChart></ResponsiveContainer></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h3 className="text-white font-semibold text-sm mb-3">Monthly Sales Units (YoY)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={unitsChart}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/>
            <XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis tick={{fill:"#9ca3af",fontSize:11}}/>
            <Tooltip contentStyle={{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}}/><Legend/>
            {years.map(y=><Line key={`u_${y}`} dataKey={`units_${y}`} stroke={YR_C[y]||"#6b7280"} strokeWidth={2} dot={{r:3}} connectNulls name={`${y}`}/>)}
          </LineChart></ResponsiveContainer></div></div>}
    {/* Pipeline */}
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <h3 className="text-white font-semibold text-sm mb-3">Pipeline</h3>
      <div className="flex items-end gap-2 h-32">{pipeline.map((p,i)=>(<div key={p.l} className="flex-1 flex flex-col items-center">
        <span className="text-white text-xs font-semibold mb-1">{fmt(p.v)}</span>
        <div className="w-full rounded-t-md" style={{height:`${Math.max((p.v/maxP)*80,4)}px`,backgroundColor:i===pipeline.length-1?COLORS.blue:i===0?COLORS.teal:"#6b7280"}}/>
        <span className="text-gray-500 text-xs mt-1">{p.l}</span></div>))}</div></div>
    {/* Bundles */}
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800 overflow-x-auto">
      <h3 className="text-white font-semibold text-sm mb-3">Bundles</h3>
      <table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs uppercase">
        <th className="py-2 px-2 text-left">JLS</th><th className="py-2 px-2 text-left">Title</th><th className="py-2 px-2 text-right">DSR</th>
        <th className="py-2 px-2 text-right">%</th><th className="py-2 px-2 text-right">FIB DOC</th>
        <th className="py-2 px-1 border-l-2 border-gray-600"/><th className="py-2 px-2 text-right">Price</th><th className="py-2 px-2 text-right">GP</th>
        <th className="py-2 px-2 text-right">LT Profit</th><th className="py-2 px-2 w-16"/></tr></thead>
      <tbody>{coreBundles.map(b=>(<tr key={b.j} className="border-t border-gray-800/50 hover:bg-gray-800/20">
        <td className="py-2 px-2 text-blue-400 font-mono text-xs">{b.j}</td>
        <td className="py-2 px-2 text-gray-200 truncate max-w-[180px]">{b.t}</td>
        <td className="py-2 px-2 text-right">{fmt(b.cd)}</td><td className="py-2 px-2 text-right text-gray-300">{b.pct}%</td>
        <td className="py-2 px-2 text-right">{fmt(b.fibDoc)}</td><td className="py-2 px-1 border-l-2 border-gray-600"/>
        <td className="py-2 px-2 text-right">{b.fee?fmtD(b.fee.pr):"—"}</td>
        <td className="py-2 px-2 text-right text-emerald-400">{b.fee?fmtD(b.fee.gp):"—"}</td>
        <td className="py-2 px-2 text-right">{b.sale?fmtD(b.sale.ltP):"—"}</td>
        <td className="py-2 px-2"><button onClick={()=>onGoBundle(b.j)} className="text-blue-400 text-xs px-2 py-1 bg-blue-400/10 rounded">View</button></td>
      </tr>))}</tbody></table></div>
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <h3 className="text-white font-semibold text-sm mb-3">Purchase Recommendation</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><div className="text-gray-500 text-xs">Current DOC</div><div className={`text-lg font-bold ${core.doc<=lt?"text-red-400":"text-white"}`}>{fmt(core.doc)}</div></div>
        <div><div className="text-gray-500 text-xs">Qty for {settings.targetDoc}d</div><div className="text-lg font-bold text-white">{fmt(nq)}</div></div>
        <div><div className="text-gray-500 text-xs">Cost</div><div className="text-lg font-bold text-amber-300">{fmtD(nq*core.cost)}</div></div>
        <div><div className="text-gray-500 text-xs">DOC After</div><div className="text-lg font-bold text-emerald-400">{fmt(da)}</div></div></div></div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════
// BUNDLE DETAIL — loads history on demand
// ═══════════════════════════════════════════════════════════════
function BundleDetailTab({ data, settings, onGoCore, initialBundleId }) {
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(initialBundleId||null);
  const [hist, setHist] = useState(null);
  const [hLoad, setHLoad] = useState(false);
  useEffect(()=>{if(initialBundleId)setSel(initialBundleId)},[initialBundleId]);
  useEffect(()=>{
    if(!sel){setHist(null);return}
    setHLoad(true);
    apiCall('bundleSummary',{id:sel}).then(d=>{setHist(d);setHLoad(false)}).catch(()=>setHLoad(false));
  },[sel]);

  const filtered=useMemo(()=>{if(!search)return(data.bundles||[]).slice(0,15);const q=search.toLowerCase();return(data.bundles||[]).filter(b=>b.j.toLowerCase().includes(q)||b.t.toLowerCase().includes(q)).slice(0,15)},[search,data.bundles]);
  const bundle=sel?(data.bundles||[]).find(b=>b.j===sel):null;
  const fee=bundle?(data.fees||[]).find(f=>f.j===bundle.j):null;
  const sale=bundle?(data.sales||[]).find(s=>s.j===bundle.j):null;
  const core=bundle?(data.cores||[]).find(c=>c.id===bundle.core1):null;

  const salesHist=useMemo(()=>(hist?.sales||[]).sort((a,b)=>a.month.localeCompare(b.month)),[hist]);
  const priceHist=useMemo(()=>(hist?.prices||[]).sort((a,b)=>a.month.localeCompare(b.month)),[hist]);
  const yoyYears=useMemo(()=>[...new Set(salesHist.map(h=>h.y))].sort(),[salesHist]);
  const revProfitData=useMemo(()=>salesHist.map(h=>({month:h.month.slice(2),rev:h.rev,profit:h.profit})),[salesHist]);
  const priceUnitsData=useMemo(()=>{const pm={};priceHist.forEach(p=>{pm[p.month]=p.avgPrice});return salesHist.map(h=>({month:h.month.slice(2),units:h.units,price:pm[h.month]||null}))},[salesHist,priceHist]);
  const yoyData=useMemo(()=>Array.from({length:12},(_,i)=>{const r={month:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i]};yoyYears.forEach(y=>{const rec=salesHist.find(h=>h.y===y&&h.m===i+1);r[`u_${y}`]=rec?rec.units:null});return r}),[salesHist,yoyYears]);
  const priceInsight=useMemo(()=>{if(!priceHist.length)return null;const ty=priceHist.filter(p=>p.y===2025),ly=priceHist.filter(p=>p.y===2024);if(!ty.length||!ly.length)return null;const at=ty.reduce((s,p)=>s+p.avgPrice,0)/ty.length,al=ly.reduce((s,p)=>s+p.avgPrice,0)/ly.length;return{avgThis:at,avgLast:al,pct:((at-al)/al)*100}},[priceHist]);

  if(!bundle)return(<div className="p-4 max-w-4xl mx-auto">
    <input type="text" placeholder="Search bundles..." value={search} onChange={e=>setSearch(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full max-w-md text-sm mb-4"/>
    <div className="space-y-1">{filtered.map(b=>(<button key={b.j} onClick={()=>setSel(b.j)} className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-900/50 hover:bg-gray-800 flex items-center gap-3">
      <span className="text-blue-400 font-mono text-sm">{b.j}</span><span className="text-gray-300 text-sm truncate">{b.t}</span>
      <span className="ml-auto text-gray-500 text-xs">DSR:{fmt(b.cd)}</span></button>))}</div></div>);

  const pct=core&&core.dsr>0?((bundle.cd/core.dsr)*100).toFixed(1):"—";
  const margin=fee&&fee.pr>0?((fee.gp/fee.pr)*100).toFixed(1):"—";
  return(<div className="p-4 max-w-6xl mx-auto">
    <button onClick={()=>setSel(null)} className="text-gray-400 hover:text-white text-sm mb-4">← Back</button>
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <div className="flex flex-wrap items-center gap-3 mb-2"><span className="text-xl font-bold text-white">{bundle.j}</span>
        {core&&<button onClick={()=>onGoCore(core.id)} className="text-blue-400 text-xs bg-blue-400/10 px-2 py-0.5 rounded">→{core.id}</button>}</div>
      <p className="text-gray-300 text-sm">{bundle.t}</p><p className="text-gray-500 text-xs">ASIN:{bundle.asin} · {bundle.vendors}</p></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h4 className="text-gray-500 text-xs uppercase mb-3">Sales & Inventory</h4>
        <div className="grid grid-cols-3 gap-y-4">
          <div><div className="text-gray-500 text-xs">DSR</div><div className="text-white font-bold text-lg">{fmt(bundle.cd)}</div></div>
          <div><div className="text-gray-500 text-xs">% Core</div><div className="text-white font-bold text-lg">{pct}%</div></div>
          <div><div className="text-gray-500 text-xs">Price</div><div className="text-white font-bold text-lg">{fee?fmtD(fee.pr):"—"}</div></div>
          <div><div className="text-gray-500 text-xs">Comp DOC</div><div className="text-white font-bold text-lg">{fmt(bundle.doc)}</div></div>
          <div><div className="text-gray-500 text-xs">FIB DOC</div><div className="text-white font-bold text-lg">{fmt(bundle.fibDoc)}</div></div>
          <div><div className="text-gray-500 text-xs">FBA Stock</div><div className="text-white font-bold text-lg">{fmt(bundle.fibInv)}</div></div></div></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h4 className="text-gray-500 text-xs uppercase mb-3">Profitability</h4>
        <div className="grid grid-cols-3 gap-y-4">
          <div><div className="text-gray-500 text-xs">COGS</div><div className="text-white font-bold text-lg">{fee?fmtD(fee.pdmtCogs):"—"}</div></div>
          <div><div className="text-gray-500 text-xs">AICOGS%</div><div className="text-white font-bold text-lg">{fee&&fee.pr>0?fmtPct(fee.aicogs/fee.pr):"—"}</div></div>
          <div><div className="text-gray-500 text-xs">GP</div><div className="text-emerald-400 font-bold text-lg">{fee?fmtD(fee.gp):"—"}</div></div>
          <div><div className="text-gray-500 text-xs">Margin</div><div className="text-white font-bold text-lg">{margin!=="—"?margin+"%":"—"}</div></div>
          <div><div className="text-gray-500 text-xs">BE ACoS</div><div className="text-white font-bold text-lg">{fee?fmtPct(fee.beAcos):"—"}</div></div>
          <div><div className="text-gray-500 text-xs">BE Price</div><div className="text-white font-bold text-lg">{fee?fmtD(fee.bePr):"—"}</div></div></div></div></div>
    {sale&&<div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <h3 className="text-white font-semibold text-sm mb-3">Recent Sales</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[{l:"This Month",u:sale.tmU,r:sale.tmR},{l:"Last Month",u:sale.lmU,r:sale.lmR},{l:"Last 7d",u:sale.l7U,r:sale.l7R},{l:"Last 28d",u:sale.l28U,r:sale.l28R}].map(p=>
          <div key={p.l}><div className="text-gray-500 text-xs">{p.l}</div><div className="text-white font-semibold">{fmt(p.u)} units</div><div className="text-gray-400 text-xs">{fmtD(p.r)}</div></div>)}</div></div>}
    {hLoad?<Loader text="Loading charts..."/>:hist&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Sales History</h3>
        <ResponsiveContainer width="100%" height={250}><BarChart data={salesHist.map(h=>({month:h.month.slice(2),units:h.units}))}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:10}} angle={-45} textAnchor="end" height={50}/><YAxis tick={{fill:"#9ca3af",fontSize:11}}/>
          <Tooltip contentStyle={{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}}/><Bar dataKey="units" fill={COLORS.blue} radius={[2,2,0,0]}/></BarChart></ResponsiveContainer></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Price History</h3>
        <ResponsiveContainer width="100%" height={250}><ComposedChart data={priceUnitsData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:10}} angle={-45} textAnchor="end" height={50}/>
          <YAxis yAxisId="left" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis yAxisId="right" orientation="right" tick={{fill:"#eab308",fontSize:11}}/>
          <Tooltip contentStyle={{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}}/><Legend/>
          <Bar yAxisId="left" dataKey="units" fill={COLORS.blue} opacity={0.3} radius={[2,2,0,0]}/>
          <Line yAxisId="right" dataKey="price" stroke={COLORS.price} strokeWidth={2} type="stepAfter" dot={false}/></ComposedChart></ResponsiveContainer></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Revenue & Profit</h3>
        <ResponsiveContainer width="100%" height={250}><BarChart data={revProfitData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:10}} angle={-45} textAnchor="end" height={50}/><YAxis tick={{fill:"#9ca3af",fontSize:11}}/>
          <Tooltip contentStyle={{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}}/><Legend/>
          <Bar dataKey="rev" fill={COLORS.revenue} name="Revenue" radius={[2,2,0,0]}/><Bar dataKey="profit" fill={COLORS.profit} name="Profit" radius={[2,2,0,0]}/></BarChart></ResponsiveContainer></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">YoY Units</h3>
        <ResponsiveContainer width="100%" height={250}><LineChart data={yoyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis tick={{fill:"#9ca3af",fontSize:11}}/>
          <Tooltip contentStyle={{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}}/><Legend/>
          {yoyYears.map(y=><Line key={y} dataKey={`u_${y}`} stroke={YR_C[y]||"#6b7280"} strokeWidth={2} dot={{r:3}} name={`${y}`} connectNulls/>)}
        </LineChart></ResponsiveContainer></div></div>}
    {priceInsight&&<div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-2">Price Insight</h3>
      <p className="text-gray-300 text-sm">{fmtD(priceInsight.avgLast)} (2024) → {fmtD(priceInsight.avgThis)} (2025) — <span className={priceInsight.pct>=0?"text-emerald-400":"text-red-400"}>{priceInsight.pct>=0?"▲":"▼"}{Math.abs(priceInsight.pct).toFixed(1)}%</span></p></div>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════
// AI ADVISOR
// ═══════════════════════════════════════════════════════════════
function AIAdvisorTab({ data, settings }) {
  const [apiKey, setApiKey] = useState(""); const [selCore, setSelCore] = useState("");
  const [loading, setLoading] = useState(false); const [result, setResult] = useState(null); const [error, setError] = useState(null);
  const salesMap=useMemo(()=>{const m={};(data.sales||[]).forEach(s=>{m[s.j]=s});return m},[data.sales]);
  const analyze=async()=>{
    if(!apiKey||!selCore)return;setLoading(true);setError(null);setResult(null);
    const core=(data.cores||[]).find(c=>c.id===selCore);if(!core){setError("Not found");setLoading(false);return}
    const v=(data.vendors||[]).find(v=>v.name===core.ven);
    const jls=(core.jlsList||"").split(",").filter(Boolean);let ltR=0,ltP=0,tyR=0,lyR=0;
    jls.forEach(j=>{const s=salesMap[j.trim()];if(s){ltR+=s.ltR;ltP+=s.ltP;tyR+=s.tyR;lyR+=s.lyR}});
    const prompt=`Amazon FBA advisor. BUY/WAIT/MONITOR?\n\nCore:${core.id} ${core.ti}\nVendor:${core.ven} LT:${v?.lt||"?"}d MOQ:$${v?.moqDollar||"?"}\nDSR:${core.dsr} 7D:${core.d7} DOC:${core.doc}d\nAll-In:${calcAllIn(core)} FBA:${core.fba} Cost:$${core.cost}\nLT Rev:$${ltR} Profit:$${ltP} TY:$${tyR} LY:$${lyR}\nTarget:${settings.targetDoc}d\n\n1)BUY/WAIT/MONITOR 2)Qty 3)Risk 4)Idea. <200 words.`;
    try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-5-20250514",max_tokens:1000,messages:[{role:"user",content:prompt}]})});const j=await r.json();if(j.error)throw new Error(j.error.message);setResult(j.content?.map(c=>c.text).join("\n")||"No response")}catch(e){setError(e.message)}setLoading(false)};
  return(<div className="p-4 max-w-3xl mx-auto">
    <h2 className="text-xl font-bold text-white mb-2">AI Advisor</h2>
    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 mb-6">
      <h3 className="text-blue-400 font-semibold text-sm mb-2">Setup</h3>
      <p className="text-gray-300 text-sm">Go to <span className="text-blue-400">console.anthropic.com</span> → API Keys → Create Key → paste below. ~$0.01/analysis.</p></div>
    <div className="space-y-4">
      <div><label className="text-sm text-gray-400 block mb-1">API Key</label>
        <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-..." className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full text-sm"/></div>
      <div><label className="text-sm text-gray-400 block mb-1">Core</label>
        <select value={selCore} onChange={e=>setSelCore(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full text-sm">
          <option value="">Choose...</option>{(data.cores||[]).filter(c=>c.active==="Yes").slice(0,100).map(c=><option key={c.id} value={c.id}>{c.id} — {c.ti}</option>)}</select></div>
      <button onClick={analyze} disabled={loading||!apiKey||!selCore} className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white font-semibold rounded-lg px-6 py-2.5">{loading?"Analyzing...":"Analyze"}</button>
      {error&&<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>}
      {result&&<div className="bg-gray-900 border border-gray-700 rounded-xl p-5"><pre className="text-gray-300 text-sm whitespace-pre-wrap font-sans">{result}</pre></div>}
    </div></div>);
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
const TABS=[{id:"glossary",label:"Glossary"},{id:"purchasing",label:"Purchasing"},{id:"core",label:"Core Detail"},{id:"bundle",label:"Bundle Detail"},{id:"ai",label:"AI Advisor"}];

export default function App() {
  const [tab, setTab] = useState("purchasing");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({targetDoc:90,critMode:"lt",critDays:30,warnMode:"ltbuf",warnDays:60,filterActive:true,filterIgnored:false,filterVisible:true});
  const [glossary, setGlossary] = useState(DEFAULT_GLOSSARY);
  const [selCoreId, setSelCoreId] = useState(null);
  const [selBundleId, setSelBundleId] = useState(null);

  // Data state
  const [data, setData] = useState({cores:[],bundles:[],vendors:[],sales:[],fees:[]});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timestamp, setTimestamp] = useState(null);

  // Load live data on mount
  const loadData = useCallback(()=>{
    setLoading(true); setError(null);
    apiCall('live').then(d=>{
      setData({cores:d.cores||[],bundles:d.bundles||[],vendors:d.vendors||[],sales:d.sales||[],fees:d.fees||[]});
      setTimestamp(d.timestamp);
      setLoading(false);
    }).catch(e=>{setError(e.message);setLoading(false)});
  },[]);

  useEffect(()=>{loadData()},[loadData]);

  const statusCounts=useMemo(()=>{const c={critical:0,warning:0,healthy:0};(data.cores||[]).forEach(x=>{if(x.active!=="Yes")return;const v=(data.vendors||[]).find(v=>v.name===x.ven);c[getStatus(x.doc,v?.lt||30,x.buf||14,settings)]++});return c},[data,settings]);
  const goCore=useCallback(id=>{setSelCoreId(id);setTab("core")},[]);
  const goBundle=useCallback(id=>{setSelBundleId(id);setTab("bundle")},[]);

  if(loading)return<div className="min-h-screen bg-gray-950 flex items-center justify-center"><Loader text="Loading dashboard data..."/></div>;
  if(error)return<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-center"><p className="text-red-400 text-lg mb-4">Failed to load data</p><p className="text-gray-500 text-sm mb-4">{error}</p><button onClick={loadData} className="bg-blue-600 text-white px-6 py-2 rounded-lg">Retry</button></div></div>;

  return(<div className="min-h-screen bg-gray-950 text-gray-200">
    <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-4">
          <h1 className="text-white font-bold text-lg">FBA Dashboard</h1>
          <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded font-medium">LIVE — {data.cores.length} cores</span>
          {timestamp&&<span className="text-xs text-gray-500">{new Date(timestamp).toLocaleTimeString()}</span>}</div>
        <div className="flex items-center gap-3">
          <div className="flex gap-2 text-xs">
            <span className="flex items-center gap-1 text-red-400"><span className="w-2 h-2 rounded-full bg-red-500"/>{statusCounts.critical}</span>
            <span className="flex items-center gap-1 text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-500"/>{statusCounts.warning}</span>
            <span className="flex items-center gap-1 text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-500"/>{statusCounts.healthy}</span></div>
          <button onClick={loadData} className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800">↻</button>
          <button onClick={()=>setShowSettings(true)} className="text-gray-400 hover:text-white text-lg px-2 py-1 rounded hover:bg-gray-800">⚙️</button></div>
      </div></header>
    <nav className="bg-gray-900/50 border-b border-gray-800 px-4 sticky top-[53px] z-30">
      <div className="flex gap-0 max-w-7xl mx-auto overflow-x-auto">
        {TABS.map(t=><button key={t.id} onClick={()=>{setTab(t.id);if(t.id==="core")setSelCoreId(null);if(t.id==="bundle")setSelBundleId(null)}}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab===t.id?"border-blue-500 text-blue-400":"border-transparent text-gray-500 hover:text-gray-300"}`}>{t.label}</button>)}</div></nav>
    <main className="max-w-7xl mx-auto">
      {tab==="glossary"&&<GlossaryTab glossary={glossary} setGlossary={setGlossary}/>}
      {tab==="purchasing"&&<PurchasingTab data={data} settings={settings} onViewCore={goCore}/>}
      {tab==="core"&&<CoreDetailTab data={data} settings={settings} initialCoreId={selCoreId} onGoBundle={goBundle}/>}
      {tab==="bundle"&&<BundleDetailTab data={data} settings={settings} onGoCore={goCore} initialBundleId={selBundleId}/>}
      {tab==="ai"&&<AIAdvisorTab data={data} settings={settings}/>}
    </main>
    {showSettings&&<SettingsModal settings={settings} setSettings={setSettings} onClose={()=>setShowSettings(false)}/>}
  </div>);
}

"use client";
export type VisualizationType="bar"|"horizontal"|"line"|"donut"|"stacked"|"area";
export type ChartSeries={name:string;values:number[]};
const colors=["#1663ff","#7b4dff","#e0a12b","#19a7a0","#f06e85","#64748b"];
const format=(n:number)=>new Intl.NumberFormat("fr-FR",{notation:"compact",maximumFractionDigits:1}).format(n);
export function FinanceChart({labels,series,type,unit="MGA"}:{labels:string[];series:ChartSeries[];type:VisualizationType;unit?:string}){
 const safe=series.map(s=>({...s,values:labels.map((_,i)=>Number.isFinite(s.values[i])?s.values[i]:0)}));
 const totals=labels.map((_,i)=>safe.reduce((s,row)=>s+Math.max(0,row.values[i]),0));
 const amount=(n:number)=>unit==="nombre"?format(n):format(n)+" "+unit;
 if(!labels.length||!safe.length||safe.every(x=>x.values.every(n=>n===0)))return <p className="muted">Aucune valeur enregistrée pour cette sélection.</p>;
 if(type==="donut"){
  const portions=labels.length===1?safe.map(s=>({label:s.name,value:Math.max(0,s.values[0])})):labels.map((l,i)=>({label:l,value:totals[i]}));
  const total=portions.reduce((s,x)=>s+x.value,0);if(total<=0)return <p className="muted">La répartition exige des montants positifs.</p>;
  let cumulative=0;
  const gradient=portions.map((x,i)=>{const start=cumulative; cumulative+=100*x.value/total;return `${colors[i%colors.length]} ${start}% ${cumulative}%`}).join(", ");
  return <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
    <div role="img" aria-label={portions.map(p=>p.label+": "+amount(p.value)).join(", ")} style={{width:170,height:170,background:`conic-gradient(${gradient})`,borderRadius:"50%",display:"grid",placeItems:"center"}}>
      <div style={{width:110,height:110,borderRadius:"50%",background:"var(--background,#fff)",display:"grid",placeItems:"center",color:"var(--foreground,#1e293b)",fontSize:12}}>{amount(total)}</div>
    </div>
    <div style={{display:"grid",gap:8}}>{portions.map((p,i)=><div key={p.label} style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}><span style={{width:10,height:10,background:colors[i%colors.length],borderRadius:3}}/>{p.label} : {amount(p.value)}</div>)}</div>
   </div>
 }
 if(type==="horizontal"){
  const max=Math.max(1,...safe.flatMap(s=>s.values.map(Math.abs)));
  return <div style={{display:"grid",gap:12}}>{labels.map((label,i)=><div key={label}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,gap:10}}><span>{label}</span><span>{safe.map(s=>amount(s.values[i])).join(" / ")}</span></div><div style={{display:"flex",height:14,gap:2,background:"var(--surface-2,#edf1f6)",borderRadius:4,overflow:"hidden"}}>{safe.map((s,j)=><div key={s.name} title={s.name+": "+amount(s.values[i])} style={{background:colors[j%colors.length],width:`${Math.abs(s.values[i])/max*100/Math.max(1,safe.length)}%`,minWidth:s.values[i]!==0?2:0}}/>)}</div></div>)}</div>
 }
 const w=600,h=230,left=42,top=14,plotW=w-left-12,plotH=h-42;
 const max=Math.max(1,...(type==="stacked"?totals:safe.flatMap(s=>s.values)).map(x=>Math.max(0,x)));
 const y=(v:number)=>top+plotH-Math.max(0,v)/max*plotH;
 const x=(i:number)=>left+(i+.5)*plotW/labels.length;
 const point=(s:ChartSeries)=>s.values.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
 return <div style={{width:"100%",overflowX:"auto"}}>
 <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{minWidth:350}} role="img" aria-label={safe.map(s=>s.name+": "+s.values.map(amount).join(", ")).join("; ")}>
  {[0,.25,.5,.75,1].map(fr=><g key={fr}><line x1={left} x2={w-12} y1={y(fr*max)} y2={y(fr*max)} stroke="currentColor" opacity=".14"/><text x={left-5} y={y(fr*max)+4} fill="currentColor" opacity=".65" textAnchor="end" fontSize="10">{format(fr*max)}</text></g>)}
  {labels.map((label,i)=><text key={i} x={x(i)} y={h-8} fill="currentColor" opacity=".8" textAnchor="middle" fontSize="11">{label.slice(0,11)}</text>)}
  {type==="bar"&&safe.flatMap((s,j)=>s.values.map((v,i)=>{const bw=plotW/labels.length*.75/safe.length;return <rect key={s.name+i} x={x(i)-plotW/labels.length*.375+j*bw} y={y(v)} width={Math.max(2,bw-2)} height={Math.max(0,top+plotH-y(v))} rx="2" fill={colors[j%colors.length]}><title>{s.name}: {amount(v)}</title></rect>}))}
  {type==="stacked"&&labels.flatMap((_,i)=>{let base=0;return safe.map((s,j)=>{const v=Math.max(0,s.values[i]);const previous=base;base+=v;return <rect key={s.name+i} x={x(i)-plotW/labels.length*.29} width={plotW/labels.length*.58} y={y(base)} height={Math.max(0,y(previous)-y(base))} fill={colors[j%colors.length]}><title>{s.name}: {amount(v)}</title></rect>})})}
  {(type==="line"||type==="area")&&safe.map((s,j)=><g key={s.name}>{type==="area"&&<polygon points={`${x(0)},${y(0)} ${point(s)} ${x(labels.length-1)},${y(0)}`} fill={colors[j%colors.length]} opacity=".13"/>}<polyline points={point(s)} stroke={colors[j%colors.length]} strokeWidth="2.6" strokeLinejoin="round" fill="none"/>{s.values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r="3" fill={colors[j%colors.length]}><title>{labels[i]} - {s.name}: {amount(v)}</title></circle>)}</g>)}
 </svg>
 <div style={{display:"flex",flexWrap:"wrap",gap:12,marginTop:8}}>{safe.map((s,i)=><span key={s.name} style={{fontSize:12,display:"inline-flex",alignItems:"center",gap:5}}><i style={{width:9,height:9,background:colors[i%colors.length],display:"inline-block",borderRadius:2}}/>{s.name}</span>)}</div>
 </div>
}

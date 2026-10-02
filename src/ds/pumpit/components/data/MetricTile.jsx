import React from 'react';
import {Icon} from '../core/Icon.jsx';
const D={up:'var(--state-ok)',down:'var(--state-alarm)',flat:'var(--text-muted)'};
// Tuile chiffre : libellé en Rubik, valeur en Outfit ExtraBold. Le chiffre d'abord.
export function MetricTile({label,value,unit,delta,direction='flat',status,sub,style}){
  return <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',minWidth:0,padding:'var(--sp-5)',background:'var(--surface-panel)',borderRadius:'var(--radius-2)',...style}}>
    <span style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',font:'500 13px/1.3 var(--font-ui)',color:'var(--text-muted)'}}>
      {status&&<span aria-hidden="true" style={{width:9,height:9,borderRadius:'var(--radius-full)',background:'var(--state-'+status+'-fill)',flex:'0 0 auto'}}/>}{label}</span>
    <div style={{display:'flex',alignItems:'baseline',flexWrap:'wrap',gap:'var(--sp-2)'}}>
      <span style={{font:'800 26px/1.1 var(--font-display)',letterSpacing:'-.02em',whiteSpace:'nowrap',color:status==='alarm'?'var(--state-alarm)':'var(--text-primary)',fontVariantNumeric:'tabular-nums'}}>{value}</span>
      {unit&&<span style={{font:'500 14px/1 var(--font-ui)',color:'var(--text-muted)'}}>{unit}</span>}
    </div>
    {(delta||sub)&&<div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'var(--sp-3)'}}>
      {delta&&<span style={{display:'inline-flex',alignItems:'center',gap:4,font:'600 13px/1.2 var(--font-ui)',color:D[direction]}}>
        <Icon name={direction==='up'?'trending-up':direction==='down'?'trending-down':'minus'} size={15}/>{delta}</span>}
      {sub&&<span style={{font:'400 13px/1.35 var(--font-ui)',color:'var(--text-muted)'}}>{sub}</span>}
    </div>}
  </div>;
}

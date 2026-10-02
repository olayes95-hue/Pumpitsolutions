import React from 'react';
import {Icon} from '../core/Icon.jsx';
export function NumericStepper({value=0,onChange,step=1,min,max,suffix,disabled,decimals=0,style}){
  const clamp=n=>{if(min!=null&&n<min)n=min;if(max!=null&&n>max)n=max;return n;};
  const fmt=n=>Number(n).toFixed(decimals).replace('.',',');
  const bump=d=>!disabled&&onChange&&onChange(clamp(Number(value)+d*step));
  const btn={width:'calc(var(--control-h) - 10px)',height:'calc(var(--control-h) - 10px)',flex:'0 0 auto',alignSelf:'center',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--gris-fond)',
    border:0,borderRadius:'var(--radius-full)',color:disabled?'var(--text-disabled)':'var(--nuit)',cursor:disabled?'not-allowed':'pointer'};
  return <div style={{display:'inline-flex',alignItems:'stretch',gap:4,height:'var(--control-h)',padding:'0 4px',background:'var(--surface-field)',
    border:'1.5px solid var(--border-default)',borderRadius:'var(--radius-full)',...style}}>
    <button type="button" aria-label="Diminuer" onClick={()=>bump(-1)} disabled={disabled} style={btn}><Icon name="minus" size={16}/></button>
    <input value={fmt(value)} inputMode="decimal" onChange={e=>onChange&&onChange(Number(String(e.target.value).replace(',','.'))||0)} disabled={disabled}
      style={{flex:1,width:72,minWidth:0,textAlign:'center',padding:0,background:'transparent',border:0,outline:'none',boxShadow:'none',
        font:'600 var(--fs-input)/1 var(--font-ui)',fontVariantNumeric:'tabular-nums',color:disabled?'var(--text-disabled)':'var(--text-primary)'}}/>
    {suffix&&<span style={{display:'flex',alignItems:'center',font:'500 13px/1 var(--font-ui)',color:'var(--text-muted)'}}>{suffix}</span>}
    <button type="button" aria-label="Augmenter" onClick={()=>bump(1)} disabled={disabled} style={btn}><Icon name="plus" size={16}/></button>
  </div>;
}

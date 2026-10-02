import React from 'react';
import {Icon} from '../core/Icon.jsx';
export function Select({value,onChange,options=[],disabled,size='md',style,...rest}){
  const [foc,setFoc]=React.useState(false);
  const h=size==='sm'?'var(--control-h-sm)':size==='lg'?'var(--control-h-lg)':'var(--control-h)';
  return <div style={{position:'relative',display:'inline-flex',alignItems:'center',height:h,maxWidth:'100%',background:disabled?'var(--brume)':'var(--surface-field)',
    border:'1.5px solid '+(foc?'var(--border-focus)':'var(--border-default)'),borderRadius:'var(--radius-1)',boxShadow:foc?'var(--focus-ring)':'none',transition:'var(--t-control)',...style}}>
    <select value={value} onChange={onChange} disabled={disabled} onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
      style={{appearance:'none',WebkitAppearance:'none',background:'transparent',border:0,outline:'none',boxShadow:'none',width:'100%',height:'100%',margin:0,padding:'0 36px 0 14px',borderRadius:'var(--radius-1)',
        color:disabled?'var(--text-disabled)':'var(--text-primary)',font:'400 var(--fs-input)/1.2 var(--font-ui)',cursor:disabled?'not-allowed':'pointer',textOverflow:'ellipsis'}} {...rest}>
      {options.map(o=>{const v=typeof o==='string'?o:o.value,l=typeof o==='string'?o:o.label;return <option key={v} value={v}>{l}</option>;})}
    </select>
    <span style={{position:'absolute',right:12,pointerEvents:'none',color:'var(--text-muted)',display:'flex'}}><Icon name="chevron-down" size={16}/></span>
  </div>;
}

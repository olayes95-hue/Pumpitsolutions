import React from 'react';
import {Icon} from '../core/Icon.jsx';
export function Checkbox({checked,indeterminate,onChange,label,disabled,style}){
  const on=checked||indeterminate;
  return <label style={{display:'inline-flex',alignItems:'center',gap:'var(--sp-3)',minHeight:28,cursor:disabled?'not-allowed':'pointer',...style}} onClick={e=>{if(!disabled&&onChange){e.preventDefault();onChange(!checked)}}}>
    <span role="checkbox" aria-checked={indeterminate?'mixed':!!checked} style={{width:22,height:22,display:'inline-flex',alignItems:'center',justifyContent:'center',flex:'0 0 auto',
      background:on?'var(--vert-pump)':'var(--surface-field)',border:'1.5px solid '+(on?'var(--vert-pump)':'var(--border-default)'),
      borderRadius:7,color:'var(--nuit)',opacity:disabled?.5:1,transition:'var(--t-control)'}}>
      {indeterminate?<span style={{width:10,height:2.5,borderRadius:2,background:'var(--nuit)'}}/>:checked?<Icon name="check" size={15} strokeWidth={3}/>:null}
    </span>
    {label&&<span style={{font:'400 14px/1.3 var(--font-ui)',color:disabled?'var(--text-disabled)':'var(--text-body)'}}>{label}</span>}
  </label>;
}

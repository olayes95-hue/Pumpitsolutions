import React from 'react';
import {Icon} from '../core/Icon.jsx';
// Onglets en pilules : l'onglet actif est en Nuit (le vert reste réservé à l'action principale de l'écran).
export function Tabs({items=[],value,onChange,style}){
  return <div role="tablist" style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',overflowX:'auto',scrollbarWidth:'none',padding:2,...style}}>
    {items.map(it=>{const v=typeof it==='string'?it:it.value,l=typeof it==='string'?it:it.label,on=v===value;
      return <button key={v} type="button" role="tab" aria-selected={on} onClick={()=>onChange&&onChange(v)}
        style={{flex:'0 0 auto',display:'inline-flex',alignItems:'center',gap:'var(--sp-2)',minHeight:38,padding:'0 16px',background:on?'var(--nuit)':'#FFFFFF',
          border:0,borderRadius:'var(--radius-full)',cursor:'pointer',font:(on?'600':'500')+' 14px/1 var(--font-ui)',
          color:on?'#FFFFFF':'var(--text-secondary)',transition:'var(--t-control)',whiteSpace:'nowrap'}}>
        {it.icon&&<Icon name={it.icon} size={16}/>}{l}
        {it.count!=null&&<span style={{minWidth:20,height:20,padding:'0 6px',borderRadius:'var(--radius-full)',display:'inline-flex',alignItems:'center',justifyContent:'center',
          background:on?'var(--vert-pump)':'var(--gris-fond)',color:'var(--nuit)',font:'600 12px/1 var(--font-ui)'}}>{it.count}</span>}
      </button>;})}
  </div>;
}

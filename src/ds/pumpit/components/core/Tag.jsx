import React from 'react';
import {Icon} from './Icon.jsx';
export function Tag({children,color,onRemove,style,...rest}){
  return <span style={{display:'inline-flex',alignItems:'center',gap:'var(--sp-2)',minHeight:28,padding:'3px 12px',background:'#FFFFFF',
    boxShadow:'inset 0 0 0 1px var(--filet)',borderRadius:'var(--radius-full)',
    font:'500 13px/1.2 var(--font-ui)',color:'var(--text-secondary)',whiteSpace:'nowrap',...style}} {...rest}>
    {color&&<span aria-hidden="true" style={{width:8,height:8,borderRadius:'var(--radius-full)',background:color,flex:'0 0 auto'}}/>}
    {children}
    {onRemove&&<span onClick={onRemove} style={{cursor:'pointer',display:'inline-flex',color:'var(--text-muted)'}}><Icon name="x" size={14}/></span>}
  </span>;
}

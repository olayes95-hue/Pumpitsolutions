import React from 'react';
import {IconButton} from '../core/IconButton.jsx';
const DOT={ok:'var(--state-ok-fill)',warn:'var(--state-warn-fill)',alarm:'var(--state-alarm-fill)',info:'var(--state-info-fill)'};
export function Drawer({open,title,meta,children,footer,width=440,onClose,status,style}){
  if(!open)return null;
  return <div style={{position:'fixed',inset:0,zIndex:70,display:'flex',justifyContent:'flex-end',background:'var(--scrim)'}} onClick={onClose}>
    <aside onClick={e=>e.stopPropagation()} style={{width,maxWidth:'94vw',height:'100%',display:'flex',flexDirection:'column',
      background:'var(--surface-panel)',borderRadius:'var(--radius-lg) 0 0 var(--radius-lg)',boxShadow:'var(--shadow-pop)',overflow:'hidden',...style}}>
      <header style={{flex:'0 0 auto',display:'flex',alignItems:'center',gap:'var(--sp-3)',padding:'var(--sp-5) var(--sp-5) var(--sp-4) var(--sp-6)'}}>
        {status&&DOT[status]&&<span aria-hidden="true" style={{width:10,height:10,borderRadius:'var(--radius-full)',background:DOT[status],flex:'0 0 auto'}}/>}
        <div style={{minWidth:0}}>
          <div style={{font:'700 20px/1.2 var(--font-display)',letterSpacing:'-.02em',color:'var(--text-primary)'}}>{title}</div>
          {meta&&<div style={{font:'500 13px/1.3 var(--font-ui)',color:'var(--text-muted)',marginTop:2}}>{meta}</div>}
        </div>
        <span style={{marginLeft:'auto'}}><IconButton icon="x" tone="solid" title="Fermer" onClick={onClose}/></span>
      </header>
      <div style={{flex:1,minHeight:0,overflow:'auto',padding:'var(--sp-3) var(--sp-6) var(--sp-6)'}}>{children}</div>
      {footer&&<footer style={{flex:'0 0 auto',display:'flex',justifyContent:'flex-end',flexWrap:'wrap',gap:'var(--sp-3)',padding:'var(--sp-4) var(--sp-6)',
        paddingBottom:'calc(var(--sp-4) + env(safe-area-inset-bottom,0px))',background:'var(--brume)'}}>{footer}</footer>}
    </aside>
  </div>;
}
export function DrawerRow({label,value,mono=true,status}){
  return <div style={{display:'flex',alignItems:'baseline',gap:'var(--sp-5)',padding:'var(--sp-4) 0',borderBottom:'1px solid var(--border-hairline)'}}>
    <span style={{flex:'0 0 42%',font:'400 14px/1.35 var(--font-ui)',color:'var(--text-muted)'}}>{label}</span>
    <span style={{flex:1,textAlign:'right',font:(mono?'600':'400')+' 14px/1.4 var(--font-ui)',
      color:status?'var(--state-'+status+')':'var(--text-primary)',fontVariantNumeric:'tabular-nums'}}>{value}</span>
  </div>;
}

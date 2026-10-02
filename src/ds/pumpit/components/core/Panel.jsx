import React from 'react';
import {Icon} from './Icon.jsx';
const DOT={none:null,ok:'var(--state-ok-fill)',warn:'var(--state-warn-fill)',alarm:'var(--state-alarm-fill)',info:'var(--state-info-fill)',accent:'var(--accent-fill)'};
// Carte blanche posée sur le fond Brume. L'état éventuel est signalé par une pastille devant le titre.
export function Panel({title,meta,actions,children,status='none',flush,scroll,style,bodyStyle,sectionRef,...rest}){
  const dot=DOT[status];
  return <section ref={sectionRef} style={{display:'flex',flexDirection:'column',minHeight:0,minWidth:0,background:'var(--surface-panel)',borderRadius:'var(--radius-card)',
      overflow:flush?'hidden':'visible',...style}} {...rest}>
    {(title||actions)&&<header style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'var(--sp-3)',flex:'0 0 auto',padding:'var(--gutter-panel) var(--gutter-panel) 0',
      paddingBottom:flush?'var(--sp-4)':0}}>
      {dot&&<span aria-hidden="true" style={{width:10,height:10,borderRadius:'var(--radius-full)',background:dot,flex:'0 0 auto'}}/>}
      <span style={{font:'700 17px/1.25 var(--font-display)',letterSpacing:'-.01em',color:'var(--text-primary)'}}>{title}</span>
      {meta&&<span style={{font:'500 13px/1.2 var(--font-ui)',color:'var(--text-muted)'}}>{meta}</span>}
      <div style={{marginLeft:'auto',display:'flex',alignItems:'center',flexWrap:'wrap',gap:'var(--sp-3)'}}>{actions}</div>
    </header>}
    <div style={{flex:'1 1 auto',minHeight:0,minWidth:0,padding:flush?0:'var(--gutter-panel)',paddingTop:flush?0:(title||actions)?'var(--sp-4)':'var(--gutter-panel)',overflow:scroll?'auto':'visible',...bodyStyle}}>{children}</div>
  </section>;
}
export function PanelEmpty({icon='inbox',label}){
  return <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'var(--sp-4)',padding:'var(--sp-9) var(--sp-5)',color:'var(--text-muted)',textAlign:'center'}}>
    <span style={{width:48,height:48,borderRadius:'var(--radius-2)',background:'var(--surface-raised)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-secondary)'}}><Icon name={icon} size={22}/></span>
    <span style={{font:'500 14px/1.4 var(--font-ui)'}}>{label||'Aucune donnée'}</span>
  </div>;
}

import React from 'react';
import {Icon} from '../core/Icon.jsx';
// Charte : chaque état combine toujours une couleur ET un texte, jamais la couleur seule.
const T={alarm:['var(--state-alarm-bg)','var(--state-alarm-text)','octagon-alert'],warn:['var(--state-warn-bg)','var(--state-warn-text)','triangle-alert'],
  info:['var(--state-info-bg)','var(--state-info-text)','info'],ok:['var(--state-ok-bg)','var(--state-ok-text)','check']};
export function AlertBanner({tone='info',title,children,action,timestamp,onDismiss,style}){
  const [bg,fg,ic]=T[tone]||T.info;
  return <div role="alert" style={{display:'flex',alignItems:'flex-start',flexWrap:'wrap',gap:'var(--sp-4)',padding:'14px 16px',background:bg,borderRadius:'var(--radius-2)',...style}}>
    <span style={{color:fg,display:'flex',paddingTop:1}}><Icon name={ic} size={20}/></span>
    <div style={{flex:'1 1 200px',minWidth:0}}>
      <div style={{display:'flex',alignItems:'baseline',flexWrap:'wrap',gap:'var(--sp-3)'}}>
        <span style={{font:'600 15px/1.3 var(--font-ui)',color:fg}}>{title}</span>
        {timestamp&&<span style={{font:'400 13px/1.2 var(--font-ui)',color:'var(--text-muted)'}}>{timestamp}</span>}
      </div>
      {children&&<div style={{marginTop:4,font:'400 14px/1.5 var(--font-ui)',color:'var(--nuit)'}}>{children}</div>}
    </div>
    {action}
    {onDismiss&&<span role="button" aria-label="Fermer" onClick={onDismiss} style={{cursor:'pointer',color:'var(--text-muted)',display:'flex'}}><Icon name="x" size={18}/></span>}
  </div>;
}

import React from 'react';
import {Icon} from '../core/Icon.jsx';
export function Input({value,onChange,placeholder,icon,suffix,numeric,invalid,disabled,size='md',style,...rest}){
  const [foc,setFoc]=React.useState(false);
  const h=size==='sm'?'var(--control-h-sm)':size==='lg'?'var(--control-h-lg)':'var(--control-h)';
  // input[type=date|month] : le rendu natif (segments jj/mm/aaaa + icône calendrier) n'a pas
  // la même métrique verticale qu'un simple texte — avec padding:0 sur un conteneur à hauteur
  // fixe, il colle visuellement au bord bas du champ. Un peu de padding vertical lui redonne
  // la même respiration que les autres champs, sans toucher au texte/nombre (déjà correct).
  const isDateLike=rest.type==='date'||rest.type==='month';
  return <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)',height:h,padding:'0 14px',background:disabled?'var(--brume)':'var(--surface-field)',
    border:'1.5px solid '+(invalid?'var(--rouge)':foc?'var(--border-focus)':'var(--border-default)'),borderRadius:'var(--radius-1)',boxShadow:foc?'var(--focus-ring)':'none',transition:'var(--t-control)',...style}}>
    {icon&&<Icon name={icon} size={17} color="var(--text-muted)"/>}
    <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
      style={{flex:1,minWidth:0,width:'100%',height:'100%',padding:isDateLike?'3px 0':0,margin:0,background:'transparent',border:0,outline:'none',boxShadow:'none',color:disabled?'var(--text-disabled)':'var(--text-primary)',
        font:(numeric?'500 ':'400 ')+'var(--fs-input)/1.2 var(--font-ui)',textAlign:numeric?'right':'left',fontVariantNumeric:'tabular-nums'}} {...rest}/>
    {suffix&&<span style={{font:'500 13px/1 var(--font-ui)',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{suffix}</span>}
  </div>;
}

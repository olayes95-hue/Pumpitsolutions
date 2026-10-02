import React from 'react';
import {Icon} from '../core/Icon.jsx';
const ST={pending:['warn','À vérifier'],valid:['ok','Validée'],rejected:['alarm','Rejetée'],none:[null,null]};
// Charte : photos toujours arrondies (16 à 24 px), couleurs fidèles.
export function EvidenceThumb({src,label,timestamp,author,status='pending',size=96,onClick,onRemove,style}){
  const [tone,stLabel]=ST[status]||ST.none;
  return <figure style={{margin:0,width:size,display:'flex',flexDirection:'column',gap:'var(--sp-2)',...style}}>
    <div onClick={onClick} style={{position:'relative',height:size,background:'var(--gris-fond)',cursor:onClick?'zoom-in':'default',
      borderRadius:'var(--radius-2)',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}>
      {src?<img src={src} alt={label||''} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
        :<Icon name="image" size={22} color="var(--text-disabled)"/>}
      {onRemove&&<button type="button" onClick={e=>{e.stopPropagation();onRemove()}} title="Retirer" aria-label="Retirer"
        style={{position:'absolute',top:6,right:6,width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',
          background:'var(--nuit)',color:'#FFFFFF',border:0,borderRadius:'var(--radius-full)',cursor:'pointer'}}><Icon name="x" size={15}/></button>}
    </div>
    <figcaption style={{display:'flex',flexDirection:'column',gap:2}}>
      {label&&<span style={{font:'600 12px/1.25 var(--font-ui)',color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>}
      {timestamp&&<span style={{font:'400 12px/1.25 var(--font-ui)',color:'var(--text-muted)'}}>{timestamp}</span>}
      {author&&<span style={{font:'400 12px/1.25 var(--font-ui)',color:'var(--text-muted)'}}>{author}</span>}
      {stLabel&&<span style={{font:'600 12px/1.25 var(--font-ui)',color:'var(--state-'+tone+')'}}>{stLabel}</span>}
    </figcaption>
  </figure>;
}
export function EvidenceStrip({items=[],size=96,onOpen,style}){
  return <div style={{display:'flex',flexWrap:'wrap',gap:'var(--sp-4)',...style}}>
    {items.map((it,i)=><EvidenceThumb key={it.id??i} src={it.src} label={it.label} timestamp={it.timestamp}
      author={it.author} status={it.status} size={size} onClick={()=>onOpen&&onOpen(it,i)} onRemove={it.onRemove}/>)}
  </div>;
}

import React from 'react';
import {Icon} from '../core/Icon.jsx';
// capture=false par défaut : forcer capture="environment" lance directement l'appareil photo natif
// en plein écran, ce qui, sur téléphone à faible mémoire, provoque souvent un rechargement de
// l'onglet pendant la prise de vue (photo perdue). Laisser le choix (appareil photo, galerie,
// fichiers) réduit ce risque.
export function EvidenceUpload({label='Ajouter la photo',hint,required,capture=false,multiple=true,onFiles,disabled,style}){
  const [over,setOver]=React.useState(false);
  const input=React.useRef(null);
  const pick=files=>{if(files&&files.length&&onFiles)onFiles(Array.from(files));};
  return <div style={style}>
    <div role="button" tabIndex={0} onDragOver={e=>{e.preventDefault();setOver(true)}} onDragLeave={()=>setOver(false)}
      onDrop={e=>{e.preventDefault();setOver(false);pick(e.dataTransfer.files)}}
      onClick={()=>!disabled&&input.current&&input.current.click()}
      onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&!disabled&&input.current){e.preventDefault();input.current.click()}}}
      style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'var(--sp-3)',minHeight:112,padding:'var(--sp-5)',textAlign:'center',
        cursor:disabled?'not-allowed':'pointer',opacity:disabled?.55:1,background:over?'var(--vert-fond)':'var(--brume)',
        border:'2px dashed '+(over?'var(--vert-pump)':'var(--filet-fonce)'),borderRadius:'var(--radius-2)',transition:'var(--t-control)'}}>
      <span style={{width:44,height:44,borderRadius:'var(--radius-1)',background:over?'var(--vert-pump)':'#FFFFFF',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--nuit)'}}><Icon name="camera" size={22}/></span>
      <span style={{font:'600 14px/1.3 var(--font-ui)',color:'var(--text-primary)'}}>
        {label}{required&&<span style={{color:'var(--rouge-texte)'}}> *</span>}</span>
      <span style={{font:'400 13px/1.35 var(--font-ui)',color:'var(--text-muted)'}}>{hint||'JPEG ou PNG, 8 Mo maximum. Appareil photo ou galerie.'}</span>
    </div>
    <input ref={input} type="file" accept="image/*" multiple={multiple} {...(capture?{capture:'environment'}:{})}
      onChange={e=>pick(e.target.files)} style={{display:'none'}}/>
  </div>;
}

import React from 'react';
export function Field({label,hint,error,required,children,style}){
  return <label style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',minWidth:0,...style}}>
    {label&&<span style={{font:'500 13px/1.3 var(--font-ui)',color:'var(--text-secondary)'}}>
      {label}{required&&<span style={{color:'var(--rouge-texte)'}}> *</span>}</span>}
    {children}
    {(error||hint)&&<span style={{font:'400 13px/1.35 var(--font-ui)',color:error?'var(--state-alarm)':'var(--text-muted)'}}>{error||hint}</span>}
  </label>;
}

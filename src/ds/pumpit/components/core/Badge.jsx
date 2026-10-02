import React from 'react';
// [fond, texte] en version teintée ; [fond, texte] en version pleine (solid).
const T={
  ok:[['var(--state-ok-bg)','var(--state-ok-text)'],['var(--vert-pump)','var(--nuit)']],
  warn:[['var(--citron)','var(--nuit)'],['var(--citron)','var(--nuit)']],
  alarm:[['var(--state-alarm-bg)','var(--state-alarm-text)'],['var(--rouge-texte)','#FFFFFF']],
  info:[['var(--gris-fond)','var(--nuit)'],['var(--nuit)','#FFFFFF']],
  idle:[['var(--brume)','var(--ardoise)'],['var(--ardoise)','#FFFFFF']],
  accent:[['var(--nuit)','#FFFFFF'],['var(--nuit)','#FFFFFF']]
};
export function Badge({children,tone='idle',solid,style,...rest}){
  const [bg,fg]=(T[tone]||T.idle)[solid?1:0];
  return <span style={{display:'inline-flex',alignItems:'center',minHeight:24,padding:'3px 10px',background:bg,color:fg,
    boxShadow:tone==='idle'&&!solid?'inset 0 0 0 1px var(--filet)':'none',borderRadius:'var(--radius-full)',
    font:'600 12px/1.2 var(--font-ui)',whiteSpace:'nowrap',...style}} {...rest}>{children}</span>;
}

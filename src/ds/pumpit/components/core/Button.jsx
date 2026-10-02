import React from 'react';
import {Icon} from './Icon.jsx';
// Charte : boutons toujours en pilule. Un seul bouton vert (tone="primary") par écran.
const TONE={
  primary:{bg:'var(--accent-fill)',fg:'var(--nuit)',bd:'transparent',hover:'var(--accent-hover)',press:'var(--accent-press)'},
  dark:{bg:'var(--nuit)',fg:'#FFFFFF',bd:'transparent',hover:'var(--nuit-2)',press:'var(--foret)'},
  neutral:{bg:'var(--gris-fond)',fg:'var(--nuit)',bd:'transparent',hover:'var(--filet)',press:'var(--filet-fonce)'},
  ghost:{bg:'transparent',fg:'var(--text-secondary)',bd:'transparent',hover:'var(--gris-fond)',press:'var(--filet)'},
  outline:{bg:'transparent',fg:'var(--nuit)',bd:'var(--nuit)',hover:'var(--gris-fond)',press:'var(--filet)'},
  danger:{bg:'var(--rouge-texte)',fg:'#FFFFFF',bd:'transparent',hover:'#9A1F18',press:'#821A14'}
};
const SIZE={sm:{h:'var(--control-h-sm)',px:'14px',fs:13,ic:15},md:{h:'var(--control-h)',px:'20px',fs:14,ic:17},lg:{h:'var(--control-h-lg)',px:'24px',fs:15,ic:18}};
export function Button({children,tone='neutral',size='md',icon,iconRight,disabled,block,active,type='button',style,...rest}){
  const t=TONE[tone]||TONE.neutral, s=SIZE[size]||SIZE.md;
  const [h,setH]=React.useState(false),[p,setP]=React.useState(false);
  const bg=disabled?'var(--gris-fond)':p||active?t.press:h?t.hover:t.bg;
  return (
    <button type={type} disabled={disabled} onMouseEnter={()=>setH(true)} onMouseLeave={()=>{setH(false);setP(false)}} onMouseDown={()=>setP(true)} onMouseUp={()=>setP(false)}
      style={{display:block?'flex':'inline-flex',width:block?'100%':'auto',alignItems:'center',justifyContent:'center',gap:'var(--sp-3)',minHeight:s.h,padding:'0 '+s.px,
        font:(tone==='primary'||tone==='dark'||tone==='danger'?'700 ':'600 ')+s.fs+'px/1.15 var(--font-ui)',
        color:disabled?'var(--text-disabled)':t.fg,background:bg,border:'2px solid '+(disabled?'transparent':t.bd),borderRadius:'var(--radius-full)',
        cursor:disabled?'not-allowed':'pointer',transition:'var(--t-control)',whiteSpace:'nowrap',...style}} {...rest}>
      {icon&&<Icon name={icon} size={s.ic}/>}{children}{iconRight&&<Icon name={iconRight} size={s.ic}/>}
    </button>
  );
}

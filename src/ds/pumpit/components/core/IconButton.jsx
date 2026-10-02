import React from 'react';
import {Icon} from './Icon.jsx';
const S={sm:{b:'var(--control-h-sm)',i:16},md:{b:'var(--control-h)',i:18},lg:{b:'var(--control-h-lg)',i:20}};
export function IconButton({icon,size='md',tone='ghost',active,disabled,title,style,...rest}){
  const s=S[size]||S.md;const [h,setH]=React.useState(false);
  const bg=disabled?'transparent':active?'var(--accent-quiet)':h?'var(--filet)':tone==='solid'?'var(--gris-fond)':'transparent';
  return <button type="button" title={title} aria-label={title||icon} disabled={disabled} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
    style={{width:s.b,height:s.b,flex:'0 0 auto',display:'inline-flex',alignItems:'center',justifyContent:'center',background:bg,border:0,borderRadius:'var(--radius-full)',
      color:disabled?'var(--text-disabled)':active?'var(--vert-fonce)':'var(--text-primary)',cursor:disabled?'not-allowed':'pointer',transition:'var(--t-control)',...style}} {...rest}>
    <Icon name={icon} size={s.i}/>
  </button>;
}

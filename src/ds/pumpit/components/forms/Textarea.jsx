import React from 'react';
export function Textarea({value,onChange,placeholder,rows=4,invalid,disabled,mono,style,...rest}){
  const [foc,setFoc]=React.useState(false);
  return <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} disabled={disabled}
    onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
    style={{width:'100%',padding:'12px 14px',resize:'vertical',background:disabled?'var(--brume)':'var(--surface-field)',
      border:'1.5px solid '+(invalid?'var(--rouge)':foc?'var(--border-focus)':'var(--border-default)'),borderRadius:'var(--radius-1)',
      boxShadow:foc?'var(--focus-ring)':'none',outline:'none',color:disabled?'var(--text-disabled)':'var(--text-primary)',
      font:'400 var(--fs-input)/1.5 var(--font-ui)',fontVariantNumeric:mono?'tabular-nums':'normal',transition:'var(--t-control)',...style}} {...rest}/>;
}

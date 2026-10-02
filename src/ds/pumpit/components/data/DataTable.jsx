import React from 'react';
import {Icon} from '../core/Icon.jsx';
import {Checkbox} from '../forms/Checkbox.jsx';
export function DataTable({columns=[],rows=[],dense,selectedId,onRowClick,zebra=true,footer,
  sortKey,sortDir='asc',onSort,selectable,selectedIds=[],onSelectionChange,rowStatus}){
  const h=dense?'var(--row-h-dense)':'var(--row-h)';
  const ids=rows.map(r=>r.id);
  const allOn=selectable&&ids.length>0&&ids.every(i=>selectedIds.includes(i));
  const someOn=selectable&&!allOn&&ids.some(i=>selectedIds.includes(i));
  const toggle=(id)=>onSelectionChange&&onSelectionChange(selectedIds.includes(id)?selectedIds.filter(x=>x!==id):[...selectedIds,id]);
  const th={position:'sticky',top:0,zIndex:1,height:40,background:'var(--brume)',
    font:'600 13px/1.2 var(--font-ui)',color:'var(--text-muted)',whiteSpace:'nowrap'};
  return <div style={{width:'100%',overflow:'auto',WebkitOverflowScrolling:'touch'}}>
    <table style={{width:'100%',borderCollapse:'collapse',font:'400 14px/1.3 var(--font-ui)'}}>
      <thead><tr>
        {selectable&&<th style={{...th,width:40,padding:'0 0 0 var(--sp-5)'}}>
          <Checkbox checked={allOn} indeterminate={someOn} onChange={()=>onSelectionChange&&onSelectionChange(allOn?[]:ids)}/></th>}
        {columns.map(c=>{const on=sortKey===c.key;
          return <th key={c.key} onClick={()=>c.sortable&&onSort&&onSort(c.key,on&&sortDir==='asc'?'desc':'asc')}
            data-optional={c.optional} style={{...th,padding:'0 var(--sp-5)',textAlign:c.align||'left',width:c.width,cursor:c.sortable?'pointer':'default',color:on?'var(--text-primary)':th.color,userSelect:'none'}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:4,justifyContent:c.align==='right'?'flex-end':'flex-start',width:'100%'}}>
              {c.header}{c.sortable&&<Icon name={on?(sortDir==='asc'?'arrow-up':'arrow-down'):'chevrons-up-down'} size={14} color={on?'var(--vert-texte)':'var(--sauge)'}/>}
            </span></th>;})}
      </tr></thead>
      <tbody>{rows.map((r,i)=>{
        const sel=selectedId!=null&&r.id===selectedId;
        const checked=selectable&&selectedIds.includes(r.id);
        const base=sel||checked?'var(--surface-row-selected)':zebra&&i%2?'color-mix(in srgb,var(--brume) 55%,transparent)':'transparent';
        const st=rowStatus&&rowStatus(r);
        return <tr key={r.id??i} onClick={()=>onRowClick&&onRowClick(r)}
          style={{background:base,boxShadow:st?'inset 4px 0 0 var(--state-'+st+'-fill)':'none',cursor:onRowClick?'pointer':'default'}}
          onMouseEnter={e=>{if(!sel&&!checked)e.currentTarget.style.background='var(--surface-row-hover)'}}
          onMouseLeave={e=>{if(!sel&&!checked)e.currentTarget.style.background=base}}>
          {selectable&&<td style={{height:h,padding:'0 0 0 var(--sp-5)',borderBottom:'1px solid var(--border-hairline)'}} onClick={e=>{e.stopPropagation();toggle(r.id)}}>
            <Checkbox checked={checked} onChange={()=>toggle(r.id)}/></td>}
          {columns.map(c=><td key={c.key} data-optional={c.optional} style={{height:h,padding:'6px var(--sp-5)',textAlign:c.align||'left',borderBottom:'1px solid var(--border-hairline)',
            color:c.muted?'var(--text-muted)':'var(--text-body)',whiteSpace:'nowrap',
            font:(c.numeric?'500':'400')+' 14px/1.3 var(--font-ui)',fontVariantNumeric:'tabular-nums'}}>
            {c.render?c.render(r):r[c.key]}</td>)}
        </tr>;})}</tbody>
      {footer&&<tfoot><tr>{selectable&&<td style={{background:'var(--brume)'}}/>}
        {columns.map(c=><td key={c.key} data-optional={c.optional} style={{height:'var(--row-h)',padding:'0 var(--sp-5)',textAlign:c.align||'left',background:'var(--brume)',
        color:'var(--text-primary)',font:'700 14px/1.2 var(--font-ui)',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{footer[c.key]??''}</td>)}</tr></tfoot>}
    </table>
  </div>;
}

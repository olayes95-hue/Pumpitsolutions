import React from 'react';
import {IconButton} from '../core/IconButton.jsx';
import {Select} from '../forms/Select.jsx';
export function Pagination({page=1,pageCount=1,total,pageSize=50,onPage,onPageSize,style}){
  const btn=(icon,title,to,dis)=><IconButton icon={icon} title={title} size="sm" tone="solid" disabled={dis} onClick={()=>onPage&&onPage(to)}/>;
  return <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'var(--sp-4)',padding:'var(--sp-4) var(--sp-5)',font:'400 13px/1.2 var(--font-ui)',color:'var(--text-muted)',...style}}>
    {total!=null&&<span>{total.toLocaleString('fr-FR').replace(/\u202f|,/g,' ')} lignes</span>}
    <span style={{display:'inline-flex',alignItems:'center',gap:'var(--sp-3)'}}>
      <span>Par page</span>
      <Select size="sm" value={String(pageSize)} onChange={e=>onPageSize&&onPageSize(Number(e.target.value))} options={['25','50','100','250']}/>
    </span>
    <span style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:'var(--sp-2)'}}>
      {btn('chevrons-left','Première page',1,page<=1)}{btn('chevron-left','Page précédente',page-1,page<=1)}
      <span style={{color:'var(--text-primary)',fontWeight:600,padding:'0 var(--sp-3)',fontVariantNumeric:'tabular-nums'}}>{page} / {pageCount}</span>
      {btn('chevron-right','Page suivante',page+1,page>=pageCount)}{btn('chevrons-right','Dernière page',pageCount,page>=pageCount)}
    </span>
  </div>;
}

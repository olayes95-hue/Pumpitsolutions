import React from 'react';
// La barre de niveau reprend l'idée du logo : un niveau qui monte.
// Vert si le niveau est bon, Citron sous 25 %. Le rouge reste réservé aux pannes (tone="alarm" explicite).
export function GaugeBar({value=0,max=100,label,valueLabel,tone,threshold,height=12,style}){
  const pct=Math.max(0,Math.min(1,max?value/max:0));
  const auto=pct<.25?'warn':'ok';
  const c='var(--state-'+(tone||auto)+'-fill)';
  return <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',...style}}>
    {(label||valueLabel)&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:'var(--sp-4)'}}>
      <span style={{font:'400 14px/1.3 var(--font-ui)',color:'var(--text-body)'}}>{label}</span>
      <span style={{font:'600 14px/1.3 var(--font-ui)',color:'var(--text-primary)',fontVariantNumeric:'tabular-nums'}}>{valueLabel}</span></div>}
    <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} style={{position:'relative',height,borderRadius:'var(--radius-full)',background:'var(--filet)'}}>
      <div style={{width:(pct*100)+'%',minWidth:pct>0?height:0,height:'100%',borderRadius:'var(--radius-full)',background:c,transition:'width var(--dur-slow) var(--ease-sharp)'}}/>
      {threshold!=null&&<div title="Seuil" style={{position:'absolute',top:-3,bottom:-3,left:(threshold/max*100)+'%',width:2,borderRadius:2,background:'var(--nuit)'}}/>}
    </div>
  </div>;
}

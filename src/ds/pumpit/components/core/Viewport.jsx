import React from 'react';
export function Viewport({children,mobileMax=899,phoneMax=599}){
  const get=()=>typeof window==='undefined'?1280:window.innerWidth;
  const [w,setW]=React.useState(get);
  React.useEffect(()=>{
    const on=()=>setW(window.innerWidth);
    window.addEventListener('resize',on);
    return ()=>window.removeEventListener('resize',on);
  },[]);
  React.useEffect(()=>{
    const root=document.documentElement;
    if(w<=mobileMax)root.setAttribute('data-density','touch'); else root.removeAttribute('data-density');
  },[w,mobileMax]);
  const v={width:w,isPhone:w<=phoneMax,isMobile:w<=mobileMax,isTablet:w>phoneMax&&w<=mobileMax,isDesktop:w>mobileMax};
  return typeof children==='function'?children(v):children;
}

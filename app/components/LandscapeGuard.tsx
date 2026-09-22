"use client";
import {useEffect,useRef,useState,type ReactNode} from 'react';

export default function LandscapeGuard({children}:{children:ReactNode}){
  const [portrait,setPortrait]=useState(false),[canLock,setCanLock]=useState(false);
  const prompt=useRef<HTMLHeadingElement>(null),previousFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const query=matchMedia('(max-width: 1024px) and (orientation: portrait) and (any-pointer: coarse)');
    const update=()=>{
      if(/^\/review\/responsive(?:-desktop)?$/.test(window.location.pathname)){setPortrait(false);return;}
      setPortrait(query.matches);
    };update();query.addEventListener('change',update);
    setCanLock(typeof document.documentElement.requestFullscreen==='function'&&typeof (screen.orientation as ScreenOrientation&{lock?:unknown})?.lock==='function');
    return()=>query.removeEventListener('change',update);
  },[]);
  useEffect(()=>{if(portrait){previousFocus.current=document.activeElement as HTMLElement;prompt.current?.focus();}else previousFocus.current?.focus({preventScroll:true});},[portrait]);
  async function fullscreen(){
    try{await document.documentElement.requestFullscreen();await (screen.orientation as ScreenOrientation&{lock:(value:string)=>Promise<void>}).lock('landscape');}
    catch{setCanLock(false);/* Manual rotation remains available on every device. */}
  }
  return <><div inert={portrait}>{children}</div>{portrait&&<div className="landscape-gate" role="dialog" aria-modal="true" aria-labelledby="landscape-heading">
    <svg viewBox="0 0 80 60" width="96" height="72" aria-hidden="true"><rect x="17" y="15" width="48" height="29" rx="4" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 24C8 10 29 1 40 7M35 2l5 5-7 3" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
    <h2 id="landscape-heading" ref={prompt} tabIndex={-1}>Turn your device sideways</h2><p>This room is designed for landscape.</p>
    {canLock&&<button onClick={fullscreen}>Use landscape fullscreen</button>}
  </div>}</>;
}

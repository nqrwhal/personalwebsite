"use client";

import { useEffect, useRef, useState } from "react";
import PROJECTS from "../data/vinyls.json";
import ShelfScene, { type ShelfControls, type PageCorners, type BookLayout, type CueBounds } from "./ShelfScene";
import ActivityCues, { type CueSpec } from './ActivityCues';
import { createCueVisitState, rememberCueVisit, learnShelfNavigation, type CueVisitState } from './cueVisitState';
import { CUBBIES, adjacentCubby, type ShelfSelection } from "./shelfState";
import ReportBookOverlay from './ReportBookOverlay';
import type { ReportBook } from './reportBook';
import { swipeBookDirection, swipeCubbyDirection, wheelPixels } from "./shelfGestures";
import {PHOTO_LABELS} from './shelfPolaroids';
import {usePanHandoff,getShelfPlates,shelfTravelClip} from './panHandoff';
import {primeSceneClip,shelfExitSrc} from './sceneTransitionCache';
import "./vinylShelf.css";

type Travel = { from: number; to: number; exit: boolean };

export default function BookshelfExperience({ onExit, onReady: onDestinationReady, motion, initialCubby = 1, review=false, coherentPhotos=false, coherentBooks=false, mobileLayout=false, responsiveLayout=false, preparing=false, activityCues=false, refinedCues=false, cueFadeIn=false, cueMemory, cueInput='auto' }: { onExit: (cubby: number) => void; onReady?:()=>void; motion: boolean; initialCubby?: number; review?:boolean; coherentPhotos?:boolean; coherentBooks?:boolean; mobileLayout?:boolean; responsiveLayout?:boolean; preparing?:boolean; activityCues?:boolean; refinedCues?:boolean; cueFadeIn?:boolean; cueMemory?:CueVisitState; cueInput?:'auto'|'mouse'|'touch' }) {
  const handoff=usePanHandoff();
  const shelfPlates=getShelfPlates(coherentPhotos,coherentBooks);
  const localCueMemory=useRef(createCueVisitState());
  const visitMemory=cueMemory??localCueMemory.current;
  const [,refreshCueMemory]=useState(0);
  const controls = useRef<ShelfControls | null>(null), movie = useRef<HTMLVideoElement>(null);
  const surface = useRef<HTMLElement>(null);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const wheel = useRef({ total: 0, last: 0, consumed: false });
  const [cubby, setCubby] = useState(initialCubby), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ShelfSelection>(null), [bookOpen, setBookOpen] = useState(false);
  const [spread, setSpread] = useState(0), [turning, setTurning] = useState(false);
  const [recordPlayback,setRecordPlayback]=useState<'playing'|'finished'|null>(null);
  const [photo,setPhoto]=useState<number|null>(null);
  const [cueTargets,setCueTargets]=useState<Record<string,CueBounds>>({});
  const cueSceneKey=`shelf-${cubby}-${selected}-${bookOpen}-${photo}-${recordPlayback}-${spread===0?'first':'later'}`;
  // A settled cubby is consumed even when the visitor leaves before its fade.
  // The room owns this memory, so returning from the room cannot restart it.
  useEffect(()=>{
    if(!refinedCues||!ready||selected!==null)return;
    return()=>rememberCueVisit(visitMemory,`cubby-${cubby}`);
  },[refinedCues,ready,selected,cubby,visitMemory]);
  useEffect(()=>{
    if(!refinedCues||!review)return;
    const replay=()=>{visitMemory.completed.clear();visitMemory.navigated=false;refreshCueMemory(n=>n+1);};
    window.addEventListener('bz-replay-cues',replay);
    return()=>window.removeEventListener('bz-replay-cues',replay);
  },[refinedCues,review,visitMemory]);
  function onPlayback(state:'playing'|'finished'|null){setRecordPlayback(state);if(state!==null){setBusy(state==='playing');busyRef.current=state==='playing';}}
  const [busy, setBusy] = useState(false), [travel, setTravel] = useState<Travel | null>(null), [playing, setPlaying] = useState(false);
  const [corners, setCorners] = useState<PageCorners | null>(null);
  const [bookLayout,setBookLayout]=useState<BookLayout|null>(null),[report,setReport]=useState<ReportBook|null>(null);
  const busyRef = useRef(false), mounted = useRef(true);
  const preloadPlates = useRef<HTMLImageElement[]>([]);
  const bookButton = useRef<HTMLButtonElement>(null),photosButton=useRef<HTMLButtonElement>(null);
  const inspectButton = useRef<HTMLButtonElement>(null), recordButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreSelectionFocus = useRef<ShelfSelection>(null);
  useEffect(()=>{
    if(turning||!bookOpen||!bookLayout?.visible)return;
    const left=surface.current?.querySelector('.page-corner-left'),right=surface.current?.querySelector('.page-corner-right');
    // Disabled controls do not necessarily receive a new pointerenter when a
    // turn finishes beneath a stationary pointer.
    if(left?.matches(':hover,:focus-visible'))controls.current?.corner(-1);
    else if(right?.matches(':hover,:focus-visible'))controls.current?.corner(1);
    else controls.current?.corner(null);
  },[turning,bookOpen,bookLayout?.visible]);
  useEffect(() => {
    if (!ready || !motion || preparing) return;
    for (const to of [cubby - 1, cubby + 1]) {
      if (to < 0 || to > 2) continue;
      primeSceneClip(shelfTravelClip(cubby, to, coherentPhotos, coherentBooks));
    }
    primeSceneClip(shelfExitSrc(cubby, coherentPhotos, coherentBooks));
  }, [ready, motion, preparing, cubby, coherentPhotos, coherentBooks]);
  useEffect(() => {
    mounted.current = true;
    // Ready-to-paint plates prevent a black frame at either end of a cubby move.
    for (const urls of shelfPlates) for (const src of Object.values(urls)) { const image = new Image(); image.src = src; preloadPlates.current.push(image); void image.decode().catch(() => {}); }
    return () => { mounted.current = false; preloadPlates.current = []; };
  }, [shelfPlates]);

  function onReady() {
    setReady(true);
    if (travel) return;
    setBusy(false); busyRef.current = false;
    handoff.release();onDestinationReady?.();
  }
  function onFailed() {
    setFailed(true);
    if (travel) return;
    setBusy(false); busyRef.current = false;
    const image=new Image();image.src=shelfPlates[cubby].still;
    void image.decode().catch(()=>{}).then(()=>{if(mounted.current){handoff.release();onDestinationReady?.();}});
  }
  useEffect(() => {
    if (ready || failed || travel) return;
    const timer = window.setTimeout(onFailed, 8000);
    return () => window.clearTimeout(timer);
    // Loading failure must leave navigation usable even if a request stalls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubby, ready, failed, travel]);
  useEffect(() => {
    if (selected !== null) inspectButton.current?.focus({ preventScroll: true });
    else if (restoreSelectionFocus.current !== null) {
      const focus = restoreSelectionFocus.current;
      (focus === "book" ? bookButton.current : focus==='photos'?photosButton.current:recordButtons.current[focus])?.focus({ preventScroll: true });
      restoreSelectionFocus.current = null;
    }
  }, [selected]);
  function finishTravel(current: Travel) {
    handoff.capture(movie.current);
    setReady(false); setFailed(false); setCubby(current.to); setTravel(null); setPlaying(false);
    // The full records poster already matches the return movie; no WebGL load
    // is needed before leaving, including on devices where WebGL has failed.
    if (current.exit) onExit(current.to);
  }
  useEffect(() => {
    if (!travel) return;
    const timer = window.setTimeout(() => finishTravel(travel), 6000);
    return () => window.clearTimeout(timer);
    // The captured transition is stable until completion or fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travel]);

  async function moveTo(to: number, exit = false) {
    if (busyRef.current || to < 0 || to > 2) return;
    busyRef.current = true; setBusy(true);
    await controls.current?.settle();
    if (!mounted.current) return;
    // Wait for the restored 16:9 layout before handing off to prerecorded media.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (!mounted.current) return;
    if (to === cubby) { if (exit) onExit(cubby); else { setBusy(false); busyRef.current = false; } return; }
    const next = { from: cubby, to, exit };
    if (!motion) finishTravel(next);
    else { setPlaying(false); setTravel(next); }
  }
  async function returnToShelf() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); restoreSelectionFocus.current = selected;
    await controls.current?.returnToShelf();
    if (mounted.current) { busyRef.current = false; setBusy(false); }
  }
  function gestureMove(direction: -1 | 1) {
    if (selected !== null || busyRef.current || (!ready && !failed)) return;
    const next = adjacentCubby(cubby, direction);
    if (next !== cubby) {
      if(refinedCues){learnShelfNavigation(visitMemory);refreshCueMemory(n=>n+1);}
      void moveTo(next);
    }
  }
  useEffect(() => {
    const node = surface.current;
    function scroll(event: WheelEvent) {
      const bookSwipe=selected==='book'&&bookOpen;
      if (event.ctrlKey || (event.target as Element).closest('dialog')) return;
      if(bookSwipe){if(Math.abs(event.deltaX)<Math.abs(event.deltaY)*1.4)return;}
      else if(Math.abs(event.deltaX)>Math.abs(event.deltaY)||selected!==null)return;
      event.preventDefault();
      const now = performance.now(), state = wheel.current;
      if (now - state.last > 240) { state.total = 0; state.consumed = false; }
      state.last = now;
      if (busyRef.current || (bookSwipe&&turning)) { state.consumed = true; return; }
      if (state.consumed) return;
      const delta = wheelPixels(bookSwipe?event.deltaX:event.deltaY, event.deltaMode, node?.clientHeight ?? 800);
      if (Math.sign(delta) !== Math.sign(state.total)) state.total = 0;
      state.total += delta;
      if (Math.abs(state.total) >= 55) { state.consumed = true; const direction=state.total>0?1:-1;if(bookSwipe)controls.current?.page(direction);else gestureMove(direction); }
    }
    node?.addEventListener("wheel", scroll, { passive: false });
    return () => node?.removeEventListener("wheel", scroll);
    // The accumulator survives cubby changes to discard trackpad momentum.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubby, selected, ready, failed, motion,bookOpen,turning]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if(document.querySelector('dialog[open]'))return;
      if (event.key !== "Escape" || busy) return;
      if(selected==='photos'&&photo!==null)controls.current?.inspectPhoto(null);
      else if (bookOpen) controls.current?.openBook(false);
      else if (selected !== null) returnToShelf();
      else void moveTo(cubby, true);
    }
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookOpen, selected, busy, cubby, motion,photo]);

  const cueSpecs:CueSpec[]=[];
  function cue(id:string,target:string,label:string,touchLabel=label,side:CueSpec['side']='top',gesture:CueSpec['gesture']='point',touchGesture?:CueSpec['touchGesture']){
    if(cueTargets[target])cueSpecs.push({id,label,touchLabel,rect:cueTargets[target],side,gesture,touchGesture,
      pointBias:target==='page-left'||target==='page-right'?.92:undefined,
      freezeTarget:refinedCues&&id==='choose-book'});
  }
  if(selected===null){
    if(cubby===0)cue('choose-book','books','Click','Tap');
    if(cubby===1){if(!refinedCues||!visitMemory.navigated)cue('hover-records','records','Hover','Tap');cue('choose-record','records','Click','Tap','left');}
    if(cubby===2&&cueTargets.photos)cueSpecs.push({id:'choose-photos',label:refinedCues?'Click':'Click to Enlarge',touchLabel:refinedCues?'Tap':'Tap to Enlarge',rect:cueTargets.photos,side:'top',appearance:refinedCues?undefined:'text-only'});
    if(!refinedCues||!visitMemory.navigated)cueSpecs.push({id:'shelf-scroll',label:'Scroll',touchLabel:'Swipe',
      ...(refinedCues?{viewportAnchor:{x:.955,y:.5},scale:1.35}:{selector:cubby<2?'.shelf-arrow-down':'.shelf-arrow-up'}),side:'left',gesture:'swipe-y'});
  }else if(selected==='book'){
    if(!bookOpen)cue('open-book','book','Click','Tap');
    else{
      if(spread>0)cue('previous-spread','page-left','Click','Swipe','left','point','swipe-left');
      if(!report||spread<Math.ceil(report.pages.length/2)-1)cue('next-spread','page-right','Click','Swipe','right','point','swipe-x');
      // Large figures are already interactive; this note appears only when a
      // figure is actually present, not on ordinary text or contents pages.
      if(report?.pages.slice(spread*2,spread*2+2).some(page=>page.figure))
        cue('figure-zoom','book','Zoom','Zoom','top');
    }
  }else if(selected==='photos'){
    if(photo===null&&cueTargets.photos)cueSpecs.push({id:'enlarge-photos',label:'Click to Enlarge',touchLabel:'Tap to Enlarge',rect:cueTargets.photos,side:'top',appearance:'text-only'});
  }else if(recordPlayback===null){
    cue('rotate-cover','cover','Drag','Drag','top','drag');
    cue('flip-cover','cover','Flip','Flip','left');
    cue('play-disc','disc','Redirect','Redirect','right');
  }else if(recordPlayback==='finished'){
    cueSpecs.push({id:'open-project',label:'Click',touchLabel:'Tap',selector:'.vinyl-project-controls a',side:'top'});
  }
  return <section ref={surface} className={`vinyl-experience ${selected !== null ? "vinyl-is-selected" : ""} ${preparing ? "is-preparing" : ""}`} aria-label="Interactive bookshelf" aria-busy={busy} aria-hidden={preparing || undefined} inert={preparing} data-cubby={cubby} data-mobile-layout={mobileLayout} data-responsive={responsiveLayout ? "true" : undefined} data-activity-cues={activityCues} data-selection={typeof selected==='number'?'record':selected??'shelf'}
    onPointerDownCapture={event => {
      if (event.pointerType !== "touch") return;
      if (!event.isPrimary || (selected !== null && !(selected === 'book' && bookOpen && !turning)) || busyRef.current || (event.target as Element).closest("button,a,input,dialog")) { swipe.current = null; return; }
      swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }}
    onPointerCancelCapture={() => { swipe.current = null; }}
    onPointerUpCapture={event => {
      const start = swipe.current; swipe.current = null;
      if (!start || start.id !== event.pointerId) return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;
      const direction = selected === 'book' ? swipeBookDirection(dx,dy) : swipeCubbyDirection(dx,dy);
      if (direction !== null) {
        suppressClickUntil.current=performance.now()+500;
        event.preventDefault(); // Let the canvas release its pointer/drag state.
        if(selected==='book')controls.current?.page(direction);else gestureMove(direction);
      }
    }} onClickCapture={event=>{if(performance.now()<suppressClickUntil.current){event.preventDefault();event.stopPropagation();}}}>
    <div className="vinyl-render-stage">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shelfPlates[cubby].still} style={{visibility:ready?'hidden':'visible'}} alt={cubby === 0 ? "Books on the upper shelf" : cubby === 1 ? "Five project records and two blank covers in their holder" : "Camera, four personal photographs and globe on the shelf"} />
      <img src={shelfPlates[cubby].background} style={{visibility:ready?'visible':'hidden'}} alt="" aria-hidden="true" />
      <div className="shelf-scene-wrap" style={{ visibility: ready ? "visible" : "hidden" }}>
        <ShelfScene review={review} coherentPhotos={coherentPhotos} coherentBooks={coherentBooks} mobileLayout={mobileLayout} responsiveLayout={responsiveLayout} cueLayout={activityCues} cubby={cubby} motion={motion} controls={controls} onReady={onReady} onFailed={onFailed}
          onCueTargets={activityCues?setCueTargets:undefined}
          onSelect={setSelected} onBook={setBookOpen} onSpread={setSpread} onTurning={setTurning} onCorners={setCorners} onLayout={setBookLayout} onPlayback={onPlayback} onPhoto={setPhoto} />
      </div>
      {selected==='book' && bookOpen && <ReportBookOverlay spread={spread} layout={bookLayout} busy={busy||turning} onLoad={setReport} onJump={page=>controls.current?.jumpPage(page)}/>}
      {selected === "book" && bookOpen && corners && !busy && <div className="book-page-corners">
        <button className="page-corner-left" aria-label="Previous spread" disabled={spread === 0 || turning} style={{ left: `${corners.left.x}%`, top: `${corners.left.y}%` }} onPointerEnter={() => controls.current?.corner(-1)} onPointerMove={() => controls.current?.corner(-1)} onPointerLeave={() => controls.current?.corner(null)} onFocus={() => controls.current?.corner(-1)} onBlur={() => controls.current?.corner(null)} onClick={() => controls.current?.page(-1)} />
        <button className="page-corner-right" aria-label="Next spread" disabled={!report || spread === Math.ceil(report.pages.length/2) - 1 || turning} style={{ left: `${corners.right.x}%`, top: `${corners.right.y}%` }} onPointerEnter={() => controls.current?.corner(1)} onPointerMove={() => controls.current?.corner(1)} onPointerLeave={() => controls.current?.corner(null)} onFocus={() => controls.current?.corner(1)} onBlur={() => controls.current?.corner(null)} onClick={() => controls.current?.page(1)} />
      </div>}
      {travel && <video key={`${travel.from}-${travel.to}`} ref={movie} className={`shelf-travel ${playing ? "is-playing" : ""}`}
        src={shelfTravelClip(travel.from,travel.to,coherentPhotos,coherentBooks)} muted autoPlay playsInline preload="auto" aria-hidden="true"
        onLoadedData={event => {
          const video = event.currentTarget;
          if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(() => { if (movie.current === video) setPlaying(true); });
          else setPlaying(true);
        }} onEnded={() => finishTravel(travel)} onError={() => finishTravel(travel)} />}
      <canvas ref={handoff.canvas} className="shelf-handoff" aria-hidden="true" />
    </div>
    <button className="cinematic-back" disabled={busy} onPointerDown={() => primeSceneClip(shelfExitSrc(cubby, coherentPhotos, coherentBooks), true)} onClick={() => void moveTo(cubby, true)}>← Room</button>
    {selected === null && <>
      <button className="shelf-arrow shelf-arrow-up" aria-label={`Move up${cubby > 0 ? ` to ${CUBBIES[cubby - 1]}` : ""}`} disabled={busy || (!ready && !failed) || cubby === 0} onPointerDown={() => { if (cubby > 0) primeSceneClip(shelfTravelClip(cubby, cubby - 1, coherentPhotos, coherentBooks), true); }} onClick={() => void moveTo(adjacentCubby(cubby, -1))}><svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 13 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
      <button className="shelf-arrow shelf-arrow-down" aria-label={`Move down${cubby < 2 ? ` to ${CUBBIES[cubby + 1]}` : ""}`} disabled={busy || (!ready && !failed) || cubby === 2} onPointerDown={() => { if (cubby < 2) primeSceneClip(shelfTravelClip(cubby, cubby + 1, coherentPhotos, coherentBooks), true); }} onClick={() => void moveTo(adjacentCubby(cubby, 1))}><svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    </>}
    <div className="vinyl-project-controls">
      {selected === null ? <>
        <p role="status" className={mobileLayout?'cinematic-sr':undefined}>{busy ? "Moving along the shelf…" : failed ? CUBBIES[cubby] : !ready ? "Preparing the shelf…" : ""}</p>
        <div>{cubby === 1 && PROJECTS.slice(0, 5).map((p, index) => failed ? <a key={p.slug} href={p.href!}>{p.title}</a> : <button ref={element => { recordButtons.current[index] = element; }} key={p.slug} disabled={!ready || busy}
          onPointerEnter={() => controls.current?.hover(index)} onPointerLeave={() => controls.current?.hover(null)} onFocus={() => controls.current?.hover(index)} onBlur={() => controls.current?.hover(null)} onClick={() => controls.current?.select(index)}>{p.title}</button>)}
          {cubby === 0 && <button ref={bookButton} disabled={!ready || busy} onPointerEnter={() => controls.current?.hover("book")} onPointerLeave={() => controls.current?.hover(null)} onFocus={() => controls.current?.hover("book")} onBlur={() => controls.current?.hover(null)} onClick={() => controls.current?.select("book")}>Data science report</button>}
          {cubby===2&&<button ref={photosButton} disabled={!ready||busy} onClick={()=>controls.current?.select('photos')}>Photographs</button>}
        </div>
      </> : selected==='photos'? <><p>{photo===null?'':PHOTO_LABELS[photo]}</p><div>{photo===null?PHOTO_LABELS.map((label,index)=><button key={label} ref={index===0?inspectButton:undefined} disabled={busy||turning} aria-label={`Enlarge photo ${index+1}: ${label}`} onClick={()=>controls.current?.inspectPhoto(index)}>{index+1}</button>):<button ref={inspectButton} disabled={busy||turning} onClick={()=>controls.current?.inspectPhoto(null)}>Back to photos</button>}<button disabled={busy} onClick={returnToShelf}>Return to shelf</button></div></> : selected === "book" ? <>
        <p role="status">{bookOpen ? `Pages ${spread*2+1}–${spread*2+2}${report?` of ${report.pages.length}`:''}` : "How Consistent Is Formula 1 Stewarding?"}</p>
        <div><button ref={inspectButton} disabled={busy || turning} onClick={() => controls.current?.openBook(!bookOpen)}>{bookOpen ? "Close book" : "Open book"}</button><button disabled={busy} onClick={returnToShelf}>Return to shelf</button></div>
      </> : <><p>{PROJECTS[selected].title}</p><div>{!recordPlayback&&<button ref={inspectButton} disabled={busy} onClick={() => controls.current?.flip()}>Front / back</button>}<button disabled={busy} onClick={returnToShelf}>Return to holder</button>{recordPlayback==='finished'?<a href={PROJECTS[selected].href!} target="_blank" rel="noopener noreferrer">Open project ↗</a>:<button disabled={busy} onClick={()=>controls.current?.playRecord()}>{mobileLayout?'Play record':'Play record ↗'}</button>}</div></>}
    </div>
    {activityCues&&<ActivityCues fadeIn={cueFadeIn} refined={refinedCues} visibleMs={refinedCues?2000:undefined} allowReplay={review} inputMode={cueInput}
      sceneKey={`${cueSceneKey}-${report?.pages.slice(spread*2,spread*2+2).some(page=>page.figure)?'figure':'text'}`}
      ready={ready&&!busy&&!turning&&!travel&&!failed&&cueSpecs.length>0&&(!refinedCues||!visitMemory.completed.has(selected===null?`cubby-${cubby}`:cueSceneKey))}
      onComplete={()=>{if(refinedCues)rememberCueVisit(visitMemory,selected===null?`cubby-${cubby}`:cueSceneKey);}} cues={cueSpecs}/>}
  </section>;
}

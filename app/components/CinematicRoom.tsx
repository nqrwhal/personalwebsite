"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./cinematicRoom.css";
import RoomSpeakerActivity, { useSpeakerPlayback, type SpeakerPreviewMode } from "./RoomSpeakerActivity";
import {usePanHandoff,PHOTO_CONSISTENCY_MEDIA,BOOK_CONSISTENCY_MEDIA} from './panHandoff';
import {pauseSceneClips,primeSceneClip,sceneTransitionSrc,setScenePrimeSuspended} from './sceneTransitionCache';
import PolaroidPulse from './PolaroidPulse';
import DiplomaEnlargement from './DiplomaEnlargement';
import ActivityCues from './ActivityCues';
import {createCueVisitState} from './cueVisitState';
import './mobileRoom.css';

const VinylShelf = lazy(() => import("./VinylShelf"));
type Phase = "room" | "approach" | "boot" | "desktop" | "return" | "diploma-in" | "diploma" | "diploma-out" | "vinyl-in" | "vinyls" | "vinyl-out" | "books-in" | "books-out" | "photos-in" | "photos-out";
const MEDIA = "/room/v149/";
const MONITOR_MEDIA = "/room/v149/";
const SHELF_MEDIA = "/room/v155/";
const BOOKS_MEDIA = "/room/v150/";
const PHOTOS_MEDIA = '/room/v154/';
// Projected from the approved Blender camera, not guessed viewport pixels.
const HOTSPOTS = {
  monitor: { left: "35.1%", top: "31.49%", width: "7.2%", height: "11.6%" },
  vinyls: { left: "52.5%", top: "28.69%", width: "3.6%", height: "5.5%" },
  books: { left: "54.8%", top: "26%", width: "2.8%", height: "3.5%" },
  photos: {left:'52.9%',top:'37.9%',width:'4.9%',height:'4.7%'},
  frame: { left: "72.5%", top: "30.49%", width: "5.2%", height: "12.5%" },
};

export default function CinematicRoom({ speakerPreview = false, coherentPhotos = false, coherentBooks = false, shelfReview = false, mobileLayout = false, responsiveLayout = false, activityCues = false, refinedCues = false, cueFadeIn = false }: { speakerPreview?: boolean; coherentPhotos?: boolean; coherentBooks?: boolean; shelfReview?: boolean; mobileLayout?: boolean; responsiveLayout?: boolean; activityCues?: boolean; refinedCues?: boolean; cueFadeIn?: boolean }) {
  const handoff=usePanHandoff();
  const photosMedia=coherentPhotos?PHOTO_CONSISTENCY_MEDIA:PHOTOS_MEDIA;
  const booksMedia=coherentBooks?BOOK_CONSISTENCY_MEDIA:BOOKS_MEDIA;
  const media = useMemo(() => ({ room: MEDIA, monitor: MONITOR_MEDIA, shelf: SHELF_MEDIA, books: booksMedia, photos: photosMedia }), [booksMedia, photosMedia]);
  const phaseRef = useRef<Phase>("room");
  const shelfReady = useRef(false);
  const shelfCueMemory=useRef(createCueVisitState());
  const [phase, setPhase] = useState<Phase>("room");
  const [initialCubby, setInitialCubby] = useState(1);
  const [motion, setMotion] = useState(false);
  const [idleFailed, setIdleFailed] = useState(false);
  const [desktopLoaded, setDesktopLoaded] = useState(false);
  const [bootFinished, setBootFinished] = useState(false);
  const [transitionVisible, setTransitionVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [speakerMode, setSpeakerMode] = useState<SpeakerPreviewMode>("playing");
  const speakerFeed = useSpeakerPlayback((!speakerPreview || speakerMode === "live") && phase === "room" && pageVisible);
  const idle = useRef<HTMLVideoElement>(null);
  const transition = useRef<HTMLVideoElement>(null);
  const monitorButton = useRef<HTMLButtonElement>(null);
  const shelfButton = useRef<HTMLButtonElement>(null), diplomaButton = useRef<HTMLButtonElement>(null);
  const booksButton = useRef<HTMLButtonElement>(null),photosButton=useRef<HTMLButtonElement>(null);
  const bootStatus = useRef<HTMLDivElement>(null);
  const desktop = useRef<HTMLIFrameElement>(null);
  const restoreFocus = useRef(false);
  const returnTarget = useRef<"monitor" | "vinyls" | "books" | "photos" | "diploma">("monitor");
  const roomGlow = useRef<HTMLDivElement>(null);
  const glowFade = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diplomaImage=useRef<HTMLImageElement>(null);
  const [greetingCuesDone,setGreetingCuesDone]=useState(false);
  phaseRef.current = phase;
  useEffect(()=>{
    // Leaving early also consumes the greeting; returning to the room never replays it.
    if(phase!=='room')setGreetingCuesDone(true);
  },[phase]);
  function replayActivityCues(){
    window.dispatchEvent(new Event('bz-replay-cues'));
  }

  useEffect(()=>{
    let active=true,frame=0;
    const release=()=>{if(active)handoff.release();};
    if(phase==='room'){
      const video=idle.current;
      if(motion&&!idleFailed&&video&&typeof video.requestVideoFrameCallback==='function')frame=video.requestVideoFrameCallback(release);
      else {const image=new Image();image.src=`${MEDIA}greeting.webp`;void image.decode().catch(()=>{}).then(release);}
    }else if(phase==='diploma')void diplomaImage.current?.decode().catch(()=>{}).then(release);
    else if(phase==='boot')release();
    return()=>{active=false;if(frame)idle.current?.cancelVideoFrameCallback(frame);};
  },[phase,motion,idleFailed,handoff.release]);

  useEffect(() => () => { if (glowFade.current) clearTimeout(glowFade.current); }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!preference.matches);
    const visibility = () => setPageVisible(!document.hidden);
    update();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (phase === "room" && motion && pageVisible) {
      void idle.current?.play().catch(() => setIdleFailed(true));
    } else {
      idle.current?.pause();
      // Return clips end at these matching points in the ambient lighting loop.
      // Seek while the departing view/movie still covers the paused room layer.
      if (idle.current && idle.current.readyState > 0 && ["return", "vinyl-out", "books-out", "photos-out", "diploma-out"].includes(phase)) {
        idle.current.currentTime = phase === "return" ? 0 : 6;
      }
    }
  }, [phase, motion, pageVisible]);

  useEffect(() => {
    if (phase !== "boot") return;
    bootStatus.current?.focus();
    const timer = window.setTimeout(() => setBootFinished(true), motion ? 1600 : 0);
    return () => window.clearTimeout(timer);
  }, [phase, motion]);

  useEffect(() => {
    if (phase === "boot" && bootFinished && desktopLoaded) setPhase("desktop");
  }, [phase, bootFinished, desktopLoaded]);

  useEffect(() => {
    if (phase === "desktop") desktop.current?.focus();
    if (phase === "room" && restoreFocus.current) {
      const target = returnTarget.current === "photos" ? photosButton.current : returnTarget.current === "books" ? booksButton.current : returnTarget.current === "vinyls" ? shelfButton.current : returnTarget.current === "diploma" ? diplomaButton.current : monitorButton.current;
      target?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [phase]);

  // A failed/stalled movie must never trap the visitor away from the content.
  useEffect(() => {
    if (!["approach", "return", "diploma-in", "diploma-out", "vinyl-in", "vinyl-out", "books-in", "books-out", "photos-in", "photos-out"].includes(phase)) return;
    const timer = window.setTimeout(() => {
      setPhase(phase === "approach" ? "boot" : phase === "diploma-in" ? "diploma" : phase === "vinyl-in" || phase === "books-in" || phase==='photos-in' ? "vinyls" : "room");
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  function enterMonitor() {
    returnTarget.current = "monitor";
    setBootFinished(false);
    setDesktopLoaded(false);
    setTransitionVisible(false);
    setPhase(motion ? "approach" : "boot");
  }

  function arm(next: Phase) {
    if (!motion) return;
    const src = sceneTransitionSrc(next, media);
    if (src) primeSceneClip(src, true);
  }

  function leaveMonitor() {
    restoreFocus.current = true;
    setTransitionVisible(false);
    setPhase(motion ? "return" : "room");
  }

  useEffect(() => {
    function exitDesktop(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== desktop.current?.contentWindow) return;
      if (event.data?.type !== "bz-desktop-exit" || phase !== "desktop") return;
      restoreFocus.current = true;
      setTransitionVisible(false);
      setPhase(motion ? "return" : "room");
    }
    window.addEventListener("message", exitDesktop);
    return () => window.removeEventListener("message", exitDesktop);
  }, [phase, motion]);

  const traveling = ["approach", "return", "diploma-in", "diploma-out", "vinyl-in", "vinyl-out", "books-in", "books-out", "photos-in", "photos-out"].includes(phase);
  // Keep the departing surface mounted until a decoded return frame is ready.
  // Otherwise the greeting layer is exposed while the return movie loads.
  const holdingReturn = !transitionVisible;
  const showDesktop = (phase === "approach" && transitionVisible) || phase === "boot" || phase === "desktop" || (phase === "return" && holdingReturn);
  const inboundShelf = phase === "vinyl-in" || phase === "books-in" || phase === "photos-in";
  const showShelf = phase === "vinyls" || (inboundShelf && transitionVisible) || ((phase === "vinyl-out" || phase === "books-out" || phase === "photos-out") && holdingReturn);
  useEffect(() => {
    if (!shelfReady.current) return;
    if (phase === "vinyls" || phase === "vinyl-out" || phase === "books-out" || phase === "photos-out") handoff.release();
  }, [phase, handoff.release]);
  useEffect(() => {
    if (!motion) return;
    const playing = traveling || !pageVisible;
    setScenePrimeSuspended(playing);
    if (playing) pauseSceneClips();
    if (phase === "diploma-in" && transitionVisible) {
      const image = new Image();
      image.src = `${MEDIA}diploma.webp`;
      void image.decode().catch(() => {});
    }
    if (playing) return;
    const warm = window.setTimeout(() => {
      if (phase === "room") {
        for (const name of ["approach", "vinyl-in", "books-in", "photos-in", "diploma-in"]) primeSceneClip(sceneTransitionSrc(name, media));
      } else if (phase === "desktop") primeSceneClip(sceneTransitionSrc("return", media));
      else if (phase === "diploma") primeSceneClip(sceneTransitionSrc("diploma-out", media));
    }, phase === "room" ? 700 : 0);
    return () => window.clearTimeout(warm);
  }, [phase, motion, pageVisible, traveling, transitionVisible, media]);
  const destination = phase === "approach" ? "boot" : phase === "diploma-in" ? "diploma" : phase === "vinyl-in" || phase === "books-in" || phase==='photos-in' ? "vinyls" : "room";
  function enterVinyls() { shelfReady.current = false; setInitialCubby(1); returnTarget.current = "vinyls"; setTransitionVisible(false); setPhase(motion ? "vinyl-in" : "vinyls"); }
  function enterBooks() { shelfReady.current = false; setInitialCubby(0); returnTarget.current = "books"; setTransitionVisible(false); setPhase(motion ? "books-in" : "vinyls"); }
  function enterPhotos(){shelfReady.current=false;setInitialCubby(2);returnTarget.current='photos';setTransitionVisible(false);setPhase(motion?'photos-in':'vinyls');}
  function enterDiploma() {
    returnTarget.current = "diploma";
    setTransitionVisible(false);
    setPhase(motion ? "diploma-in" : "diploma");
  }
  function onShelfReady() {
    shelfReady.current = true;
    const current = phaseRef.current;
    if (current === "vinyls" || current === "vinyl-out" || current === "books-out" || current === "photos-out") handoff.release();
  }

  return (
    <main className={`cinematic-room cinematic-${phase}`} data-viewport-fit="cover" data-mobile-layout={mobileLayout} data-responsive={responsiveLayout ? "true" : undefined} data-activity-cues={activityCues}>
      <h1 className="cinematic-sr">Brian Zeng’s portfolio</h1>
      <div className="cinematic-stage" aria-label="Brian’s room"
        onPointerMove={event => {
          const glow = roomGlow.current;
          if (!glow || event.pointerType === "touch") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          glow.style.setProperty("--glow-x", `${100 * (event.clientX - bounds.left) / bounds.width}%`);
          glow.style.setProperty("--glow-y", `${100 * (event.clientY - bounds.top) / bounds.height}%`);
          glow.style.opacity = "1";
          if (glowFade.current) clearTimeout(glowFade.current);
          glowFade.current = setTimeout(() => { glow.style.opacity = "0"; }, 450);
        }}
        onPointerLeave={() => { if (roomGlow.current) roomGlow.current.style.opacity = "0"; }}>
        {/* The image paints immediately, including when autoplay is blocked. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cinematic-media" src={phase === "vinyls" || ['books-out','vinyl-out','photos-out'].includes(phase) ? initialCubby===2?`${photosMedia}photos-still.webp`:initialCubby===0&&coherentBooks?`${BOOK_CONSISTENCY_MEDIA}books-still.webp`:`${initialCubby===1?SHELF_MEDIA:MEDIA}${['books','vinyl','photos'][initialCubby]}-still.webp` : `${MEDIA}greeting.webp`} alt="A grayscale room with white highlights on the monitor, vinyl records, and a framed diploma." fetchPriority="high" width={1920} height={1080} />
        {motion && !idleFailed && <video ref={idle} className="cinematic-media cinematic-idle" src={`${MEDIA}idle.mp4`} muted loop playsInline autoPlay preload="none" aria-hidden="true" onError={() => setIdleFailed(true)} />}
        {phase === "room" && motion && pageVisible && <div ref={roomGlow} className="cinematic-outline-glow" aria-hidden="true" />}
        {phase === "room" && motion && pageVisible && <PolaroidPulse />}
        {<RoomSpeakerActivity playing={!speakerPreview || speakerMode === "live" ? speakerFeed.playing : speakerMode === "playing"} motion={motion} visible={phase === "room" && pageVisible} />}
        {traveling && <video
          key={phase} ref={transition}
          className={`cinematic-media cinematic-transition ${transitionVisible ? "is-playing" : ""}`}
          src={sceneTransitionSrc(phase, media)}
          muted playsInline autoPlay preload="auto" aria-hidden="true"
          onLoadedData={event => {
            const video = event.currentTarget;
            if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(() => {
              if (transition.current === video) setTransitionVisible(true);
            });
            else setTransitionVisible(true);
          }}
          onEnded={event => {handoff.capture(event.currentTarget);setPhase(destination);}}
          onError={event => {handoff.capture(event.currentTarget);setPhase(destination);}}
        />}
        {phase === "room" && <nav className="cinematic-hotspots" aria-label="Explore the room">
          <button ref={monitorButton} type="button" className="cinematic-hotspot" style={HOTSPOTS.monitor as CSSProperties} onPointerDown={() => arm("approach")} onFocus={() => arm("approach")} onClick={enterMonitor} aria-label="Enter monitor" />
          <button ref={shelfButton} className="cinematic-hotspot" style={HOTSPOTS.vinyls as CSSProperties} onPointerDown={() => arm("vinyl-in")} onFocus={() => arm("vinyl-in")} onClick={enterVinyls} aria-label="Explore project records" />
          <button ref={booksButton} className="cinematic-hotspot" style={HOTSPOTS.books as CSSProperties} onPointerDown={() => arm("books-in")} onFocus={() => arm("books-in")} onClick={enterBooks} aria-label="Explore report books" />
          <button ref={photosButton} className="cinematic-hotspot" style={HOTSPOTS.photos as CSSProperties} onPointerDown={() => arm("photos-in")} onFocus={() => arm("photos-in")} onClick={enterPhotos} aria-label="Explore photographs" />
          <button ref={diplomaButton} className="cinematic-hotspot" style={HOTSPOTS.frame as CSSProperties} onPointerDown={() => arm("diploma-in")} onFocus={() => arm("diploma-in")} onClick={enterDiploma} aria-label="Look at diploma" />
        </nav>}
      </div>

      {phase === "room" && <footer className="cinematic-controls">
        <span>Brian Zeng</span>
        <nav aria-label="Room shortcuts">
          <button type="button" onPointerDown={() => arm("approach")} onFocus={() => arm("approach")} onClick={enterMonitor}>Monitor</button>
          <button type="button" onPointerDown={() => arm("vinyl-in")} onFocus={() => arm("vinyl-in")} onClick={enterVinyls}>Projects</button>
          <button type="button" onPointerDown={() => arm("books-in")} onFocus={() => arm("books-in")} onClick={enterBooks}>Books</button>
          <button type="button" onPointerDown={() => arm("photos-in")} onFocus={() => arm("photos-in")} onClick={enterPhotos}>Photos</button>
          <button type="button" onPointerDown={() => arm("diploma-in")} onFocus={() => arm("diploma-in")} onClick={enterDiploma}>Diploma</button>
          <button type="button" aria-pressed={!motion} onClick={() => setMotion(value => !value)}>{motion ? "Pause motion" : "Enable motion"}</button>
        </nav>
      </footer>}
      {speakerPreview && phase === "room" && <aside className="speaker-review-controls" aria-label="Speaker loop review">
        <p role="status">{speakerMode === "live" ? speakerFeed.status : speakerMode === "playing" ? "Preview · playing (simulated)" : "Preview · paused (simulated)"}</p>
        <div><button aria-pressed={speakerMode === "playing"} onClick={() => setSpeakerMode("playing")}>Preview loop</button><button aria-pressed={speakerMode === "paused"} onClick={() => setSpeakerMode("paused")}>Preview pause</button><button aria-pressed={speakerMode === "live"} onClick={() => setSpeakerMode("live")}>Live Spotify</button></div>
        <small>Draft effect · awaiting approval</small>
      </aside>}

      {traveling && <button className="cinematic-back" type="button" onClick={() => {handoff.capture(transition.current);setPhase(destination);}}>Skip animation →</button>}
      {showShelf && <Suspense fallback={<div className={inboundShelf ? 'cinematic-sr' : mobileLayout?'cinematic-sr':'cinematic-shelf-loading'} role="status">Preparing the shelf…</div>}><VinylShelf preparing={inboundShelf && transitionVisible} coherentPhotos={coherentPhotos} coherentBooks={coherentBooks} refinedCues={refinedCues} cueFadeIn={cueFadeIn} cueMemory={shelfCueMemory.current} mobileLayout={mobileLayout} responsiveLayout={responsiveLayout} activityCues={activityCues && phase==='vinyls'} review={shelfReview} initialCubby={initialCubby} onReady={onShelfReady} motion={motion} onExit={cubby=>{restoreFocus.current=true;setInitialCubby(cubby);returnTarget.current=cubby===0?"books":cubby===2?'photos':"vinyls";setTransitionVisible(false);setPhase(motion?(cubby===0?"books-out":cubby===2?'photos-out':"vinyl-out"):"room");}} /></Suspense>}
      {(phase === "diploma" || (phase === "diploma-out" && holdingReturn)) && <div className="cinematic-diploma">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={diplomaImage} src={`${MEDIA}diploma.webp`} alt="Close-up of Brian’s framed diploma" />
        {mobileLayout&&<DiplomaEnlargement />}
        <button className="cinematic-back" onPointerDown={() => arm("diploma-out")} onClick={() => { restoreFocus.current = true; setTransitionVisible(false); setPhase(motion ? "diploma-out" : "room"); }}>← Room</button>
      </div>}
      {showDesktop && <div className={`cinematic-desktop ${phase === "desktop" || phase === "return" ? "is-ready" : ""}`}>
        <iframe ref={desktop} src={responsiveLayout?'/review/responsive-desktop':mobileLayout&&shelfReview?'/review/mobile-desktop':'/desktop'} title="Brian’s desktop" onLoad={() => setDesktopLoaded(true)} tabIndex={phase === "desktop" ? 0 : -1} />
        {phase === "boot" && <div ref={bootStatus} tabIndex={-1} className="cinematic-boot" role="status" aria-live="polite">
          <span className="cinematic-boot-track" aria-hidden="true"><i /></span>
          <span className="cinematic-sr">Starting Brian’s desktop</span>
          {bootFinished && !desktopLoaded && <a href="/desktop">Open desktop directly →</a>}
        </div>}
        <button className="cinematic-back" type="button" onPointerDown={() => arm("return")} onClick={leaveMonitor}>← Room</button>
      </div>}
      <canvas ref={handoff.canvas} className="cinematic-handoff" aria-hidden="true" />
      {activityCues && phase==='room' && !greetingCuesDone && <ActivityCues fadeIn={cueFadeIn} refined={refinedCues} sceneKey="room" ready={pageVisible}
        visibleMs={refinedCues?2000:3000} allowReplay={false} onComplete={()=>setGreetingCuesDone(true)} cues={[
        {id:'monitor',label:'',appearance:'arrow-only',selector:'.cinematic-hotspot[aria-label="Enter monitor"]',side:'left'},
        {id:'books',label:'',appearance:'arrow-only',selector:'.cinematic-hotspot[aria-label="Explore report books"]',side:'top',targetInset:{top:.65,right:refinedCues?.72:.25}},
        {id:'records',label:'',appearance:'arrow-only',selector:'.cinematic-hotspot[aria-label="Explore project records"]',side:'left'},
        {id:'photos',label:'',appearance:'arrow-only',selector:'.cinematic-hotspot[aria-label="Explore photographs"]',side:'bottom',targetInset:{bottom:.55}},
        {id:'diploma',label:'',appearance:'arrow-only',selector:'.cinematic-hotspot[aria-label="Look at diploma"]',side:'right'},
      ]}/>}
      {activityCues && phase==='diploma' && <ActivityCues fadeIn={cueFadeIn} refined={refinedCues} visibleMs={refinedCues?2000:undefined} sceneKey="diploma" ready={pageVisible} cues={[
        {id:'enlarge-diploma',label:refinedCues?'Click to Enlarge':'Click',touchLabel:refinedCues?'Tap to Enlarge':'Tap',selector:'.diploma-enlarge-target',side:'right'},
      ]}/>}
      {activityCues && shelfReview && (phase==='vinyls'||phase==='diploma') && <button className="activity-cue-replay" onClick={replayActivityCues}>Replay notes</button>}
      <noscript><nav className="cinematic-noscript"><a href="/desktop">Open desktop</a><a href="/projects">Projects</a><a href="/about">About Brian</a></nav></noscript>
    </main>
  );
}

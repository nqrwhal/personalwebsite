"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import PROJECTS from "../data/vinyls.json";
import { dragVinyl, snapVinylFace } from "./vinylInteraction";
import { closingPageOffset, curlPageCorner, pageTurnVertex } from "./bookPageMotion";
import { canSelectRecord, nextSpread, type ShelfSelection } from "./shelfState";
import { loadReportBook, pageTextureURL, boundedSpread } from './reportBook';
import { createShelfPlayer, startShelfPlayback, type PlayerModel } from './shelfRecordPlayer';
import {createPolaroidGallery} from './shelfPolaroids';
import {loadPlaybackFilms,startRestoredPlayback} from './shelfPlaybackStaging';
import {getShelfPlates} from './panHandoff';
import {SHELF_MOBILE_QUERY, SHELF_PORTRAIT_QUERY, visibleShelfFit, shelfInspectionScale, type ShelfFit} from './shelfMobileLayout';

export type ShelfControls = {
  hover: (selection: ShelfSelection) => void;
  select: (selection: ShelfSelection) => void;
  flip: () => void;
  playRecord: () => void;
  inspectPhoto: (index:number|null) => void;
  openBook: (open: boolean) => void;
  page: (direction: -1 | 1) => void;
  jumpPage: (page: number) => void;
  corner: (direction: -1 | 1 | null) => void;
  returnToShelf: () => Promise<void>;
  settle: () => Promise<void>;
};
type MeshExport = { positions: number[]; indices: number[] };
type Export = {
  objects: (MeshExport & { project: number; origin: number[]; quaternion: number[]; uvs: number[]; materials: number[]; edges: number[][][] })[];
  occluders: MeshExport[];
  cubbies: { camera: number[]; quaternion: number[]; verticalFov: number }[];
  book: { origin: number[]; quaternion: number[]; body: MeshExport; outline: MeshExport; width: number; height: number; thickness: number };
  hoverTravel: number; outlineRadius: number;
};
export type PageCorners = { left: { x: number; y: number }; right: { x: number; y: number } };
type PageBox = { x: number; y: number; width: number; height: number };
export type BookLayout = { left: PageBox; right: PageBox; visible: boolean };
/** CSS-pixel bounds in the browser viewport, not percentages of the 16:9 stage. */
export type CueBounds = { x: number; y: number; width: number; height: number };
type Props = {
  review?: boolean;
  coherentPhotos?: boolean;
  coherentBooks?: boolean;
  mobileLayout?: boolean;
  responsiveLayout?: boolean;
  cueLayout?: boolean;
  cubby: number; motion: boolean; controls: MutableRefObject<ShelfControls | null>;
  onReady: () => void; onFailed: () => void; onSelect: (selection: ShelfSelection) => void;
  onBook: (open: boolean) => void; onSpread: (spread: number) => void; onTurning: (turning: boolean) => void;
  onCorners: (corners: PageCorners) => void;
  onLayout: (layout: BookLayout) => void;
  onPlayback: (state: 'playing' | 'finished' | null) => void;
  onPhoto: (index:number|null) => void;
  onCueTargets?: (targets: Record<string, CueBounds>) => void;
};

export default function ShelfScene(props: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    let cancelled = false, destroy = () => {};
    const host = mount.current!;
    async function initialize() {
      const [T, response] = await Promise.all([import("three"), fetch("/room/v156/shelf-geometry.json")]);
      if (!response.ok) throw new Error("Shelf unavailable");
      const model: Export = await response.json();
      const report = props.cubby === 0 ? await loadReportBook() : null;
      const playerModel: PlayerModel | null = props.cubby === 1 ? await fetch('/review/v138/player.json').then(r=>{if(!r.ok)throw new Error('Player unavailable');return r.json();}) : null;
      const player = playerModel ? await createShelfPlayer(T,playerModel) : null;
      // Approved v158 playback/return is shared by the main site and staging.
      // `review` only suppresses the automatic project redirect.
      const films=props.cubby===1?await loadPlaybackFilms():null;
      const spreadCount = report ? Math.ceil(report.pages.length / 2) : 3;
      const nextBookSpread = (value: number, direction: -1 | 1) => nextSpread(value, direction, spreadCount);
      const plate = new Image(); plate.src = getShelfPlates(props.coherentPhotos,props.coherentBooks)[props.cubby].background;
      await plate.decode();
      const textures = props.cubby === 1 ? await Promise.all(PROJECTS.slice(0, 5).map(p => Promise.all(["front", "back", "spine"].map(side => new T.TextureLoader().loadAsync(`/room/vinyl-art/v149/${p.slug}-${side}.png`))))) : [];
      if (cancelled) { textures.flat().forEach(t => t.dispose()); films?.dispose();player?.dispose(); return; }
      const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0, 0); host.appendChild(renderer.domElement);
      const scene = new T.Scene(), spec = model.cubbies[props.cubby];
      if(player)scene.add(player.background);
      const camera = new T.PerspectiveCamera(spec.verticalFov, 16 / 9, .01, 20);
      camera.position.fromArray(spec.camera); camera.quaternion.fromArray(spec.quaternion);
      const forward = new T.Vector3(); camera.getWorldDirection(forward);
      const cameraRight = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const cameraUp = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const inspection = camera.position.clone().addScaledVector(forward, 1.2);
      let mobileFit: ShelfFit | null = null, mobileBookFit: ShelfFit | null = null;
      function refreshMobileFit() {
        const portrait = Boolean(latest.current.responsiveLayout && window.matchMedia(SHELF_PORTRAIT_QUERY).matches);
        const active = (latest.current.mobileLayout && window.matchMedia(SHELF_MOBILE_QUERY).matches) || portrait;
        host.dataset.mobileFit = active ? 'true' : 'false';
        if (!active) { mobileFit = null; mobileBookFit = null; return; }
        const viewport = window.visualViewport;
        const visible = {left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
          width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight};
        const stage = host.getBoundingClientRect();
        // Playback temporarily animates the camera FOV. A resize during that
        // animation must still calculate the eventual shelf inspection fit.
        const aspect = stage.width / stage.height;
        const fov = Math.max(spec.verticalFov, T.MathUtils.radToDeg(2 * Math.atan(.59 / (2 * 1.2 * aspect))));
        // Staged notes need an honest empty lane above the cover/photo frames.
        // Reserve it for their whole visit so fading never moves the object.
        mobileFit = visibleShelfFit(stage, visible, fov, aspect,
          portrait ? {left:18,right:18,top:18,bottom:18} : latest.current.cueLayout ? {left:24,right:24,top:72,bottom:54} : undefined);
        mobileBookFit = visibleShelfFit(stage, visible, fov, aspect, portrait ? {left:18,right:18,top:18,bottom:18} : {left:64,right:112,top:14,bottom:54});
      }
      refreshMobileFit();
      const frontPose = camera.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2));
      const black = new T.MeshBasicMaterial({ color: 0x080808 });
      const gray = new T.MeshBasicMaterial({ color: 0x484848 });
      function geometry(data: MeshExport) { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(data.positions, 3)); g.setIndex(data.indices); return g; }
      for (const data of model.occluders) {
        const mask = new T.Mesh(geometry(data), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: T.DoubleSide }));
        mask.renderOrder = -1; scene.add(mask);
      }
      const items: { group: InstanceType<typeof T.Group>; origin: InstanceType<typeof T.Vector3>; rest: InstanceType<typeof T.Quaternion>; id: ShelfSelection }[] = [];
      if (props.cubby === 1) for (const data of model.objects) {
        if (!canSelectRecord(data.project)) continue;
        const g = geometry(data); g.setAttribute("uv", new T.Float32BufferAttribute(data.uvs, 2)); data.materials.forEach((m, face) => g.addGroup(face * 6, 6, m));
        const group = new T.Group(), origin = new T.Vector3().fromArray(data.origin), rest = new T.Quaternion().fromArray(data.quaternion);
        group.position.copy(origin); group.quaternion.copy(rest); group.userData.selection = data.project;
        const materials = [gray, ...textures[data.project].map(texture => { texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); return new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }); })];
        group.add(new T.Mesh(g, materials));
        for (const edge of data.edges) {
          const a = new T.Vector3().fromArray(edge[0]), b = new T.Vector3().fromArray(edge[1]);
          const tube = new T.Mesh(new T.CylinderGeometry(model.outlineRadius, model.outlineRadius, a.distanceTo(b), 8), black);
          tube.position.copy(a).add(b).multiplyScalar(.5); tube.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.sub(a).normalize()); group.add(tube);
        }
        const disc = player!.record.clone(true);
        disc.rotation.x = Math.PI / 2; disc.position.set(.065, 0, 0); disc.userData.disc = true; group.add(disc);
        scene.add(group); items.push({ group, origin, rest, id: data.project });
      }

      const book = new T.Group(), closedBook = new T.Group(), openedBook = new T.Group();
      openedBook.visible = false;
      const w = model.book.width, h = model.book.height, thick = model.book.thickness;
      const bookOrigin = new T.Vector3().fromArray(model.book.origin), bookRest = new T.Quaternion().fromArray(model.book.quaternion);
      book.position.copy(bookOrigin); book.quaternion.copy(bookRest); book.userData.selection = "book";
      closedBook.add(new T.Mesh(geometry(model.book.body), gray), new T.Mesh(geometry(model.book.outline), black)); book.add(closedBook, openedBook);
      if (props.cubby === 0) { scene.add(book); items.push({ group: book, origin: bookOrigin, rest: bookRest, id: "book" }); }
      const paper = new T.MeshStandardMaterial({ color: 0xbebebb, roughness: .95, side: T.DoubleSide });
      scene.add(new T.AmbientLight(0xffffff, 1.8)); const lamp = new T.DirectionalLight(0xffffff, 2); lamp.position.copy(camera.position).add(new T.Vector3(0, 1, 2)); scene.add(lamp);
      const coverMaterial = new T.MeshStandardMaterial({ color: 0x3d3d3d, roughness: 1, side: T.DoubleSide });
      // Extra board overhang accounts for the rear board's perspective shrinkage.
      const backCover = new T.Mesh(new T.BoxGeometry(w * 1.09, .004, h * 1.05), coverMaterial); backCover.position.y = thick / 2; openedBook.add(backCover);
      const rightStack = new T.Mesh(new T.BoxGeometry(w * .96, thick * .75, h * .97), paper); openedBook.add(rightStack);
      const coverHinge = new T.Group(); coverHinge.position.set(-w / 2, -thick / 2, 0);
      const frontCover = new T.Mesh(new T.BoxGeometry(w, .004, h), coverMaterial); frontCover.position.x = w / 2; coverHinge.add(frontCover); openedBook.add(coverHinge);
      const coverCanvas=document.createElement('canvas');coverCanvas.width=600;coverCanvas.height=750;
      const ink=coverCanvas.getContext('2d')!;ink.fillStyle='#3d3d3d';ink.fillRect(0,0,600,750);
      ink.strokeStyle='#93938f';ink.lineWidth=2;ink.strokeRect(28,28,544,694);ink.fillStyle='#eeeeea';
      ink.font='18px Arial';ink.fillText('DATA SCIENCE STUDIES',52,98);
      ink.font='48px Georgia';let line='',lineY=260;
      for(const word of (report?.title??'Data Science Report').split(' ')){const candidate=line?line+' '+word:word;if(ink.measureText(candidate).width>490&&line){ink.fillText(line,52,lineY);lineY+=60;line=word;}else line=candidate;}
      ink.fillText(line,52,lineY);ink.font='22px Arial';ink.fillText('Brian Zeng',52,660);
      const coverTexture=new T.CanvasTexture(coverCanvas);coverTexture.colorSpace=T.SRGBColorSpace;
      coverTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();
      const coverTitleMaterial=new T.MeshBasicMaterial({map:coverTexture});
      function titleFace(){const face=new T.Mesh(new T.PlaneGeometry(w*.98,h*.98),coverTitleMaterial);face.rotation.x=Math.PI/2;return face;}
      const closedTitle=titleFace();closedTitle.position.y=-thick/2-.0022;closedBook.add(closedTitle);
      const openingTitle=titleFace();openingTitle.position.set(w/2,-.0022,0);coverHinge.add(openingTitle);
      // The inner vertex column is exactly x=0: every sheet shares the binding
      // axis instead of stopping short of it and exposing a black cover gap.
      function sheet() { const g = new T.PlaneGeometry(w * .98, h * .97, 32, 24); g.rotateX(Math.PI / 2); g.translate(w * .49, 0, 0); return g; }
      const leftMaterial = new T.MeshBasicMaterial({color:0xf1f1ed,side:T.DoubleSide}), rightMaterial = leftMaterial.clone();
      // A narrow binding shadow suggests the crease without separating pages.
      for(const material of [leftMaterial,rightMaterial]){material.onBeforeCompile=shader=>{
        shader.vertexShader='varying float bindingU;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nbindingU=uv.x;');
        shader.fragmentShader='varying float bindingU;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=mix(.9,1.,smoothstep(0.,.035,bindingU));');
      };material.customProgramCacheKey=()=> 'book-binding-crease';}
      const leftPage = new T.Mesh(sheet(), leftMaterial); leftPage.position.y = .0025; coverHinge.add(leftPage);
      const rightPage = new T.Mesh(sheet(), rightMaterial); rightPage.position.set(-w / 2, -thick / 2 - .0025, 0); openedBook.add(rightPage);
      leftMaterial.side=T.BackSide;rightMaterial.side=T.FrontSide;
      const leftUnderside=new T.Mesh(leftPage.geometry,new T.MeshBasicMaterial({color:0xd6d6d0,side:T.FrontSide}));leftUnderside.position.copy(leftPage.position);coverHinge.add(leftUnderside);
      const rightUnderside=new T.Mesh(rightPage.geometry,new T.MeshBasicMaterial({color:0xd6d6d0,side:T.BackSide}));rightUnderside.position.copy(rightPage.position);openedBook.add(rightUnderside);
      // Both the cover board and resting sheets remain behind the moving leaf.
      const leftPeekMaterial=new T.MeshBasicMaterial({side:T.BackSide}),rightPeekMaterial=new T.MeshBasicMaterial({side:T.FrontSide});
      const leftPeek=new T.Mesh(sheet(),leftPeekMaterial);leftPeek.position.y=.00225;leftPeek.visible=false;coverHinge.add(leftPeek);
      const rightPeek=new T.Mesh(sheet(),rightPeekMaterial);rightPeek.position.set(-w/2,-thick/2-.00225,0);rightPeek.visible=false;openedBook.add(rightPeek);
      const turnHinge = new T.Group(); turnHinge.position.set(-w / 2, -thick / 2 - .0025, 0); openedBook.add(turnHinge);
      // A zero-thickness, double-sided sheet, not a rotating board.
      const turnGeometry = sheet();
      const turnFrontMaterial = new T.MeshBasicMaterial({color:0xffffff,side:T.FrontSide}), turnBackMaterial = new T.MeshBasicMaterial({color:0xffffff,side:T.BackSide});
      for(const material of [turnFrontMaterial,turnBackMaterial]){material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-1;}
      const turningPage = new T.Mesh(turnGeometry, turnFrontMaterial), turningBack = new T.Mesh(turnGeometry, turnBackMaterial); turnHinge.add(turningPage, turningBack); turnHinge.visible = false;
      const textureCache = new Map<string, InstanceType<typeof T.Texture>>();
      const pendingTextures = new Map<string, Promise<InstanceType<typeof T.Texture>>>();
      async function pageMap(index: number, mirrored = false) {
        index = Math.max(0, Math.min((report?.pages.length ?? 1)-1,index));
        const key = `${index}:${mirrored}`;
        if(textureCache.has(key))return textureCache.get(key)!;
        if(pendingTextures.has(key))return pendingTextures.get(key)!;
        const task = new T.TextureLoader().loadAsync(pageTextureURL(index)).then(texture=>{
          texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
          if(mirrored){texture.repeat.x=-1;texture.offset.x=1;}
          if(cancelled){texture.dispose();return texture;}
          textureCache.set(key,texture);pendingTextures.delete(key);return texture;
        }).catch(error=>{pendingTextures.delete(key);throw error;});
        pendingTextures.set(key,task);return task;
      }
      function assignMap(material: InstanceType<typeof T.MeshBasicMaterial>,texture: InstanceType<typeof T.Texture>){material.map=texture;material.color.set(0xffffff);material.needsUpdate=true;}
      async function mapsForSpread(value: number) { return Promise.all([pageMap(value*2,true),pageMap(value*2+1)]); }
      function trimTextures(){const used=new Set([textureCache.get('0:true'),textureCache.get('1:false'),leftMaterial.map,rightMaterial.map,turnFrontMaterial.map,turnBackMaterial.map,leftPeekMaterial.map,rightPeekMaterial.map]);for(const [key,texture] of textureCache)if(textureCache.size>12&&!used.has(texture)){texture.dispose();textureCache.delete(key);}}
      if(report){const maps=await mapsForSpread(0);assignMap(leftMaterial,maps[0]);assignMap(rightMaterial,maps[1]);}
      const rest = new Float32Array(turnGeometry.getAttribute("position").array);
      function deform(g: InstanceType<typeof T.BufferGeometry>, curl: number, sign = 1, bend = 0) {
        const a = g.getAttribute("position") as InstanceType<typeof T.BufferAttribute>;
        for (let i = 0; i < a.count; i++) {
          const x = rest[i * 3], z = rest[i * 3 + 2];
          const p = curlPageCorner(x, z, w * .98, h * .97, curl);
          a.setXYZ(i, p.x, sign * p.y - Math.sin(Math.PI * x / w) * bend * w * .1, p.z);
        }
        a.needsUpdate = true; g.computeVertexNormals();
      }
      function deformTurn(progress: number, initialCurl: number, direction: -1|1){
        const a=turnGeometry.getAttribute('position') as InstanceType<typeof T.BufferAttribute>;
        for(let i=0;i<a.count;i++){const p=pageTurnVertex(rest[i*3],rest[i*3+2],w*.98,h*.97,progress,initialCurl,direction);a.setXYZ(i,p.x,p.y,p.z);}
        a.needsUpdate=true;turnGeometry.computeVertexNormals();
      }

      let selected: ShelfSelection = null, hover: ShelfSelection = null, open = false, spread = 0;
      let turn = 0, tilt = 0, opening = 0, active = true, raf = 0, last = 0, locked = false, needsPaint = true, wasMoving = true;
      let pageTurn: { start: number; direction: -1 | 1; spread: number; initialCurl: number; duration?: number } | null = null;
      let closing: { returning: boolean; position: InstanceType<typeof T.Vector3>; step: number; preparing: boolean } | null = null;
      let textureRequest=0;
      let playback:ReturnType<typeof startShelfPlayback>|ReturnType<typeof startRestoredPlayback>|null=null;
      let recordReturn:{id:number;start:number;position:InstanceType<typeof T.Vector3>;quaternion:InstanceType<typeof T.Quaternion>;scale:number}|null=null;
      function playRecord(){
        if(locked||typeof selected!=='number'||!player||!playerModel)return;
        const id=selected,item=items.find(i=>i.id===id)!;
        const disc=item.group.children.find(o=>o.userData.disc) as InstanceType<typeof T.Group>;
        locked=true;hover=null;latest.current.onPlayback('playing');
        const finished=()=>{
          host.dataset.playback='finished';latest.current.onPlayback('finished');
          if(props.review)return;
          // Do not pull the viewer into a blank tab before the animation. The
          // finished UI also retains a normal link if popups are blocked.
          const destination=window.open('','_blank');
          if(destination){destination.opener=null;destination.location.replace(PROJECTS[id].href!);}
        };
        playback=films?startRestoredPlayback(T,player,playerModel,renderer,scene,camera,item.group,disc,films,!latest.current.motion,finished,{position:item.origin,quaternion:item.rest}):startShelfPlayback(T,player,playerModel,renderer,scene,camera,item.group,disc,plate,!latest.current.motion,finished);
        host.dataset.playback='playing';
      }
      let peekRequest=0,leftPeekReady=false,rightPeekReady=false,preparingPeeks=false;
      async function preparePeeks(){
        const request=++peekRequest,value=spread;
        preparingPeeks=true;
        leftPeekReady=false;rightPeekReady=false;leftPeek.visible=false;rightPeek.visible=false;
        await Promise.all(([-1,1] as const).map(async direction=>{
          const next=nextBookSpread(value,direction);if(next===value)return;
          try{const texture=await pageMap(direction===1?next*2+1:next*2,direction===-1);
            if(cancelled||request!==peekRequest||spread!==value)return;
            assignMap(direction===1?rightPeekMaterial:leftPeekMaterial,texture);
            if(direction===1){rightPeekReady=true;rightPeek.visible=true;}else{leftPeekReady=true;leftPeek.visible=true;}
            needsPaint=true;
          }catch{/* Keep the page flat until its real neighbour is available. */}
        }));
        if(request===peekRequest)preparingPeeks=false;
      }
      let journey: { target: number; duration: number } | null = null;
      let unlockAfterReturn = false;
      let corner: -1 | 1 | null = null, leftCurl = 0, rightCurl = 0;
      let settleResolve: (() => void) | null = null;
      let down: { x: number; y: number; startX: number; startY: number; dragged: boolean } | null = null;
      const gallery=props.cubby===2?await createPolaroidGallery(T,scene,camera,()=>latest.current.motion,value=>{locked=value;latest.current.onTurning(value);needsPaint=true;},value=>latest.current.onPhoto(value),()=>mobileFit):null;
      let lastCueTime=-Infinity,lastCueKey='',lastCueListener:Props['onCueTargets'];
      function publishCueTargets(now:number,settled=false) {
        const listener=latest.current.onCueTargets;
        // No projection work or DOM reads in the approved production experience.
        if(!listener||now-lastCueTime<100)return;
        lastCueTime=now;
        const targets:Record<string,CueBounds>={};
        // Stationary notes must capture the final inspection pose, never an
        // intermediate frame of the sleeve/card/book leaving its shelf slot.
        if(!playback&&(selected===null||settled)){
          camera.updateMatrixWorld();scene.updateMatrixWorld(true);
          const viewport=canvas.getBoundingClientRect();
          const projected=(roots:InstanceType<typeof T.Object3D>[],excludeDisc=false):CueBounds|null=>{
            let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
            for(const root of roots)root.traverseVisible(object=>{
              if(excludeDisc){let ancestor:InstanceType<typeof T.Object3D>|null=object;while(ancestor&&ancestor!==root){if(ancestor.userData.disc)return;ancestor=ancestor.parent;}}
              const mesh=object as InstanceType<typeof T.Mesh>;
              if(!mesh.geometry)return;
              if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
              const bounds=mesh.geometry.boundingBox;if(!bounds)return;
              for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
                const point=new T.Vector3(x,y,z).applyMatrix4(object.matrixWorld).project(camera);
                if(point.z < -1||point.z > 1)continue;
                const px=viewport.left+(point.x+1)*viewport.width/2,py=viewport.top+(1-point.y)*viewport.height/2;
                minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
              }
            });
            if(!Number.isFinite(minX))return null;
            // Half-pixel quantization prevents tiny settled interpolation changes
            // from continuously updating React state, without losing mobile fit.
            const round=(v:number)=>Math.round(v*2)/2;
            return {x:round(minX),y:round(minY),width:round(maxX-minX),height:round(maxY-minY)};
          };
          const add=(key:string,objects:InstanceType<typeof T.Object3D>[],excludeDisc=false)=>{const bounds=projected(objects,excludeDisc);if(bounds)targets[key]=bounds;};
          if(props.cubby===0){
            add(selected==='book'?'book':'books',[book]);
            if(selected==='book'&&opening===1){
              leftPage.geometry.computeBoundingBox();rightPage.geometry.computeBoundingBox();
              add('page-left',[leftPage]);add('page-right',[rightPage]);
            }
          }
          if(props.cubby===1){
            if(typeof selected==='number'){
              const item=items.find(item=>item.id===selected);
              if(item){
                add('cover',[item.group],true);
                const disc=item.group.children.find(object=>object.userData.disc);
                if(disc){
                  const discBounds=projected([disc]),cover=targets.cover;
                  if(discBounds&&cover){
                    // On the reverse the exposed record is on the left. Target
                    // its visible crescent, never its centre hidden by the sleeve.
                    const left=Math.max(0,cover.x-discBounds.x),right=Math.max(0,discBounds.x+discBounds.width-cover.x-cover.width);
                    const width=Math.max(left,right);
                    if(width>1)targets.disc={...discBounds,x:left>right?discBounds.x:cover.x+cover.width,width};
                  }
                }
              }
            }else add('records',items.map(item=>item.group),true);
          }
          if(gallery){
            const photos=gallery.cueObjects();
            add('photos',photos.cards);
            if(selected==='photos'){
              photos.cards.forEach((card,index)=>add(`photo-${index}`,[card]));
              if(photos.selected!==null)add('photo-selected',[photos.cards[photos.selected]]);
            }
          }
        }
        const key=JSON.stringify(targets);
        if(key!==lastCueKey||listener!==lastCueListener){lastCueKey=key;lastCueListener=listener;listener(targets);}
      }
      const eligible = (value: ShelfSelection) => value === null || (value === "book" ? props.cubby === 0 : value==='photos'?props.cubby===2:props.cubby === 1 && canSelectRecord(value));
      function setOpen(value: boolean) { if (selected !== "book") return; open = value; corner = null; needsPaint = true; if(value)void preparePeeks();latest.current.onBook(value); }
      function select(value: ShelfSelection) {
        if (!eligible(value) || locked) return;
        // Clear the old pose before React sees the new selection. This also
        // protects direct record-to-record changes from reusing stale bounds.
        lastCueKey='';latest.current.onCueTargets?.({});
        selected = value; hover = null; turn = 0; tilt = 0; open = false; corner = null; pageTurn = null; turnHinge.visible = false; spread = 0; needsPaint = true;
        latest.current.onSelect(value); latest.current.onBook(false); latest.current.onSpread(0); latest.current.onTurning(false);
        if(value==='photos')gallery?.open();
        if(value==='book')void mapsForSpread(0).then(maps=>{if(!cancelled){assignMap(leftMaterial,maps[0]);assignMap(rightMaterial,maps[1]);needsPaint=true;}}).catch(()=>{});
      }
      function closeBook(returning: boolean) {
        textureRequest++;
        peekRequest++;preparingPeeks=false;leftPeekReady=false;rightPeekReady=false;
        leftPeek.visible=false;rightPeek.visible=false;if(!pageTurn)turnHinge.visible=false;
        leftCurl=0;rightCurl=0;deform(leftPage.geometry,0,-1);deform(rightPage.geometry,0);
        journey=null;
        locked = true; hover = null; corner = null; needsPaint = true;
        closing = { returning, position: book.position.clone(), step: Math.max(1,Math.ceil(spread/5)), preparing:false };
        latest.current.onTurning(true);
        if (!latest.current.motion) { pageTurn = null; spread = 0; latest.current.onSpread(0); }
      }
      async function returnItem(unlock: boolean) {
        let returnedFromPlayer=false;
        if(selected==='photos'&&gallery)return gallery.close().then(()=>{locked=false;select(null);locked=!unlock;});
        if(playback){
          if('returnToShelf' in playback){latest.current.onPlayback('playing');await playback.returnToShelf();if(cancelled)return;returnedFromPlayer=true;}
          playback.stop();playback=null;locked=false;host.dataset.playback='';latest.current.onPlayback(null);
        }
        return new Promise<void>(resolve => {
          if (settleResolve) { resolve(); return; }
          settleResolve = resolve; unlockAfterReturn = unlock;
          if (selected === "book" && (open || opening > 0 || pageTurn)) closeBook(true);
          else {
            if(!returnedFromPlayer&&typeof selected==='number'&&latest.current.motion){const item=items.find(i=>i.id===selected)!;recordReturn={id:selected,start:performance.now(),position:item.group.position.clone(),quaternion:item.group.quaternion.clone(),scale:item.group.scale.x};}
            select(null); locked = true; hover = null;
          }
        });
      }
      async function prepareTurn(next: number, duration: number) {
        const request=++textureRequest;
        const direction: -1|1 = next>spread?1:-1;
        const initialCurl=direction===1?rightCurl:leftCurl;
        try{
          const maps=await mapsForSpread(next);
          const [front,back]=await Promise.all([pageMap(direction===1?spread*2+1:next*2+1),pageMap(direction===1?next*2:spread*2,true)]);
          if(cancelled||request!==textureRequest)return;
          leftCurl=0;rightCurl=0;deform(leftPage.geometry,0);deform(rightPage.geometry,0);
          assignMap(turnFrontMaterial,front);assignMap(turnBackMaterial,back);
          if(direction===1)assignMap(rightMaterial,maps[1]);else assignMap(leftMaterial,maps[0]);
          if(!latest.current.motion){spread=next;journey=null;locked=false;assignMap(leftMaterial,maps[0]);assignMap(rightMaterial,maps[1]);void preparePeeks();latest.current.onSpread(spread);latest.current.onTurning(false);}
          else {pageTurn={start:performance.now(),direction,spread:next,initialCurl,duration};turnHinge.rotation.z=0;deformTurn(0,initialCurl,direction);turnHinge.visible=true;}
          needsPaint=true;
        }catch{if(request===textureRequest){journey=null;if(closing){spread=0;latest.current.onSpread(0);setOpen(false);}else{locked=false;latest.current.onTurning(false);}}}
      }
      function goToSpread(next: number) {
        if(selected!=="book"||!open||opening!==1||pageTurn||locked||next===spread)return;
        locked=true;latest.current.onTurning(true);
        const distance=Math.abs(next-spread);
        journey={target:next,duration:distance===1?900:Math.max(32,Math.min(150,3500/distance))};
        void prepareTurn(latest.current.motion?spread+Math.sign(next-spread):next,journey.duration);
      }
      latest.current.controls.current = {
        hover: value => { if (!locked && eligible(value)) { hover = value; needsPaint = true; } }, select,
        flip: () => { if (!locked && typeof selected === "number") { ({ turn, tilt } = snapVinylFace(turn)); needsPaint = true; } },
        playRecord,
        inspectPhoto:index=>{if(!locked&&selected==='photos')gallery?.inspect(index);},
        openBook: value => { if (!locked && !pageTurn) { if (value) setOpen(true); else closeBook(false); } },
        corner: value => { if (open) { corner = value; needsPaint = true;if(value&&!locked&&!preparingPeeks&&!(value===1?rightPeekReady:leftPeekReady))void preparePeeks(); } },
        page: direction => { void goToSpread(nextBookSpread(spread,direction)); },
        jumpPage: page => { if(report && Number.isFinite(page))void goToSpread(boundedSpread(page,report.pages.length)); },
        returnToShelf: () => returnItem(true),
        settle: () => returnItem(false),
      };
      const raycaster = new T.Raycaster(), pointer = new T.Vector2();
      function hit(event: PointerEvent) {
        const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
        const result = raycaster.intersectObjects(scene.children, true).find(r => {
          if (!(r.object instanceof T.Mesh)) return false;
          let node: InstanceType<typeof T.Object3D> | null = r.object;
          while (node && node !== scene) { if (!node.visible) return false; node = node.parent; }
          return true;
        });
        if (!result) return;
        let root = result.object; while (root.parent && root.parent !== scene) root = root.parent;
        const value = root.userData.selection as ShelfSelection | undefined;
        return value !== undefined && value !== null && eligible(value) ? { result, value } : undefined;
      }
      function move(event: PointerEvent) {
        if (locked) return;
        if (down) {
          const dx = event.clientX - down.x, dy = event.clientY - down.y;
          if (Math.hypot(event.clientX - down.startX, event.clientY - down.startY) > 4) down.dragged = true;
          // Book inspection is deliberately fixed, unlike record inspection.
          if (typeof selected === "number") ({ turn, tilt } = dragVinyl(turn, tilt, dx, dy));
          needsPaint = true;
          down.x = event.clientX; down.y = event.clientY; return;
        }
        const result = hit(event); if (hover !== (result?.value ?? null)) needsPaint = true; hover = result?.value ?? null;
        renderer.domElement.style.cursor = result ? "pointer" : typeof selected === "number" ? "grab" : "default";
      }
      function press(event: PointerEvent) { if (locked || event.button !== 0) return; down = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, dragged: false }; renderer.domElement.setPointerCapture(event.pointerId); }
      function release(event: PointerEvent) {
        if (down && !down.dragged && !locked) {
          const result = hit(event);
          if (result) {
            if (selected === null) select(result.value);
            else if (selected === "book" && !open) setOpen(true);
            else if(selected==='photos'&&gallery){let node=result.result.object;while(node.parent&&node.parent!==scene)node=node.parent;const index=node.userData.photoIndex;if(typeof index==='number')gallery.inspect(index);}
            else if (typeof selected === "number" && selected === result.value) {
              if(result.result.object.userData.disc)playRecord();
              else {({ turn, tilt } = snapVinylFace(turn)); needsPaint = true;}
            }
          }
        }
        down = null;
      }
      function cancel() { down = null; hover = null; needsPaint = true; }
      function visibility() { needsPaint = true; }
      document.addEventListener("visibilitychange", visibility);
      const canvas = renderer.domElement;
      canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerdown", press); canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("pointerleave", () => { if (!down) { hover = null; needsPaint = true; } });
      const resize = new ResizeObserver(() => {
        camera.aspect = host.clientWidth / host.clientHeight;
        camera.fov = Math.max(spec.verticalFov, T.MathUtils.radToDeg(2 * Math.atan(.59 / (2 * 1.2 * camera.aspect)))); camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); needsPaint = true;
        refreshMobileFit();
        // Resizing clears the drawing buffer: repaint in this same callback.
        if(playback)playback.draw(performance.now());else renderer.render(scene,camera);
      }); resize.observe(host); renderer.setSize(host.clientWidth, host.clientHeight);
      const viewportResize = () => { refreshMobileFit(); needsPaint = true; };
      window.addEventListener('resize', viewportResize);
      window.visualViewport?.addEventListener('resize', viewportResize);
      window.visualViewport?.addEventListener('scroll', viewportResize);
      let lastCorners = "";
      function render(now: number) {
        if (!active) return;
        if(playback){playback.draw(now);publishCueTargets(now);raf=requestAnimationFrame(render);return;}
        const galleryMoving=gallery?.update(now)??false;
        if(galleryMoving)needsPaint=true;
        const dt = Math.min((now - last) / 1000, .1); last = now; const alpha = latest.current.motion ? 1 - Math.exp(-dt * 12) : 1;
        if (closing && !pageTurn) {
          if (spread > 0 && latest.current.motion) {
            if(!closing.preparing){
              const captured=closing,next=Math.max(0,spread - closing.step);closing.preparing=true;
              // Use the same initialized, spine-attached sheet as ordinary turns.
              // Never expose the previous turn's end-state for its first frame.
              void prepareTurn(next,160).finally(()=>{if(closing===captured)closing.preparing=false;});
            }
          } else if (open) setOpen(false);
        }
        const turned = frontPose.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), turn)); turned.premultiply(new T.Quaternion().setFromAxisAngle(cameraRight, tilt));
        const coverAlpha = closing && latest.current.motion ? 1 - Math.exp(-dt * 24) : alpha;
        opening += ((open ? 1 : 0) - opening) * coverAlpha; if (Math.abs(opening - (open ? 1 : 0)) < .0001) opening = open ? 1 : 0;
        closedBook.visible = opening < .001; openedBook.visible = !closedBook.visible; coverHinge.rotation.z = -Math.PI * opening;
        // Keep the stationary sheet inside the swinging front board. Its old
        // fixed y lay outside the closed cover and clipped through the title.
        const pageOffset=closingPageOffset(opening),peekOffset=closingPageOffset(opening,.00225);
        rightPage.position.set(-w/2+pageOffset.x,-thick/2+pageOffset.y,0);
        rightUnderside.position.copy(rightPage.position);
        rightPeek.position.set(-w/2+peekOffset.x,-thick/2+peekOffset.y,0);
        host.dataset.bookPhase = closing ? pageTurn ? "rewinding" : "closing" : selected === "book" ? "inspecting" : "shelf";
        if (closing && !pageTurn && opening === 0) {
          const returning = closing.returning; closing = null; locked = false; latest.current.onTurning(false);
          if (returning) { select(null); locked = true; }
          // First-spread textures are pinned: reset while the cover is fully
          // shut, synchronously, so even an immediate reopen cannot flash.
          textureRequest++;
          const firstLeft=textureCache.get('0:true'),firstRight=textureCache.get('1:false');
          if(firstLeft&&firstRight){assignMap(leftMaterial,firstLeft);assignMap(rightMaterial,firstRight);needsPaint=true;}
        }
        let distance = 0;
        for (const item of items) {
          if(recordReturn&&item.id===recordReturn.id){
            const t=Math.min(1,(now-recordReturn.start)/550),ease=(v:number)=>{const n=Math.max(0,Math.min(1,v));return n*n*(3-2*n);};
            const approach=item.origin.clone().add(new T.Vector3(-.32,0,0));
            if(t<.7){const u=ease(t/.7);item.group.position.copy(recordReturn.position).lerp(approach,u);item.group.position.z+=.025*Math.sin(Math.PI*u);item.group.quaternion.copy(recordReturn.quaternion).slerp(item.rest,u);}
            else{item.group.position.copy(approach).lerp(item.origin,ease((t-.7)/.3));item.group.quaternion.copy(item.rest);}
            item.group.scale.setScalar(recordReturn.scale+(1-recordReturn.scale)*ease(Math.min(1,t/.7)));needsPaint=true;host.dataset.vinylReturn=String(t);
            if(t===1){recordReturn=null;host.dataset.vinylReturn='';}else distance=1;
            continue;
          }
          const chosen = selected !== null && selected === item.id;
          const fit = item.id === 'book' ? mobileBookFit : mobileFit;
          const scale = chosen ? item.id === 'book'
            ? fit ? shelfInspectionScale(fit, w*(1+opening)*1.1, h*1.08, 1.7) : 1.7
            : fit ? shelfInspectionScale(fit, .37, .285, 1) : 1 : 1;
          // The open spread is centred on its binding, not the original right
          // board's centre. Scale this offset with the fitted page geometry.
          const centre = inspection.clone().addScaledVector(cameraRight, chosen && fit ? fit.x : 0).addScaledVector(cameraUp, chosen && fit ? fit.y : 0);
          const target = chosen ? item.id === "book" && closing ? closing.position : centre.addScaledVector(cameraRight, item.id === "book" ? opening * w * scale / 2 : 0) : item.origin.clone().add(new T.Vector3(hover !== null && item.id === hover && selected === null ? -model.hoverTravel : 0, 0, 0));
          const q = chosen ? item.id === "book" ? frontPose : turned : item.rest;
          item.group.position.lerp(target, alpha); item.group.quaternion.slerp(q, alpha); item.group.scale.lerp(new T.Vector3(scale, scale, scale), alpha);
          distance = Math.max(distance, item.group.position.distanceTo(target), item.group.quaternion.angleTo(q), Math.abs(item.group.scale.x - scale));
          if (distance < .00001) { item.group.position.copy(target); item.group.quaternion.copy(q); item.group.scale.setScalar(scale); }
        }
        if (pageTurn) {
          needsPaint = true;
          const t = Math.min(1, (now - pageTurn.start) / (pageTurn.duration ?? 900));
          turnHinge.rotation.z=0;
          deformTurn(t,pageTurn.initialCurl,pageTurn.direction);
          if (t === 1) {
            spread=pageTurn.spread;pageTurn=null;
            const l=textureCache.get(`${spread*2}:true`),r=textureCache.get(`${spread*2+1}:false`);
            if(l)assignMap(leftMaterial,l);if(r)assignMap(rightMaterial,r);
            turnHinge.visible=false;leftCurl=0;rightCurl=0;deform(leftPage.geometry,0);deform(rightPage.geometry,0);
            host.dataset.bookSpread=String(spread);latest.current.onSpread(spread);trimTextures();
            if(journey&&spread!==journey.target)void prepareTurn(spread+Math.sign(journey.target-spread),journey.duration);
            else if(!closing){journey=null;locked=false;void preparePeeks();latest.current.onTurning(false);}
          }
        }
        const leftTarget = open && !pageTurn && !locked && leftPeekReady && corner === -1 && nextBookSpread(spread, -1) !== spread ? 1 : 0;
        const rightTarget = open && !pageTurn && !locked && rightPeekReady && corner === 1 && nextBookSpread(spread, 1) !== spread ? 1 : 0;
        const curlMoving = Math.abs(leftCurl - leftTarget) + Math.abs(rightCurl - rightTarget) > .0001;
        if ((curlMoving || needsPaint) && !(locked && !pageTurn && !closing)) {
          leftCurl += (leftTarget - leftCurl) * alpha; rightCurl += (rightTarget - rightCurl) * alpha;
          if (Math.abs(leftCurl - leftTarget) < .0001) leftCurl = leftTarget;
          if (Math.abs(rightCurl - rightTarget) < .0001) rightCurl = rightTarget;
          deform(leftPage.geometry, leftCurl, -1); deform(rightPage.geometry, rightCurl);
        }
        leftPage.visible = true;
        rightPage.visible = true;
        if (settleResolve && distance < .00001 && opening === 0 && !closing && selected === null) { const done = settleResolve; settleResolve = null; if (unlockAfterReturn) locked = false; renderer.render(scene, camera); done(); }
        if (selected === "book" && open) {
          book.updateMatrixWorld(true);
          const project = (x: number) => { const v = new T.Vector3(x, -thick / 2 - .002, -h / 2).applyMatrix4(book.matrixWorld).project(camera); return { x: (v.x + 1) * 50, y: (1 - v.y) * 50 }; };
          const corners = { left: project(-w * 1.5), right: project(w / 2) }, key = JSON.stringify(corners);
          if (lastCorners !== key) { lastCorners = key; latest.current.onCorners(corners); }
        }
        const layoutVisible=selected==='book'&&opening===1&&!pageTurn&&!closing&&!locked&&distance<.00001;
        const boxFor=(mesh: InstanceType<typeof T.Mesh>):PageBox=>{mesh.updateWorldMatrix(true,false);const points=[0,rest.length/3-1,32,24*33].map(i=>new T.Vector3(rest[i*3],rest[i*3+1],rest[i*3+2]).applyMatrix4(mesh.matrixWorld).project(camera));const xs=points.map(v=>(v.x+1)*50),ys=points.map(v=>(1-v.y)*50);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};};
        const layout={left:boxFor(leftPage),right:boxFor(rightPage),visible:layoutVisible};
        const layoutKey=JSON.stringify(layout);if(host.dataset.layout!==layoutKey){host.dataset.layout=layoutKey;latest.current.onLayout(layout);}
        const moving = distance > .00001 || Math.abs(opening - (open ? 1 : 0)) > .00001 || curlMoving;
        // Resting shelf views do not continuously submit identical GPU frames.
        if (!document.hidden && (needsPaint || moving || wasMoving)) { renderer.render(scene, camera); needsPaint = false; }
        publishCueTargets(now,!moving&&!locked&&!galleryMoving);
        wasMoving = moving; raf = requestAnimationFrame(render);
      }
      if(report)await preparePeeks();
      renderer.render(scene, camera); latest.current.onReady(); raf = requestAnimationFrame(render);
      destroy = () => {
        latest.current.onCueTargets?.({});
        playback?.stop();films?.dispose();player?.dispose();
        gallery?.dispose();
        active = false; cancelAnimationFrame(raf); resize.disconnect(); document.removeEventListener("visibilitychange", visibility); latest.current.controls.current = null; settleResolve?.();
        window.removeEventListener('resize', viewportResize);window.visualViewport?.removeEventListener('resize', viewportResize);window.visualViewport?.removeEventListener('scroll', viewportResize);
        // Include the book resources even on the two cubbies where it is not drawn.
        const objects = new Set<InstanceType<typeof T.Object3D>>(); scene.traverse(o => objects.add(o)); book.traverse(o => objects.add(o));
        objects.forEach(o => { const mesh = o as InstanceType<typeof T.Mesh>; mesh.geometry?.dispose(); if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose(); });
        textures.flat().forEach(t => t.dispose()); renderer.dispose(); canvas.remove();
        textureCache.forEach(t=>t.dispose());
        coverTexture.dispose();
      };
      if (cancelled) destroy();
    }
    void initialize().catch(() => { if (!cancelled) latest.current.onFailed(); });
    return () => { cancelled = true; destroy(); };
  }, [props.cubby,props.coherentPhotos,props.coherentBooks,props.mobileLayout]);
  return <div ref={mount} className="vinyl-canvas" />;
}

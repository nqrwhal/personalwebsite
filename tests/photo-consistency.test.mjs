import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const exports={};
vm.runInNewContext(ts.transpileModule(read('app/components/panHandoff.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({})});

test('corrected photo media is opt-in and leaves all approved default paths intact',()=>{
  const approved=exports.getShelfPlates(),preview=exports.getShelfPlates(true);
  assert.equal(approved[2].still,'/room/v154/photos-still.webp');
  assert.equal(approved[2].background,'/room/v152/photos-background.webp');
  assert.equal(preview[2].still,'/room/v159/photos-still.webp');
  assert.equal(preview[2].background,'/room/v159/photos-background.webp');
  assert.equal(preview[0],approved[0]);assert.equal(preview[1],approved[1]);
  for(const [from,to] of [[1,2],[2,1]]){
    assert.equal(exports.shelfTravelClip(from,to),`/room/v155/shelf-${from}-${to}.mp4`);
    assert.equal(exports.shelfTravelClip(from,to,true),`/room/v159/shelf-${from}-${to}.mp4`);
  }
  for(const [from,to] of [[1,0],[0,1]])assert.equal(exports.shelfTravelClip(from,to,true),`/room/v155/shelf-${from}-${to}.mp4`);
});

test('photo staging propagates matching media through direct pans, posters, and WebGL preparation',()=>{
  const room=read('app/components/CinematicRoom.tsx'),shelf=read('app/components/BookshelfExperience.tsx'),scene=read('app/components/ShelfScene.tsx');
  assert.match(read('app/review/photo-consistency/page.tsx'),/<CinematicRoom coherentPhotos shelfReview \/>/);
  assert.match(room,/coherentPhotos = false/);
  assert.match(room,/photosMedia=coherentPhotos\?PHOTO_CONSISTENCY_MEDIA:PHOTOS_MEDIA/);
  assert.match(room,/\$\{photosMedia\}photos-still.webp/);
  assert.match(room,/photos: photosMedia/);
  assert.match(room,/src=\{sceneTransitionSrc\(phase, media\)\}/);
  const cache=read('app/components/sceneTransitionCache.ts');
  assert.match(cache,/phase\.startsWith\('photos'\)/);
  assert.match(cache,/\$\{media\.photos\}\$\{phase\}\.mp4/);
  assert.match(room,/<VinylShelf[^>]*coherentPhotos=\{coherentPhotos\}/);
  assert.match(shelf,/getShelfPlates\(coherentPhotos,coherentBooks\)/);
  assert.match(shelf,/shelfTravelClip\(travel.from,travel.to,coherentPhotos,coherentBooks\)/);
  assert.match(shelf,/<ShelfScene review=\{review\} coherentPhotos=\{coherentPhotos\}/);
  assert.match(scene,/getShelfPlates\(props.coherentPhotos,props.coherentBooks\)\[props.cubby\].background/);
  assert.match(read('app/components/shelfPolaroids.ts'),/fetch\('\/review\/v154\/photos.json'\)/);
  assert.match(read('app/page.tsx'),/<CinematicRoom coherentPhotos coherentBooks mobileLayout activityCues refinedCues cueFadeIn \/>/);
  assert.match(room,/shelfReview = false/);
  assert.match(room,/review=\{shelfReview\}/);
  assert.doesNotMatch(room,/review=\{coherentPhotos\}/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const exports={};
vm.runInNewContext(ts.transpileModule(read('app/components/panHandoff.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({})});

test('corrected top cubby plates are independently opt-in and preserve adjacent approved media',()=>{
  const current=exports.getShelfPlates(true),preview=exports.getShelfPlates(true,true);
  assert.equal(current[0].still,'/room/v149/books-still.webp');
  assert.equal(preview[0].still,'/room/v160/books-still.webp');
  assert.equal(preview[0].background,'/room/v160/books-background.webp');
  assert.equal(preview[1],current[1]);assert.equal(preview[2],current[2]);
  assert.equal(preview,exports.getShelfPlates(true,true),'stable plate arrays avoid restarting asset preload effects');
  for(const [from,to] of [[1,0],[0,1]]){
    assert.equal(exports.shelfTravelClip(from,to,true),`/room/v155/shelf-${from}-${to}.mp4`);
    assert.equal(exports.shelfTravelClip(from,to,true,true),`/room/v160/shelf-${from}-${to}.mp4`);
  }
  for(const [from,to] of [[1,2],[2,1]])assert.equal(exports.shelfTravelClip(from,to,true,true),`/room/v159/shelf-${from}-${to}.mp4`);
});

test('top cubby rerender uses corrected scene and preserves authored camera timing',()=>{
  const script=read('blender/render_book_consistency_v160.py');
  assert.match(script,/v156-restored-playback\.blend/);
  assert.match(script,/CAM_BooksApproach_v150/);
  assert.match(script,/for i in range\(73\)/);
  assert.match(script,/\(97 if reverse else 1\)\+i/);
  assert.match(script,/\('BOOK_Mid_9','CATHODE_WIREFRAME_BOOK_Mid_9'\)/);
  assert.doesNotMatch(script,/save_as_mainfile|save_mainfile/);
  assert.match(read('app/components/ShelfScene.tsx'),/getShelfPlates\(props.coherentPhotos,props.coherentBooks\)/);
});

test('approved corrected books media is promoted without review redirect suppression',()=>{
  const room=read('app/components/CinematicRoom.tsx'),shelf=read('app/components/BookshelfExperience.tsx');
  assert.match(room,/coherentBooks = false/);
  assert.match(room,/booksMedia=coherentBooks\?BOOK_CONSISTENCY_MEDIA:BOOKS_MEDIA/);
  assert.match(room,/books: booksMedia/);
  assert.match(room,/src=\{sceneTransitionSrc\(phase, media\)\}/);
  const cache=read('app/components/sceneTransitionCache.ts');
  assert.match(cache,/phase\.startsWith\('books'\)/);
  assert.match(cache,/\$\{media\.books\}\$\{phase\}\.mp4/);
  assert.match(shelf,/getShelfPlates\(coherentPhotos,coherentBooks\)/);
  assert.match(shelf,/shelfTravelClip\(travel.from,travel.to,coherentPhotos,coherentBooks\)/);
  assert.match(shelf,/<ShelfScene review=\{review\} coherentPhotos=\{coherentPhotos\} coherentBooks=\{coherentBooks\}/);
  assert.match(read('app/review/activity-cues/page.tsx'),/<CinematicRoom coherentPhotos coherentBooks shelfReview/);
  assert.match(read('app/page.tsx'),/coherentBooks/);
  assert.doesNotMatch(read('app/page.tsx'),/shelfReview/);
});

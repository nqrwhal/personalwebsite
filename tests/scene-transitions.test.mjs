import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function loadCache(matchCoarse = true) {
  const videos = [];
  const document = {
    getElementById: () => null,
    body: { appendChild() {} },
    createElement(tag) {
      const listeners = {};
      const node = {
        tag,
        muted: false,
        playsInline: false,
        preload: '',
        src: '',
        readyState: 0,
        paused: true,
        currentTime: 0,
        tabIndex: 0,
        style: {},
        loads: 0,
        listeners,
        setAttribute() {},
        appendChild() {},
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
        load() { this.loads += 1; },
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
      };
      if (tag === 'video') videos.push(node);
      return node;
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read('app/components/sceneTransitionCache.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require: () => ({ BOOK_CONSISTENCY_MEDIA: '/room/v160/', PHOTO_CONSISTENCY_MEDIA: '/room/v159/' }),
    document,
    matchMedia: () => ({ matches: matchCoarse }),
  });
  return { exports, videos };
}

test('camera moves keep the folder that matches each scene', () => {
  const { exports } = loadCache();
  const media = exports.sceneMedia(true, true);
  assert.equal(exports.sceneTransitionSrc('approach', media), '/room/v149/monitor-in.mp4');
  assert.equal(exports.sceneTransitionSrc('return', media), '/room/v149/monitor-out.mp4');
  assert.equal(exports.sceneTransitionSrc('vinyl-in', media), '/room/v155/vinyl-in.mp4');
  assert.equal(exports.sceneTransitionSrc('vinyl-out', media), '/room/v155/vinyl-out.mp4');
  assert.equal(exports.sceneTransitionSrc('books-in', media), '/room/v160/books-in.mp4');
  assert.equal(exports.sceneTransitionSrc('photos-out', media), '/room/v159/photos-out.mp4');
  assert.equal(exports.sceneTransitionSrc('diploma-in', media), '/room/v149/diploma-in.mp4');
  assert.equal(exports.shelfExitSrc(0, true, true), '/room/v160/books-out.mp4');
  assert.equal(exports.shelfExitSrc(1, true, true), '/room/v155/vinyl-out.mp4');
  assert.equal(exports.shelfExitSrc(2, false, false), '/room/v154/photos-out.mp4');
});

test('background priming stays queued, and a pointer prime does not wait', () => {
  const { exports, videos } = loadCache(true);
  exports.setScenePrimeSuspended(true);
  exports.primeSceneClip('/room/v149/monitor-in.mp4');
  assert.equal(videos[0].loads, 0);
  exports.setScenePrimeSuspended(false);
  assert.equal(videos[0].loads, 1);
  exports.primeSceneClip('/room/v155/vinyl-in.mp4');
  assert.equal(videos[1].loads, 0, 'a phone buffers one extra clip at a time');
  videos[0].listeners.loadeddata.forEach(fn => fn());
  assert.equal(videos[1].loads, 1);
  exports.primeSceneClip('/room/v160/books-in.mp4', true);
  assert.equal(videos[2].loads, 1);
});

test('scene clicks prime the matching clip and overlap the destination with the movie', () => {
  const room = read('app/components/CinematicRoom.tsx');
  const shelf = read('app/components/BookshelfExperience.tsx');
  assert.match(room, /src=\{sceneTransitionSrc\(phase, media\)\}/);
  assert.match(room, /onPointerDown=\{\(\) => arm\("approach"\)\}/);
  assert.match(room, /onPointerDown=\{\(\) => arm\("vinyl-in"\)\}/);
  assert.match(room, /onPointerDown=\{\(\) => arm\("books-in"\)\}/);
  assert.match(room, /onPointerDown=\{\(\) => arm\("photos-in"\)\}/);
  assert.match(room, /onPointerDown=\{\(\) => arm\("diploma-in"\)\}/);
  assert.match(room, /phase === "approach" && transitionVisible/);
  assert.match(room, /inboundShelf && transitionVisible/);
  assert.match(room, /preparing=\{inboundShelf && transitionVisible\}/);
  assert.match(room, /responsiveLayout\?'\/review\/responsive-desktop':mobileLayout&&shelfReview\?'\/review\/mobile-desktop':'\/desktop'/);
  assert.match(shelf, /is-preparing/);
  assert.match(shelf, /primeSceneClip\(shelfTravelClip/);
  assert.match(shelf, /shelfExitSrc\(cubby/);
  assert.match(read('app/components/cinematicRoom.css'), /\.cinematic-approach \.cinematic-desktop \{ opacity: 0/);
  assert.match(read('app/components/vinylShelf.css'), /\.vinyl-experience\.is-preparing \{ opacity: 0/);
});

test('portrait review shares one frame across the movie and the landing scene', () => {
  const css = read('app/components/mobileRoom.css');
  const review = read('app/review/responsive/page.tsx');
  assert.match(review, /responsiveLayout/);
  assert.match(review, /shelfReview/);
  assert.doesNotMatch(read('app/page.tsx'), /responsiveLayout/);
  assert.match(css, /@media \(orientation: portrait\) and \(max-width: 1024px\)/);
  assert.match(css, /data-responsive="true"\]\[data-viewport-fit="cover"\] :is\(\.cinematic-stage, \.cinematic-handoff, \.vinyl-render-stage\)/);
  assert.match(css, /width: min\(100vw, 177\.777777778dvh\)/);
  assert.doesNotMatch(css, /data-responsive="true"\] \.cinematic-controls nav button/);
  assert.doesNotMatch(css, /data-responsive="true"\] \.shelf-arrow-up/);
  const guard = read('app/components/LandscapeGuard.tsx');
  assert.ok(guard.includes('review\\/responsive'));
  assert.ok(guard.includes('(?:-desktop)?'));
  assert.ok(guard.includes('setPortrait(false)'));
  assert.match(read('app/review/responsive-desktop/page.tsx'), /responsiveLayout/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const room = read('app/components/CinematicRoom.tsx');
const shelf = read('app/components/BookshelfExperience.tsx');
const css = read('app/components/mobileRoom.css');

test('approved mobile room layout is enabled without preview-only redirect suppression', () => {
  assert.match(room, /mobileLayout = false/);
  assert.match(shelf, /mobileLayout=false/);
  assert.match(read('app/review/mobile-layout/page.tsx'), /<CinematicRoom coherentPhotos shelfReview mobileLayout \/>/);
  const home = read('app/page.tsx');
  assert.match(home, /return <CinematicRoom coherentPhotos coherentBooks mobileLayout activityCues refinedCues cueFadeIn \/>;/);
  assert.doesNotMatch(home, /shelfReview|mobile-desktop/);
  assert.match(room, /data-mobile-layout=\{mobileLayout\}/);
  assert.match(room, /<VinylShelf[^>]*mobileLayout=\{mobileLayout\}/);
  assert.match(shelf, /<ShelfScene[^>]*mobileLayout=\{mobileLayout\}/);
  assert.match(room, /responsiveLayout\?'\/review\/responsive-desktop':mobileLayout&&shelfReview\?'\/review\/mobile-desktop':'\/desktop'/);
});

test('phone controls use the right side and leave room around inspected objects', () => {
  assert.match(css, /@media\(max-width:1024px\) and \(max-height:600px\)/);
  assert.match(css, /\[data-mobile-layout="true"\] \.cinematic-controls nav\{[^}]*top:50%[^}]*flex-direction:column/);
  assert.match(css, /\[data-mobile-layout="true"\] \.report-navigation\{[^}]*top:50%[^}]*flex-direction:column/);
  assert.match(css, /\.vinyl-experience\[data-mobile-layout="true"\] \.vinyl-project-controls\{left:94px;right:68px/);
  assert.match(css, /env\(safe-area-inset-right\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height:36px/);
});

test('shared UI cleanup is review gated rather than changing production prematurely', () => {
  assert.match(shelf, /mobileLayout\?'Play record':'Play record ↗'/);
  assert.match(shelf, /<p role="status" className=\{mobileLayout\?'cinematic-sr':undefined\}/);
  assert.match(room, /mobileLayout\?'cinematic-sr':'cinematic-shelf-loading'/);
});

test('diploma enlargement works at both review desktop and phone sizes', () => {
  const diploma = read('app/components/DiplomaEnlargement.tsx');
  assert.match(room, /mobileLayout&&<DiplomaEnlargement \/>/);
  assert.match(diploma, /aria-label="Enlarge diploma"/);
  assert.match(diploma, /dialog\.current\?\.showModal\(\)/);
  assert.match(diploma, /onCancel=\{event=>\{event.preventDefault\(\);close\(\);\}\}/);
  assert.match(diploma, /trigger\.current\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(diploma, /event.target===event.currentTarget\)close\(\)/);
  assert.match(diploma, /src="\/room\/diploma-art.png"/);
  assert.ok(existsSync(new URL('../public/room/diploma-art.png', import.meta.url)));
  assert.ok(css.indexOf('.diploma-enlarge-target{') < css.indexOf('@media'), 'desktop diploma target is not phone-only');
  assert.match(css, /\.diploma-lightbox img\{[^}]*object-fit:contain!important/);
  assert.match(css, /max-height:calc\(100dvh - 64px\)/);
});

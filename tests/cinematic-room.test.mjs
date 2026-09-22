import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const source = readFileSync(new URL('../app/components/CinematicRoom.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('room shortcuts sit at the top right while the name stays bottom left', () => {
  const css = readFileSync(new URL('../app/components/cinematicRoom.css', import.meta.url), 'utf8');
  assert.match(css, /\.cinematic-controls nav \{ position: absolute; top: 20px; right: 28px;/);
  assert.match(css, /\.cinematic-controls > span \{ position: absolute; bottom: 28px; left: 28px;/);
  assert.match(css, /\.cinematic-controls nav \{ top: 16px; left: 16px; right: 16px;[^}]*flex-wrap: wrap; justify-content: flex-end;/);
});
test('home uses prerecorded room, without importing a 3D runtime', () => {
  assert.match(home, /CinematicRoom/);
  assert.doesNotMatch(home + source, /import.*(?:three|VinylPortfolio)/);
});
test('desktop and transition assets are conditional, not initial downloads', () => {
  assert.match(source, /showDesktop &&/);
  assert.match(source, /traveling &&/);
  assert.match(source, /responsiveLayout\?'\/review\/responsive-desktop':mobileLayout&&shelfReview\?'\/review\/mobile-desktop':'\/desktop'/);
  assert.match(source, /phase === "boot" && bootFinished && desktopLoaded/);
});
test('motion preferences, hidden-page pause, keyboard controls and failures are handled', () => {
  for (const value of ['prefers-reduced-motion', 'visibilitychange', 'idle.current?.pause()', 'Skip animation', 'Open desktop directly', 'onError=', 'restoreFocus']) {
    assert.ok(source.includes(value), value);
  }
  assert.match(source, /10000/);
});
test('all shipped room media are present and stay within release budgets', () => {
  assert.match(source, /const MEDIA = "\/room\/v149\/"/);
  for (const name of ['greeting.webp', 'idle.mp4', 'monitor-in.mp4', 'monitor-out.mp4', 'vinyl-in.mp4', 'vinyl-out.mp4', 'diploma-in.mp4', 'diploma-out.mp4', 'diploma.webp', 'vinyl-still.webp', 'vinyl-background.webp']) {
    const path = new URL(`../public/room/v149/${name}`, import.meta.url);
    assert.ok(existsSync(path), name);
    assert.ok(statSync(path).size < 6_000_000, `${name} exceeds 6 MB budget`);
  }
});

test('rounded monitor clips share the white highlight revision with all room media', () => {
  assert.match(source, /const MONITOR_MEDIA = "\/room\/v149\/"/);
  assert.match(source, /sceneTransitionSrc\(phase, media\)/);
  const clips = readFileSync(new URL('../app/components/sceneTransitionCache.ts', import.meta.url), 'utf8');
  assert.match(clips, /phase\.startsWith\('vinyl'\)/);
  assert.match(clips, /monitor-in\.mp4/);
  for (const name of ['monitor-in.mp4', 'monitor-out.mp4']) {
    const path = new URL(`../public/room/v149/${name}`, import.meta.url);
    assert.ok(existsSync(path), name);
    assert.ok(statSync(path).size < 6_000_000, `${name} exceeds 6 MB budget`);
  }
});

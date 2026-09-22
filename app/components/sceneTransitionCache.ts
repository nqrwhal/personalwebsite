import { BOOK_CONSISTENCY_MEDIA, PHOTO_CONSISTENCY_MEDIA } from './panHandoff';

export type SceneMedia = { room: string; monitor: string; shelf: string; books: string; photos: string };

const ROOM_MEDIA = '/room/v149/';
const SHELF_MEDIA = '/room/v155/';
const BOOKS_MEDIA = '/room/v150/';
const PHOTOS_MEDIA = '/room/v154/';

export function sceneMedia(coherentPhotos = false, coherentBooks = false): SceneMedia {
  return {
    room: ROOM_MEDIA,
    monitor: ROOM_MEDIA,
    shelf: SHELF_MEDIA,
    books: coherentBooks ? BOOK_CONSISTENCY_MEDIA : BOOKS_MEDIA,
    photos: coherentPhotos ? PHOTO_CONSISTENCY_MEDIA : PHOTOS_MEDIA,
  };
}

/** Same files the room assigns to each camera move. */
export function sceneTransitionSrc(phase: string, media: SceneMedia) {
  if (phase.startsWith('photos')) return `${media.photos}${phase}.mp4`;
  if (phase.startsWith('books')) return `${media.books}${phase}.mp4`;
  if (phase.startsWith('diploma')) return `${media.room}${phase}.mp4`;
  if (phase.startsWith('vinyl')) return `${media.shelf}${phase}.mp4`;
  if (phase === 'approach') return `${media.monitor}monitor-in.mp4`;
  if (phase === 'return') return `${media.monitor}monitor-out.mp4`;
  return '';
}

export function shelfExitSrc(cubby: number, coherentPhotos = false, coherentBooks = false) {
  const phase = cubby === 0 ? 'books-out' : cubby === 2 ? 'photos-out' : 'vinyl-out';
  return sceneTransitionSrc(phase, sceneMedia(coherentPhotos, coherentBooks));
}

const clips = new Map<string, HTMLVideoElement>();
const waiting: string[] = [];
let loading = 0;
let suspended = false;

function primeLimit() {
  try {
    return matchMedia('(pointer: coarse), (max-width: 800px)').matches ? 1 : 2;
  } catch {
    return 2;
  }
}

function host() {
  const existing = document.getElementById('scene-clip-cache');
  if (existing) return existing;
  const node = document.createElement('div');
  node.id = 'scene-clip-cache';
  node.setAttribute('aria-hidden', 'true');
  node.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.appendChild(node);
  return node;
}

function ensure(src: string) {
  const current = clips.get(src);
  if (current) return current;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  video.tabIndex = -1;
  host().appendChild(video);
  clips.set(src, video);
  return video;
}

function pump() {
  const limit = primeLimit();
  if (suspended) return;
  while (loading < limit && waiting.length) {
    const src = waiting.shift()!;
    const video = clips.get(src);
    if (!video || video.readyState >= 2) continue;
    loading += 1;
    const finish = () => {
      loading = Math.max(0, loading - 1);
      video.removeEventListener('loadeddata', finish);
      video.removeEventListener('error', finish);
      pump();
    };
    video.addEventListener('loadeddata', finish);
    video.addEventListener('error', finish);
    video.load();
  }
}

export function setScenePrimeSuspended(value: boolean) {
  suspended = value;
  if (!value) pump();
}

export function pauseSceneClips() {
  for (const video of clips.values()) if (!video.paused) video.pause();
}

/** Buffer a camera move before the click. Urgent primes decode on the pointer gesture. */
export function primeSceneClip(src: string, urgent = false) {
  if (!src || typeof document === 'undefined') return;
  const video = ensure(src);
  if (urgent) {
    const index = waiting.indexOf(src);
    if (index >= 0) waiting.splice(index, 1);
    const nudge = () => {
      const played = video.play();
      if (!played) return;
      void played.then(() => {
        video.pause();
        if (video.currentTime > 0) video.currentTime = 0;
      }).catch(() => {});
    };
    if (video.readyState >= 2) nudge();
    else video.addEventListener('loadeddata', nudge, { once: true });
    if (video.readyState < 2) video.load();
    return;
  }
  if (video.readyState >= 2 || waiting.includes(src)) return;
  waiting.push(src);
  pump();
}

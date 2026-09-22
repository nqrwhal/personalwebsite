/** Fit inspection objects inside the *visible* part of the cover-sized stage.
 * The authored camera, background and resting shelf geometry never change. */
export const SHELF_MOBILE_QUERY = '(max-width: 1024px) and (max-height: 600px)';
export const SHELF_PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 1024px)';
export type ShelfRect = { left: number; top: number; width: number; height: number };
export type ShelfFit = { width: number; height: number; x: number; y: number };
export function visibleShelfFit(stage: ShelfRect, viewport: ShelfRect, fov: number, aspect: number,
  margins = { left: 24, right: 24, top: 14, bottom: 54 }, distance = 1.2): ShelfFit {
  const worldHeight = 2 * distance * Math.tan(fov * Math.PI / 360);
  const worldWidth = worldHeight * aspect;
  const left = Math.max(stage.left, viewport.left) + margins.left;
  const right = Math.min(stage.left + stage.width, viewport.left + viewport.width) - margins.right;
  const top = Math.max(stage.top, viewport.top) + margins.top;
  const bottom = Math.min(stage.top + stage.height, viewport.top + viewport.height) - margins.bottom;
  return {
    width: Math.max(1, right - left) / stage.width * worldWidth,
    height: Math.max(1, bottom - top) / stage.height * worldHeight,
    x: ((left + right) / 2 - stage.left - stage.width / 2) / stage.width * worldWidth,
    y: (stage.top + stage.height / 2 - (top + bottom) / 2) / stage.height * worldHeight,
  };
}
export function shelfInspectionScale(fit: ShelfFit, width: number, height: number, maximum: number) {
  return Math.min(maximum, fit.width / width, fit.height / height);
}

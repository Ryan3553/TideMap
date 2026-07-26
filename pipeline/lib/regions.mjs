// Geographic regions used by the validation stage.
//
// HARBOUR is a hand-drawn polygon whose SEAWARD edge follows the outer coast of
// the Matakana Island barrier / Mount Maunganui / Papamoa, and whose landward
// edge is deliberately generous (it runs out to the frame edges). Only the
// seaward edge needs precision: the polygon is always intersected with the
// water classes, so surplus land on the inland side costs nothing. Rendered as
// preview-harbour-region.png so the choice is auditable.
import { BBOX, SIZE } from './config.mjs';

export const HARBOUR = [
  [175.940, -37.428],  // Waihi Beach, seaward
  [175.998, -37.480],  // Bowentown Heads (harbour entrance)
  [176.058, -37.565],  // outer Matakana Island
  [176.128, -37.628],
  [176.190, -37.668],  // seaward of the Tauranga entrance
  [176.250, -37.702],  // seaward of Mount Maunganui
  [176.290, -37.760],  // Papamoa coast
  [176.290, -37.790],  // -> frame edge, then generous inland closure
  [175.930, -37.790],
  [175.930, -37.470],
];

/** Named sub-regions for the failure map: [name, west, south, east, north] */
export const PLACES = [
  ['Bowentown entrance',       175.960, -37.510, 176.020, -37.462],
  ['Katikati / northern basin', 175.945, -37.590, 176.045, -37.505],
  ['Matakana Island banks',    176.000, -37.660, 176.120, -37.575],
  ['Omokoroa',                 176.020, -37.665, 176.090, -37.615],
  ['Tauranga entrance / Mount',176.150, -37.680, 176.210, -37.620],
  ['Waikareao arm',            176.130, -37.702, 176.170, -37.672],
  ['Waimapu arm',              176.145, -37.735, 176.185, -37.700],
  ['Rangataua / Welcome Bay',  176.180, -37.750, 176.240, -37.705],
];

export const lonOf = (x) => BBOX.w + ((x + 0.5) / SIZE) * (BBOX.e - BBOX.w);
export const latOf = (y) => BBOX.n - ((y + 0.5) / SIZE) * (BBOX.n - BBOX.s);
export const xOf = (lon) => Math.round(((lon - BBOX.w) / (BBOX.e - BBOX.w)) * SIZE);
export const yOf = (lat) => Math.round(((BBOX.n - lat) / (BBOX.n - BBOX.s)) * SIZE);

/** Ground area of one pixel, km^2 (pixels are not square — see the sidecar). */
export function pixelAreaKm2() {
  const latMid = (BBOX.n + BBOX.s) / 2;
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.320 * Math.cos(latMid * Math.PI / 180);
  const w = ((BBOX.e - BBOX.w) * kmPerDegLon) / SIZE;
  const h = ((BBOX.n - BBOX.s) * kmPerDegLat) / SIZE;
  return w * h;
}

export function pointInPolygon(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Uint8Array mask of pixels inside the harbour polygon. */
export function harbourMask() {
  const m = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const lat = latOf(y);
    for (let x = 0; x < SIZE; x++) {
      if (pointInPolygon(lonOf(x), lat, HARBOUR)) m[y * SIZE + x] = 1;
    }
  }
  return m;
}

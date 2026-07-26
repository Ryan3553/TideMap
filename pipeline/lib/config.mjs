// Master grid + pipeline constants. Every stage imports from here so the
// grid registration is identical across scenes — the whole waterline method
// depends on exact pixel correspondence between scenes.

export const BBOX = { w: 175.93, s: -37.79, e: 176.37, n: -37.41 };

export const TILE = 1300;     // titiler.xyz rejects requests > ~1400 px/side
export const GRID = 2;        // 2x2 tiles
export const SIZE = TILE * GRID;   // 2600 x 2600
export const NPIX = SIZE * SIZE;   // 6,760,000

export const STAC_SEARCH = 'https://earth-search.aws.element84.com/v1/search';
export const STAC_ITEM = (id) =>
  `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${id}`;

export const TILE_ID = '60HVD';
export const DATE_RANGE = '2015-01-01T00:00:00Z/2026-07-20T00:00:00Z';
export const MAX_CLOUD = 20;   // superset; the cloud<5% subset is evaluated separately in 3v-cloud-experiment.mjs
export const MAX_NODATA = 5;

// Tidal-lag model. The water level over the flats lags the open-sea tide, and
// freshly exposed flats stay saturated; both shift the apparent waterline the
// same way. The lag grows with the distance the tidal wave has travelled up
// the channels from the sea:
//     tau(pixel) = TAU0_MIN + LAG_SLOPE_MIN_PER_KM * alongChannelKm(pixel)
// Both parameters are chosen by the grid search in 3s-spatial-lag.mjs and
// confirmed by a nested split-half. TIDE_LAG_MIN is the round-2 uniform-lag
// value, kept for the scene labelling in 1-scenes.mjs and as the pass-1 seed.
export const TIDE_LAG_MIN = 80;
export const TAU0_MIN = 40;
export const LAG_SLOPE_MIN_PER_KM = 4;

// Drying-height encoding for the 16-bit PNG.
export const H_MIN = 0.0;
export const H_MAX = 2.5;
export const SUBTIDAL = 0;        // always wet
export const SUPRATIDAL = 65535;  // always dry
// height -> uint16:  round(1 + (h - H_MIN)/(H_MAX - H_MIN) * 65533)
// so intertidal codes occupy 1..65534 and never collide with the sentinels.
export const encodeHeight = (h) =>
  Math.max(1, Math.min(65534, Math.round(1 + ((h - H_MIN) / (H_MAX - H_MIN)) * 65533)));
export const decodeHeight = (v) => H_MIN + ((v - 1) / 65533) * (H_MAX - H_MIN);

// class raster values
export const CLS_SUBTIDAL = 0;
export const CLS_INTERTIDAL = 128;
export const CLS_SUPRATIDAL = 255;
// 4th value, documented in the sidecar: pixel has too few valid observations
// to fit (titiler returns alpha=0 where NDWI is undefined, e.g. green+nir == 0
// over deep dark water, plus scene-edge nodata strips).
export const CLS_NODATA = 64;
export const MIN_VALID_SCENES = 10;

import { fileURLToPath } from 'url';
export const dirs = {
  cache: fileURLToPath(new URL('../cache/', import.meta.url)),
  out: fileURLToPath(new URL('../out/', import.meta.url)),
};

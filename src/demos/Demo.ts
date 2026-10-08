import type { Engine } from '../app/Engine';
import type { OrbitController } from '../app/OrbitController';

/** Everything a demo can use: the whole {@link Engine} plus the demo camera controller and the page's URL parameters. */
export type DemoContext = Engine & {
  /** Mouse orbit camera driving the camera entity. */
  orbit: OrbitController;
  /** The page's query string (demos read options such as `?n=20000`). */
  params: URLSearchParams;
};

/** A demo sets up its scene and returns a per-frame update callback `(time, dt)`. */
export type Demo = (ctx: DemoContext) => ((t: number, dt: number) => void) | void;

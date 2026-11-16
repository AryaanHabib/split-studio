// Set (environment) presets: named anchors and physics colliders.
// Shared by the compiler (for path planning and physics bakes) and the
// runtime (which builds the visuals in runtime/sets.ts).
import type { Vec3 } from './types';

export interface Collider {
  kind: 'box' | 'sphere' | 'torus';
  pos: Vec3;
  size: Vec3; // box half-extents | sphere [r,0,0] | torus [R, r, 0]
  restitution?: number;
  friction?: number;
  name?: string;
}

export interface SetDef {
  id: string;
  description: string;
  anchors: Record<string, Vec3>;
  colliders: Collider[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  lighting: string[];
}

const RIM_Y = 3.05;
const HOOP_Z = -12.6;

export const SETS: Record<string, SetDef> = {
  court: {
    id: 'court',
    description: 'Indoor basketball arena: full court, one active hoop at -Z end, bleachers with spectators.',
    anchors: {
      hoop: [0, RIM_Y, HOOP_Z],
      rim: [0, RIM_Y, HOOP_Z],
      backboard: [0, 3.4, -13.3],
      center: [0, 0, 0],
      freeThrow: [0, 0, -8.4],
      threePoint: [0, 0, -5.4],
      leftWing: [-5, 0, -9],
      rightWing: [5, 0, -9],
      halfway: [0, 0, 0],
      baseline: [0, 0, -13.5],
      farEnd: [0, 0, 12],
      refSpot: [6.8, 0, -4],
      bench: [7.6, 0, 2],
    },
    colliders: [
      { kind: 'box', pos: [0, -0.5, 0], size: [20, 0.5, 20], restitution: 0.78, friction: 0.6, name: 'floor' },
      { kind: 'box', pos: [0, 3.4, -13.38], size: [0.9, 0.53, 0.03], restitution: 0.55, name: 'backboard' },
      { kind: 'torus', pos: [0, RIM_Y, HOOP_Z], size: [0.23, 0.012, 0], restitution: 0.5, name: 'rim' },
      { kind: 'box', pos: [0, 4, -16], size: [20, 8, 0.5], name: 'wallN' },
      { kind: 'box', pos: [0, 4, 16], size: [20, 8, 0.5], name: 'wallS' },
      { kind: 'box', pos: [10.5, 4, 0], size: [0.5, 8, 20], name: 'wallE' },
      { kind: 'box', pos: [-10.5, 4, 0], size: [0.5, 8, 20], name: 'wallW' },
    ],
    bounds: { minX: -9.5, maxX: 9.5, minZ: -15, maxZ: 15 },
    lighting: ['arena', 'arena-dim', 'spotlight'],
  },
  apartment: {
    id: 'apartment',
    description: 'Small apartment (day or night lighting): living room with sofa, side table, landline phone, window with city lights, hallway door.',
    anchors: {
      center: [0, 0, 0],
      sofa: [0, 0, -2.2],
      phone: [1.55, 0.62, -2.15],
      window: [-2.9, 1.4, -0.5],
      door: [2.95, 0, 1.2],
      hallway: [3.8, 0, 1.2],
      lamp: [-1.6, 0, -2.4],
      kitchen: [-2, 0, 2.2],
    },
    colliders: [
      { kind: 'box', pos: [0, -0.5, 0], size: [8, 0.5, 8], restitution: 0.3, friction: 0.8, name: 'floor' },
      { kind: 'box', pos: [0, 0.22, -2.3], size: [1.1, 0.22, 0.42], name: 'sofa' },
    ],
    bounds: { minX: -2.8, maxX: 2.8, minZ: -2.6, maxZ: 2.8 },
    lighting: ['day', 'night', 'lamp', 'blackout'],
  },
  city: {
    id: 'city',
    description: 'Daytime city intersection: two crossing 4-lane roads, sidewalks, street lamps, trees, parked cars, a skyline of background towers. Collapsible buildings are added per scene as "structures".',
    anchors: {
      center: [0, 0, 0], cornerNE: [9, 0, -9], cornerNW: [-9, 0, -9], cornerSE: [9, 0, 9], cornerSW: [-9, 0, 9],
      sidewalkN: [0, 0, -7.5], sidewalkS: [0, 0, 7.5], sidewalkE: [7.5, 0, 0], sidewalkW: [-7.5, 0, 0], crosswalk: [0, 0, 5.2],
    },
    colliders: [
      { kind: 'box', pos: [0, -0.5, 0], size: [80, 0.5, 80], restitution: 0.15, friction: 0.9, name: 'ground' },
    ],
    bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
    lighting: ['day', 'dusk'],
  },
  lab: {
    id: 'lab',
    description: 'Bright test chamber / laboratory with gridded walls, a control desk, a big gravity dial on the wall and loose props.',
    anchors: {
      center: [0, 0, 0],
      desk: [0, 0, -3],
      dial: [0, 3.2, -4.9],
      door: [4.5, 0, 0],
      corner: [-4, 0, -4],
    },
    colliders: [
      { kind: 'box', pos: [0, -0.5, 0], size: [10, 0.5, 10], restitution: 0.35, friction: 0.7, name: 'floor' },
      { kind: 'box', pos: [0, 6.5, 0], size: [10, 0.5, 10], restitution: 0.35, name: 'ceiling' },
      { kind: 'box', pos: [0, 3, -5.5], size: [10, 6, 0.5], name: 'wallN' },
      { kind: 'box', pos: [0, 3, 5.5], size: [10, 6, 0.5], name: 'wallS' },
      { kind: 'box', pos: [5.5, 3, 0], size: [0.5, 6, 10], name: 'wallE' },
      { kind: 'box', pos: [-5.5, 3, 0], size: [0.5, 6, 10], name: 'wallW' },
      { kind: 'box', pos: [0, 0.45, -3], size: [1.2, 0.45, 0.5], name: 'desk' },
    ],
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    lighting: ['lab', 'lab-alarm'],
  },
};

export function anchor(setId: string, name: string): Vec3 | undefined {
  return SETS[setId]?.anchors[name];
}

import type { PuppetLook } from '../shared/types';

const base = { skin: '#e8b48f', shirt: '#4a7bd0', pants: '#2f3542', shoes: '#222222', hair: 'short', hairColor: '#3b2a1f', outfit: 'tee', accessory: 'none', headShape: 'round' as const, eyeSize: 1 };

export const ARCHETYPE_DEFAULTS: Record<string, PuppetLook> = {
  adult: { archetype: 'adult', height: 1.8, headScale: 1, bodyWidth: 1, limb: 1, ...base },
  athlete: { archetype: 'athlete', height: 2.05, headScale: 0.92, bodyWidth: 1.08, limb: 1.05, ...base, outfit: 'jersey' },
  giant: { archetype: 'giant', height: 2.6, headScale: 0.9, bodyWidth: 1.2, limb: 1.2, ...base },
  toddler: { archetype: 'toddler', height: 0.86, headScale: 2.05, bodyWidth: 1.35, limb: 1.55, ...base, outfit: 'onesie', hair: 'tuft', eyeSize: 1.3, shoes: '#f4f1ea' },
  child: { archetype: 'child', height: 1.25, headScale: 1.5, bodyWidth: 1.05, limb: 1.1, ...base, eyeSize: 1.15 },
  elder: { archetype: 'elder', height: 1.68, headScale: 1.05, bodyWidth: 1.05, limb: 0.95, ...base, hairColor: '#d8d8d8' },
  stocky: { archetype: 'stocky', height: 1.72, headScale: 1.05, bodyWidth: 1.35, limb: 1.25, ...base },
};

/** Approximate physical half-extents of a puppet (for physics bodies and clinging offsets). */
export function dimsFor(look: PuppetLook | undefined, height: number) {
  if (!look) return { halfW: 0.25 * height / 1.8, halfD: 0.15 * height / 1.8 };
  const toddler = height < 1.3;
  const SW = height * (toddler ? 0.15 : 0.125) * look.bodyWidth;
  return { halfW: SW * 1.05, halfD: SW * (toddler ? 0.75 : 0.6) };
}

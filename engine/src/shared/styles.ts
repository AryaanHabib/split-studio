// Visual style presets — independent of story, set and characters.
// A video picks one by name ("style") and may override fields with "grade".
export interface StyleDef {
  description: string;
  exposure?: number;
  saturate?: number; // 1 = unchanged
  contrast?: number;
  brightness?: number;
  vignette?: number;
  tint?: string; // soft-light colour wash
  tintAmount?: number;
  grain?: number; // 0..1
  materials?: 'standard' | 'toon' | 'flat';
  fog?: { color: string; near: number; far: number };
  shadowSoftness?: number;
  letterbox?: number; // fraction of height per bar
}

export const STYLES: Record<string, StyleDef> = {
  'bright-cartoon': { description: 'Clean, saturated, readable. Comedy, sports, absurd scenarios.', exposure: 1.0, saturate: 1.08, contrast: 1.03, vignette: 0.28 },
  toon: { description: 'Cel-shaded materials with stepped lighting. Kids-cartoon feel.', exposure: 1.05, saturate: 1.15, contrast: 1.05, vignette: 0.15, materials: 'toon' },
  horror: { description: 'Desaturated, cold, deep shadows but readable faces, heavy vignette and film grain. Mystery, horror, dread.', exposure: 1.25, saturate: 0.6, contrast: 1.12, brightness: 1.05, vignette: 0.55, tint: '#1f3550', tintAmount: 0.3, grain: 0.6, fog: { color: '#05070b', near: 7, far: 20 } },
  noir: { description: 'Black and white, hard contrast, grain.', exposure: 0.95, saturate: 0, contrast: 1.35, vignette: 0.6, grain: 0.8 },
  documentary: { description: 'Neutral and natural. Experiments, explainers, simulations.', exposure: 1.0, saturate: 0.95, contrast: 1.0, vignette: 0.18 },
  'disaster-epic': { description: 'Warm, dusty, high contrast with atmospheric haze. Destruction, scale, spectacle.', exposure: 1.05, saturate: 0.9, contrast: 1.15, vignette: 0.45, tint: '#c27a3a', tintAmount: 0.22, grain: 0.25, letterbox: 0.0 },
  dreamy: { description: 'Soft pastel wash, low contrast. Surreal or whimsical.', exposure: 1.1, saturate: 1.15, contrast: 0.92, vignette: 0.25, tint: '#ffc6e8', tintAmount: 0.25 },
  flat: { description: 'Unlit flat colours, graphic look.', exposure: 1.0, saturate: 1.1, vignette: 0.0, materials: 'flat' },
};

export function resolveStyle(name: string | undefined, overrides: Record<string, any> = {}): StyleDef {
  return { ...(STYLES[name ?? 'bright-cartoon'] ?? STYLES['bright-cartoon']), ...overrides };
}

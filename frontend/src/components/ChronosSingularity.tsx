'use client';

/**
 * ChronosSingularity — A localised distortion in spacetime.
 *
 * Not an orb. Not a blob. Not a mascot.
 * A miniature collapse of the temporal manifold.
 *
 * Inspired by Dormammu's dark dimension, Interstellar's Gargantua,
 * and experimental physics HUD aesthetics.
 *
 * Key exports:
 *  - ChronosSingularity       — hero canvas component (use on /blob)
 *  - MiniSingularity          — compact version for cards / dashboards
 *  - singularityPhaseEmitter  — singleton EventTarget to broadcast phase
 *    changes globally so ParticleBackground can react.
 */

import { useEffect, useRef, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────────────────
   PUBLIC TYPES
───────────────────────────────────────────────────────────────────── */
export type SingularityPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

/* ─────────────────────────────────────────────────────────────────────
   GLOBAL PHASE EMITTER
   Any component can listen: singularityPhaseEmitter.addEventListener(...)
───────────────────────────────────────────────────────────────────── */
export const singularityPhaseEmitter: EventTarget =
  typeof window !== 'undefined' ? new EventTarget() : ({} as EventTarget);

export function emitSingularityPhase(phase: SingularityPhase) {
  singularityPhaseEmitter.dispatchEvent(
    Object.assign(new Event('phase'), { phase })
  );
}

/* ─────────────────────────────────────────────────────────────────────
   MATH UTILS
───────────────────────────────────────────────────────────────────── */
const TAU  = Math.PI * 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

type RGB = [number, number, number];
const lerpRGB = (a: RGB, b: RGB, k: number): RGB =>
  [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const rgba = (c: RGB, a: number) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.min(1, Math.max(0, a))})`;

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/* ─────────────────────────────────────────────────────────────────────
   PHASE PALETTE — Full RGB for GPU-smooth cross-fades
───────────────────────────────────────────────────────────────────── */
interface Palette {
  a1: RGB; a2: RGB; a3: RGB; core: RGB;
  hex1: string; hex2: string;
  pSpeed: number;   // particle orbit speed multiplier
  rAct: number;     // ring activity 0–1
  breathHz: number; // breath oscillation frequency
  pulseHz: number;  // glow pulse rate (0 = none)
  coreSize: number; // core radius fraction of R
}

const PALETTES: Record<SingularityPhase, Palette> = {
  idle: {
    a1:  [0, 190, 255], a2: [60, 60, 220], a3: [180, 230, 255],
    core:[190, 230, 255],
    hex1:'#00BEFF', hex2:'#3C3CDC',
    pSpeed:0.28, rAct:0.18, breathHz:0.30, pulseHz:0, coreSize:0.088,
  },
  listening: {
    a1:  [0, 225, 255], a2: [20, 100, 255], a3: [140, 245, 255],
    core:[210, 248, 255],
    hex1:'#00E1FF', hex2:'#1464FF',
    pSpeed:0.70, rAct:0.62, breathHz:0.95, pulseHz:0.50, coreSize:0.095,
  },
  thinking: {
    a1:  [0, 255, 130], a2: [10, 180, 60], a3: [160, 255, 190],
    core:[200, 255, 215],
    hex1:'#00FF82', hex2:'#0AB43C',
    pSpeed:1.60, rAct:1.0, breathHz:2.10, pulseHz:0, coreSize:0.078,
  },
  speaking: {
    a1:  [0, 195, 240], a2: [90, 50, 215], a3: [130, 230, 255],
    core:[200, 240, 255],
    hex1:'#00C3F0', hex2:'#5A32D7',
    pSpeed:1.05, rAct:0.74, breathHz:1.65, pulseHz:1.70, coreSize:0.092,
  },
};

/* ─────────────────────────────────────────────────────────────────────
   RING SYSTEM — broken arc segments, never forming full circles
───────────────────────────────────────────────────────────────────── */
interface Seg {
  sa: number; ea: number;     // start/end angle
  w: number;                  // stroke width
  op: number;                 // opacity
  glow: number;               // glow multiplier
  rOff: number;               // radial displacement (fragment offset)
  aD: number;                 // angular drift rate
  cB: number;                 // colour bias 0=a1 1=a2
}
interface Ring {
  rF: number;     // radius factor (multiplied by R)
  segs: Seg[];
  rSpd: number;   // rotation speed
  tX: number; tY: number; // scale axes for ellipse projection
  rOff: number;   // rotation offset (random phase)
  layer: 'i'|'m'|'o';
}

function buildRings(): Ring[] {
  // [rF, rSpd, tX, tY, breakFactor, seed, layer]
  const defs: [number,number,number,number,number,number,string][] = [
    [0.26, +0.028, 0.12, 0.98, 0.82, 9001, 'i'],
    [0.38, -0.019, 0.93, 0.18, 0.58, 9002, 'i'],
    [0.52, +0.014, 0.28, 0.90, 0.65, 9003, 'm'],
    [0.68, -0.022, 0.88, 0.35, 0.44, 9004, 'm'],
    [0.85, +0.010, 0.22, 0.95, 0.52, 9005, 'm'],
    [1.04, -0.016, 0.85, 0.48, 0.38, 9006, 'o'],
    [1.24, +0.007, 0.16, 0.97, 0.62, 9007, 'o'],
    [1.46, -0.011, 0.74, 0.60, 0.75, 9008, 'o'],
    [1.70, +0.005, 0.92, 0.32, 0.85, 9009, 'o'],
  ];

  return defs.map(([rF, rSpd, tX, tY, brk, seed, layer]) => {
    const rng = seededRng(seed);
    const segs: Seg[] = [];
    let a = rng() * TAU;
    while (a < TAU) {
      const arc = (0.10 + rng() * 0.55) * (1 - brk * 0.42);
      const gap = (0.03 + rng() * 0.35) * (1 + brk * 0.80);
      if (a + arc < TAU + 0.15)
        segs.push({
          sa: a, ea: Math.min(a + arc, TAU),
          w:   0.4 + rng() * 2.6,
          op:  0.18 + rng() * 0.62,
          glow:0.15 + rng() * 0.85,
          rOff:(rng() - 0.5) * 12,
          aD:  (rng() - 0.5) * 0.006,
          cB:  rng(),
        });
      a += arc + gap;
    }
    return { rF: rF as number, segs, rSpd: rSpd as number, tX: tX as number, tY: tY as number, rOff: seededRng(seed + 1)() * TAU, layer: layer as 'i'|'m'|'o' };
  });
}

/* ─────────────────────────────────────────────────────────────────────
   PARTICLE — orbital debris around the singularity
───────────────────────────────────────────────────────────────────── */
interface Pt {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; sz: number;
  oR: number; oA: number; oSpd: number;
  type: 0|1|2|3;   // 0=dust 1=debris 2=spark 3=thread
  cB: number;
  tx: number[]; ty: number[]; // trail
}

function mkParticle(cx: number, cy: number, phase: SingularityPhase, R: number): Pt {
  const p = PALETTES[phase];
  const oR = R * (0.14 + Math.random() * 1.85);
  const oA = Math.random() * TAU;
  const oSpd = (0.0015 + Math.random() * 0.010) * p.pSpeed * (Math.random() < 0.5 ? 1 : -1);
  const roll = Math.random();
  const type = (roll < 0.42 ? 0 : roll < 0.70 ? 1 : roll < 0.87 ? 2 : 3) as 0|1|2|3;
  return {
    x: cx + Math.cos(oA) * oR, y: cy + Math.sin(oA) * oR,
    vx: 0, vy: 0,
    life: 0, maxLife: 90 + Math.random() * 380,
    sz: type === 2 ? 0.4 + Math.random() * 1.1
      : type === 3 ? 0.25 + Math.random() * 0.6
      : type === 1 ? 1.0 + Math.random() * 3.0
      : 0.25 + Math.random() * 0.75,
    oR, oA, oSpd, type, cB: Math.random(), tx: [], ty: [],
  };
}

/* ─────────────────────────────────────────────────────────────────────
   GLOW PULSE — expanding radial bloom (NOT a circle stroke)
───────────────────────────────────────────────────────────────────── */
interface Pulse { r: number; maxR: number; life: number; maxLife: number; peakA: number; col: RGB; }

/* ─────────────────────────────────────────────────────────────────────
   LIGHTNING ARC — jagged energy discharge (thinking state)
───────────────────────────────────────────────────────────────────── */
interface Arc { pts: {x:number;y:number}[]; life: number; maxLife: number; col: RGB; w: number; }

function mkArc(cx: number, cy: number, R: number, pal: Palette): Arc {
  const a1 = Math.random() * TAU, a2 = a1 + 0.4 * Math.PI + Math.random() * 1.2 * Math.PI;
  const r1 = R * (0.22 + Math.random() * 0.85), r2 = R * (0.22 + Math.random() * 0.85);
  const sx = cx + Math.cos(a1) * r1, sy = cy + Math.sin(a1) * r1;
  const ex = cx + Math.cos(a2) * r2, ey = cy + Math.sin(a2) * r2;
  const n = 8 + Math.floor(Math.random() * 7);
  const pts: {x:number;y:number}[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = lerp(sx, ex, t), py = lerp(sy, ey, t);
    const perp = Math.atan2(ey - sy, ex - sx) + Math.PI / 2;
    const j = (Math.random() - 0.5) * R * 0.20 * (1 - Math.abs(t - 0.5) * 2);
    pts.push({ x: px + Math.cos(perp) * j, y: py + Math.sin(perp) * j });
  }
  return { pts, life: 0, maxLife: 10 + Math.floor(Math.random() * 16), col: pal.a3, w: 0.4 + Math.random() * 1.4 };
}

/* ─────────────────────────────────────────────────────────────────────
   RUNE GEOMETRY — sacred polygon vertices for thinking state
───────────────────────────────────────────────────────────────────── */
function rune(n: number, r: number, cx: number, cy: number, aOff: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU + aOff;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

/* ─────────────────────────────────────────────────────────────────────
   LISSAJOUS DISTORTION FIELD — the "impossible object" feel
   Traces a figure-8 field around the singularity
───────────────────────────────────────────────────────────────────── */
function drawDistortionField(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number,
  t: number, a1: RGB, blend: number,
) {
  const steps = 400;

  // Inner forcefield circle (centered and tight)
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * TAU;
    const baseR = R * 0.42;
    const wave = Math.sin(u * 8 - t * 3.5) * R * 0.04;
    const fx = cx + Math.cos(u) * (baseR + wave);
    const fy = cy + Math.sin(u) * (baseR + wave);
    i === 0 ? ctx.moveTo(fx, fy) : ctx.lineTo(fx, fy);
  }
  ctx.strokeStyle = rgba(a1, 0.12 * blend);
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Outer forcefield circle (centered and tight)
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * TAU;
    const baseR = R * 0.62;
    const wave = Math.cos(u * 6 + t * 2.8) * R * 0.03;
    const fx = cx + Math.cos(u) * (baseR + wave);
    const fy = cy + Math.sin(u) * (baseR + wave);
    i === 0 ? ctx.moveTo(fx, fy) : ctx.lineTo(fx, fy);
  }
  ctx.strokeStyle = rgba(a1, 0.08 * blend);
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/* ─────────────────────────────────────────────────────────────────────
   MASTER DRAW
───────────────────────────────────────────────────────────────────── */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  cx: number, cy: number,
  t: number,
  phase: SingularityPhase,
  blend: number,
  R: number,
  la1: RGB, la2: RGB, la3: RGB, lcore: RGB,
  rings: Ring[],
  particles: Pt[],
  pulses: Pulse[],
  arcs: Arc[],
) {
  const pal = PALETTES[phase];

  /* ── 1. OUTER VOLUMETRIC NEBULA (3 overlapping halos) ─────────── */
  // Primary — breathing, off-centre
  {
    const ox = Math.sin(t * 0.09) * R * 0.14, oy = Math.cos(t * 0.07) * R * 0.11;
    const hr = R * (3.2 + 0.10 * Math.sin(t * pal.breathHz * 0.4));
    const g = ctx.createRadialGradient(cx + ox, cy + oy, R * 0.04, cx, cy, hr);
    g.addColorStop(0,    rgba(la1, 0.14 * blend));
    g.addColorStop(0.22, rgba(la2, 0.06 * blend));
    g.addColorStop(0.55, rgba(la1, 0.018 * blend));
    g.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, hr, 0, TAU); ctx.fill();
  }
  // Secondary counter-drift
  {
    const ox = Math.cos(t * 0.13 + 2.1) * R * 0.22, oy = Math.sin(t * 0.10 + 0.8) * R * 0.18;
    const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, R * 1.9);
    g.addColorStop(0, rgba(la2, 0.08 * blend));
    g.addColorStop(0.6, rgba(la2, 0.02 * blend));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx + ox, cy + oy, R * 1.9, 0, TAU); ctx.fill();
  }
  // Tertiary — active states only
  if (pal.rAct > 0.5) {
    const ox = Math.sin(t * 0.17 + 3.5) * R * 0.16, oy = Math.cos(t * 0.14 + 1.9) * R * 0.13;
    const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, R * 1.3);
    g.addColorStop(0, rgba(la1, 0.10 * blend * pal.rAct));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx + ox, cy + oy, R * 1.3, 0, TAU); ctx.fill();
  }

  /* ── 2. LISSAJOUS DISTORTION FIELD ────────────────────────────── */
  drawDistortionField(ctx, cx, cy, R, t, la1, blend);

  /* ── 3. GLOW PULSES — radial bloom (listening + speaking) ──────── */
  pulses.forEach(pulse => {
    const prog  = pulse.r / pulse.maxR;
    // Bell-curve envelope: peak near leading edge, rapid falloff
    const env   = Math.pow(Math.sin(Math.PI * Math.min(prog, 1)), 1.4) * (1 - prog * 0.3);
    const alpha = pulse.peakA * env * blend;
    if (alpha < 0.003) return;

    // Inner hot ring glow
    const inner = ctx.createRadialGradient(cx, cy, pulse.r * 0.70, cx, cy, pulse.r * 1.12);
    inner.addColorStop(0,   rgba(pulse.col, 0));
    inner.addColorStop(0.4, rgba(pulse.col, alpha * 0.45));
    inner.addColorStop(0.75,rgba(pulse.col, alpha * 0.80));
    inner.addColorStop(1,   rgba(pulse.col, alpha * 0.20));
    ctx.fillStyle = inner;
    ctx.beginPath(); ctx.arc(cx, cy, pulse.r * 1.12, 0, TAU); ctx.fill();

    // Wide soft outer bloom
    const outer = ctx.createRadialGradient(cx, cy, pulse.r * 0.9, cx, cy, pulse.r * 2.0);
    outer.addColorStop(0,  rgba(pulse.col, alpha * 0.22));
    outer.addColorStop(0.5,rgba(pulse.col, alpha * 0.07));
    outer.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle = outer;
    ctx.beginPath(); ctx.arc(cx, cy, pulse.r * 2.0, 0, TAU); ctx.fill();
  });

  /* ── 4. BROKEN CLOCK RINGS ─────────────────────────────────────── */
  rings.forEach((ring, ri) => {
    const rR      = R * ring.rF;
    const actBoost = lerp(1, 1 + pal.rAct * 1.4, blend);
    const rotT     = t * ring.rSpd * actBoost + ring.rOff;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(ring.tX, ring.tY);

    ring.segs.forEach((seg, si) => {
      const ds = seg.sa + rotT + seg.aD * t * 45;
      const de = seg.ea + rotT + seg.aD * t * 45;

      // Fragment radial displacement — increases with activity
      const energy  = pal.rAct * blend;
      const frag    = seg.rOff * energy * 0.65;

      // Thinking: segments drift further + scatter
      const thinkD = phase === 'thinking'
        ? Math.sin(t * 2.8 + si * 1.8 + ri * 0.95) * R * 0.10 * blend
        : 0;
      // Speaking: pulse radial expansion
      const speakD = phase === 'speaking'
        ? Math.abs(Math.sin(t * 5.8 + si * 0.85 + ri * 1.3)) * R * 0.035 * blend
        : 0;
      const finalR  = rR + frag + thinkD + speakD;

      const col = lerpRGB(la1, la2, seg.cB);
      const segA = seg.op * (0.28 + 0.72 * blend);

      // Primary stroke
      ctx.beginPath(); ctx.arc(0, 0, finalR, ds, de);
      ctx.strokeStyle = rgba(col, segA);
      ctx.lineWidth   = seg.w * (1 + energy * 0.8);
      ctx.globalAlpha = 1; ctx.stroke();

      // Glow pass
      if (seg.glow > 0.40) {
        ctx.beginPath(); ctx.arc(0, 0, finalR, ds, de);
        ctx.strokeStyle = rgba(la1, segA * 0.12 * seg.glow);
        ctx.lineWidth   = seg.w * 6.0; ctx.stroke();
      }

      // Thinking tip sparks at segment endpoints
      if (phase === 'thinking' && blend > 0.35 && seg.glow > 0.55) {
        const tipA = ds + (de - ds) * (Math.sin(t * 2.1 + si) * 0.5 + 0.5);
        ctx.beginPath();
        ctx.arc(Math.cos(tipA) * finalR, Math.sin(tipA) * finalR, 2.0, 0, TAU);
        ctx.fillStyle = rgba(la3, 0.92 * blend); ctx.fill();
      }
    });

    ctx.restore(); ctx.globalAlpha = 1;
  });

  /* ── 5. LIGHTNING ARCS (thinking) ──────────────────────────────── */
  if (phase === 'thinking') {
    arcs.forEach(arc => {
      const lf    = arc.life / arc.maxLife;
      const alpha = (1 - lf) * (0.85 * blend);
      if (alpha < 0.01) return;
      // Primary
      ctx.beginPath();
      arc.pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = rgba(arc.col, alpha);
      ctx.lineWidth = arc.w; ctx.lineJoin = 'round'; ctx.stroke();
      // Bloom
      ctx.beginPath();
      arc.pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = rgba(la1, alpha * 0.35);
      ctx.lineWidth = arc.w * 5; ctx.stroke();
    });
  }

  /* ── 6. THINKING SACRED GEOMETRY ───────────────────────────────── */
  if (phase === 'thinking' && blend > 0.08) {
    const a = blend;

    // Outer nonagram (9-fold) — very slow rotation
    const p9 = rune(9, R * 0.80, cx, cy, t * 0.09);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const j = (i + 4) % 9;
      ctx.moveTo(p9[i].x, p9[i].y); ctx.lineTo(p9[j].x, p9[j].y);
    }
    ctx.strokeStyle = rgba(la1, a * 0.13);
    ctx.lineWidth = 0.6; ctx.stroke();

    // Heptagram (7-fold)
    const p7 = rune(7, R * 0.64, cx, cy, t * 0.16);
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const j = (i + 3) % 7;
      ctx.moveTo(p7[i].x, p7[i].y); ctx.lineTo(p7[j].x, p7[j].y);
    }
    ctx.strokeStyle = rgba(la2, a * 0.20);
    ctx.lineWidth = 0.7; ctx.stroke();

    // Pentagon counter-rotating
    const p5 = rune(5, R * 0.42, cx, cy, -t * 0.25);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const j = (i + 2) % 5;
      ctx.moveTo(p5[i].x, p5[i].y); ctx.lineTo(p5[j].x, p5[j].y);
    }
    ctx.strokeStyle = rgba(la1, a * 0.28);
    ctx.lineWidth = 0.8; ctx.stroke();

    // Fast triangle + counter-triangle (Star of David variant)
    const p3a = rune(3, R * 0.25, cx, cy,  t * 0.60);
    const p3b = rune(3, R * 0.25, cx, cy, -t * 0.60 + Math.PI / 3);
    for (const pts of [p3a, p3b]) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.closePath();
      ctx.strokeStyle = rgba(pts === p3a ? la1 : la2, a * 0.40);
      ctx.lineWidth = 0.9; ctx.stroke();
    }

    // Vertex dots
    [...p9, ...p7, ...p5, ...p3a, ...p3b].forEach(pt => {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.4, 0, TAU);
      ctx.fillStyle = rgba(la3, a * 0.55); ctx.fill();
    });
  }

  /* ── 7. ENERGY SPIRALS (thinking + speaking) ───────────────────── */
  if ((phase === 'thinking' || phase === 'speaking') && blend > 0.05) {
    const nSp    = phase === 'thinking' ? 4 : 2;
    const turns  = phase === 'thinking' ? 5.0 : 3.0;
    const spd    = phase === 'thinking' ? 1.4 : 2.6;
    const maxSR  = R * (phase === 'thinking' ? 0.82 : 0.65);
    const spAlpha = blend * (phase === 'thinking' ? 0.20 : 0.17);

    for (let sp = 0; sp < nSp; sp++) {
      const rotOff = (sp / nSp) * TAU + (sp % 2 === 1 ? Math.PI : 0);
      const col    = lerpRGB(la1, la2, sp / Math.max(nSp - 1, 1));
      ctx.beginPath();
      for (let i = 0; i < 260; i++) {
        const f = i / 260;
        const θ = f * TAU * turns - t * (spd + sp * 0.35) + rotOff;
        const r = f * maxSR;
        const x = cx + Math.cos(θ) * r, y = cy + Math.sin(θ) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(col, spAlpha);
      ctx.lineWidth = 0.8; ctx.stroke();
    }
  }

  /* ── 8. PARTICLES ──────────────────────────────────────────────── */
  ctx.globalCompositeOperation = 'lighter';

  particles.forEach(p => {
    const lf  = p.life / p.maxLife;
    const fi  = Math.min(lf * 5, 1);
    const fo  = 1 - lf * lf;
    const al  = fi * fo;
    if (al < 0.008) return;
    const col = lerpRGB(la1, la2, p.cB);

    if (p.type === 3 && p.tx.length > 1) {
      ctx.beginPath();
      ctx.moveTo(p.tx[0], p.ty[0]);
      for (let i = 1; i < p.tx.length; i++) ctx.lineTo(p.tx[i], p.ty[i]);
      ctx.strokeStyle = rgba(col, al * 0.32);
      ctx.lineWidth = 0.5; ctx.stroke();
    }

    if (p.type === 2) {
      // Spark — cross shape
      const s = p.sz * 3;
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y);
      ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x, p.y + s);
      ctx.strokeStyle = rgba([225, 248, 255] as RGB, al * 0.90);
      ctx.lineWidth = 0.6; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, TAU);
      ctx.fillStyle = p.type === 1 ? rgba(col, al * 0.75) : rgba(la1, al * 0.42);
      ctx.fill();
    }
  });

  ctx.globalCompositeOperation = 'source-over';

  /* ── 9. ACCRETION DISK & DARK LENSING ZONE ────────────────────── */
  {
    const cR = R * (pal.coreSize + 0.012 * Math.sin(t * pal.breathHz));
    const accR = cR * 3.2;

    // Schwarzschild-radius-style dark zone — opaque near core, fades
    const dark = ctx.createRadialGradient(cx, cy, cR * 0.35, cx, cy, accR * 2.5);
    dark.addColorStop(0,    'rgba(0,0,0,0.97)');
    dark.addColorStop(0.22, 'rgba(0,0,0,0.78)');
    dark.addColorStop(0.50, 'rgba(0,0,8,0.28)');
    dark.addColorStop(0.78, 'rgba(0,0,4,0.07)');
    dark.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(cx, cy, accR * 2.5, 0, TAU); ctx.fill();

    // Photon sphere — intense narrow band at ~1.5× Schwarzschild radius
    const photR = cR * 2.6;
    const photRng = phase === 'thinking'
      ? photR * (1 + 0.08 * Math.abs(Math.sin(t * 3.5)))
      : photR;
    const photG = ctx.createRadialGradient(cx, cy, photRng * 0.85, cx, cy, photRng * 1.35);
    photG.addColorStop(0,   rgba(la1, 0));
    photG.addColorStop(0.4, rgba(la1, 0.22 * blend));
    photG.addColorStop(0.7, rgba(la1, 0.38 * blend));
    photG.addColorStop(1,   rgba(la1, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = photG;
    ctx.beginPath(); ctx.arc(cx, cy, photRng * 1.35, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Thinking — green corona flicker
    if (phase === 'thinking') {
      const coronaR = cR * (2.0 + 0.5 * Math.abs(Math.sin(t * 4.2)));
      const coronaG = ctx.createRadialGradient(cx, cy, cR * 1.2, cx, cy, coronaR * 1.6);
      coronaG.addColorStop(0, rgba(la1, 0.42 * blend));
      coronaG.addColorStop(0.5, rgba(la1, 0.14 * blend));
      coronaG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = coronaG;
      ctx.beginPath(); ctx.arc(cx, cy, coronaR * 1.6, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // Singularity point — tiny, impossibly bright
    const sg = ctx.createRadialGradient(cx - cR * 0.28, cy - cR * 0.28, 0, cx, cy, cR);
    sg.addColorStop(0,   '#ffffff');
    sg.addColorStop(0.4, rgba(lcore, 1));
    sg.addColorStop(0.85,rgba(la1, 0.55));
    sg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(cx, cy, cR, 0, TAU); ctx.fill();
  }

  /* ── 10. LISTENING — inward compression beams ──────────────────── */
  if (phase === 'listening' && blend > 0.08) {
    for (let i = 0; i < 16; i++) {
      const bA   = (i / 16) * TAU;
      const prog = ((t * 1.1 + i * 0.52) % 2.8) / 2.8;
      const r1   = R * (0.14 + prog * 1.6);
      const r2   = r1 + R * 0.28;
      const al   = (1 - prog) * 0.22 * blend;
      if (al < 0.01) continue;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(bA) * r1, cy + Math.sin(bA) * r1);
      ctx.lineTo(cx + Math.cos(bA) * r2, cy + Math.sin(bA) * r2);
      ctx.strokeStyle = rgba(la1, al); ctx.lineWidth = 0.9; ctx.stroke();
    }
  }

  /* ── 11. SPEAKING — radial spike field ─────────────────────────── */
  if (phase === 'speaking' && blend > 0.08) {
    const cR = R * pal.coreSize;
    for (let i = 0; i < 36; i++) {
      const sA  = (i / 36) * TAU + t * 0.18;
      const mA  = Math.abs(Math.sin(t * 8.0 + i * 0.88 + Math.cos(t * 3.5 + i * 0.44)));
      const mB  = Math.abs(Math.sin(t * 13 - i * 0.66));
      const amp = (0.015 + 0.18 * mA * mB) * blend;
      const r1  = cR * 2.2;
      const r2  = R * (0.11 + amp);
      const al  = (0.18 + 0.82 * mA) * blend;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sA) * r1, cy + Math.sin(sA) * r1);
      ctx.lineTo(cx + Math.cos(sA) * r2, cy + Math.sin(sA) * r2);
      ctx.strokeStyle = i % 3 === 2
        ? rgba(la2, al * 0.75) : rgba(la1, al * 0.88);
      ctx.lineWidth = 0.65 + mA * 0.85; ctx.stroke();
    }
  }

  /* ── 12. IDLE — slow orbital mote + hexagonal lattice ──────────── */
  if (phase === 'idle') {
    const hexR = R * 1.52;
    for (let i = 0; i < 6; i++) {
      const a1 = (i / 6) * TAU + t * 0.038;
      const a2 = ((i + 1) / 6) * TAU + t * 0.038;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a1) * hexR, cy + Math.sin(a1) * hexR);
      ctx.lineTo(cx + Math.cos(a2) * hexR, cy + Math.sin(a2) * hexR);
      ctx.strokeStyle = rgba(la1, 0.055 * blend); ctx.lineWidth = 0.5; ctx.stroke();
    }
    const mA = t * 0.19;
    const mx = cx + Math.cos(mA) * R * 1.62;
    const my = cy + Math.sin(mA) * R * 0.38;
    const mal = (0.35 + 0.65 * Math.sin(t * 1.15)) * blend;
    ctx.beginPath(); ctx.arc(mx, my, 2.2, 0, TAU);
    ctx.fillStyle = rgba(lcore, mal); ctx.fill();
  }

  /* ── 13. HUD SCAN LINE ──────────────────────────────────────────── */
  {
    const band = R * 3.6;
    const sy = cy - R * 1.8 + ((t * 22) % band);
    const sg = ctx.createLinearGradient(cx - R * 1.8, sy, cx + R * 1.8, sy);
    sg.addColorStop(0,   'rgba(0,0,0,0)');
    sg.addColorStop(0.3, rgba(la1, 0.018));
    sg.addColorStop(0.7, rgba(la1, 0.018));
    sg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(cx - R * 1.8, sy - 0.5, R * 3.6, 1);
  }
}

/* ─────────────────────────────────────────────────────────────────────
   ANIMATION ENGINE — shared between full + mini renderers
───────────────────────────────────────────────────────────────────── */
interface EngineState {
  t: number;
  blend: number;
  la1: RGB; la2: RGB; la3: RGB; lcore: RGB;
  particles: Pt[];
  pulses: Pulse[];
  arcs: Arc[];
  nextPulseT: number;
  nextArcT: number;
}

function createEngine(initPhase: SingularityPhase): EngineState {
  const p = PALETTES[initPhase];
  return {
    t: 0, blend: 0,
    la1: [...p.a1] as RGB, la2: [...p.a2] as RGB,
    la3: [...p.a3] as RGB, lcore: [...p.core] as RGB,
    particles: [], pulses: [], arcs: [],
    nextPulseT: 0, nextArcT: 0,
  };
}

function stepEngine(
  eng: EngineState, cx: number, cy: number, R: number,
  phase: SingularityPhase, phaseChanged: boolean,
) {
  eng.t += 0.012;
  const pal = PALETTES[phase];

  if (phaseChanged) eng.blend = 0;
  eng.blend = lerp(eng.blend, 1, 0.036);

  const K = 0.042;
  eng.la1   = lerpRGB(eng.la1,   pal.a1,   K);
  eng.la2   = lerpRGB(eng.la2,   pal.a2,   K);
  eng.la3   = lerpRGB(eng.la3,   pal.a3,   K);
  eng.lcore = lerpRGB(eng.lcore, pal.core, K);

  // Particle target count
  const target = phase === 'thinking' ? 110
    : phase === 'speaking'  ? 85
    : phase === 'listening' ? 68
    : 32;

  while (eng.particles.length < target)
    eng.particles.push(mkParticle(cx, cy, phase, R));

  for (let i = eng.particles.length - 1; i >= 0; i--) {
    const p = eng.particles[i];
    p.life++;
    p.oA += p.oSpd * pal.pSpeed;
    const tR = p.oR * (1 + 0.06 * Math.sin(eng.t * 1.6 + p.oA));
    const dx = cx + Math.cos(p.oA) * tR - p.x;
    const dy = cy + Math.sin(p.oA) * tR - p.y;
    p.vx = p.vx * 0.88 + dx * 0.12;
    p.vy = p.vy * 0.88 + dy * 0.12;
    p.x += p.vx * 0.06;
    p.y += p.vy * 0.06;
    if (p.type === 3) {
      p.tx.push(p.x); p.ty.push(p.y);
      if (p.tx.length > 8) { p.tx.shift(); p.ty.shift(); }
    }
    if (p.life > p.maxLife || eng.particles.length > target + 8)
      eng.particles.splice(i, 1);
  }

  // Glow pulses
  if (pal.pulseHz > 0 && eng.t > eng.nextPulseT) {
    eng.pulses.push({
      r: R * 0.10, maxR: R * (phase === 'speaking' ? 2.1 : 2.7),
      life: 0, maxLife: 150,
      peakA: phase === 'speaking' ? 0.60 : 0.44,
      col: [...pal.a1] as RGB,
    });
    eng.nextPulseT = eng.t + 1 / pal.pulseHz;
  }
  for (let i = eng.pulses.length - 1; i >= 0; i--) {
    eng.pulses[i].r += phase === 'speaking' ? 2.4 : 1.5;
    eng.pulses[i].life++;
    if (eng.pulses[i].r > eng.pulses[i].maxR) eng.pulses.splice(i, 1);
  }

  // Arcs
  if (phase === 'thinking' && eng.t > eng.nextArcT) {
    eng.arcs.push(mkArc(cx, cy, R, pal));
    eng.nextArcT = eng.t + 0.06 + Math.random() * 0.22;
  }
  for (let i = eng.arcs.length - 1; i >= 0; i--) {
    eng.arcs[i].life++;
    if (eng.arcs[i].life > eng.arcs[i].maxLife) eng.arcs.splice(i, 1);
  }
}

/* ─────────────────────────────────────────────────────────────────────
   PUBLIC COMPONENT: ChronosSingularity (hero, 480 px default)
───────────────────────────────────────────────────────────────────── */
export interface ChronosSingularityProps {
  phase: SingularityPhase;
  size?: number;
  /** If true, emits phase changes to singularityPhaseEmitter */
  broadcastPhase?: boolean;
}

export function ChronosSingularity({ phase, size = 480, broadcastPhase = true }: ChronosSingularityProps) {
  const cvs      = useRef<HTMLCanvasElement>(null);
  const phRef    = useRef<SingularityPhase>(phase);
  const prevPhRef = useRef<SingularityPhase>(phase);

  useEffect(() => {
    phRef.current = phase;
    if (broadcastPhase) emitSingularityPhase(phase);
  }, [phase, broadcastPhase]);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2;
    const R  = size * 0.22;
    const rings = buildRings();
    const eng = createEngine(phRef.current);

    let id: number;
    const frame = () => {
      const ph = phRef.current;
      const changed = ph !== prevPhRef.current;
      prevPhRef.current = ph;
      stepEngine(eng, cx, cy, R, ph, changed);
      ctx.clearRect(0, 0, size, size);
      drawFrame(ctx, size, size, cx, cy, eng.t, ph, eng.blend, R,
                eng.la1, eng.la2, eng.la3, eng.lcore,
                rings, eng.particles, eng.pulses, eng.arcs);
      id = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(id);
  }, [size]);

  return <canvas ref={cvs} style={{ display: 'block', pointerEvents: 'none' }} />;
}

/* ─────────────────────────────────────────────────────────────────────
   PUBLIC COMPONENT: MiniSingularity (compact, 96 px default)
───────────────────────────────────────────────────────────────────── */
export function MiniSingularity({ phase, size = 96 }: { phase: SingularityPhase; size?: number }) {
  const cvs   = useRef<HTMLCanvasElement>(null);
  const phRef = useRef<SingularityPhase>(phase);
  const prevPhRef = useRef<SingularityPhase>(phase);
  useEffect(() => { phRef.current = phase; }, [phase]);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    canvas.width = canvas.height = size;
    const cx = size / 2, cy = size / 2, R = size * 0.23;
    const rings = buildRings();
    const eng = createEngine(phRef.current);
    eng.blend = 1; // mini starts fully blended
    let id: number;

    const frame = () => {
      const ph = phRef.current;
      const changed = ph !== prevPhRef.current;
      prevPhRef.current = ph;
      stepEngine(eng, cx, cy, R, ph, changed);
      ctx.clearRect(0, 0, size, size);
      drawFrame(ctx, size, size, cx, cy, eng.t, ph, eng.blend, R,
                eng.la1, eng.la2, eng.la3, eng.lcore,
                rings, eng.particles, eng.pulses, eng.arcs);
      id = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(id);
  }, [size]);

  return <canvas ref={cvs} width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }} />;
}

/* ─────────────────────────────────────────────────────────────────────
   HOOK: useSingularityPhase
   Subscribe to phase changes from the global emitter.
───────────────────────────────────────────────────────────────────── */
export function useSingularityPhase(cb: (phase: SingularityPhase) => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    const handler = (e: Event) => {
      cbRef.current((e as Event & { phase: SingularityPhase }).phase);
    };
    singularityPhaseEmitter.addEventListener('phase', handler);
    return () => singularityPhaseEmitter.removeEventListener('phase', handler);
  }, []);
}

/* ─────────────────────────────────────────────────────────────────────
   PALETTE ACCESSOR (for UI elements like badges, borders)
───────────────────────────────────────────────────────────────────── */
export function getPalette(phase: SingularityPhase) {
  return PALETTES[phase];
}

export { PALETTES };

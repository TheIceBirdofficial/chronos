'use client';

import { useEffect, useRef } from 'react';

/* ─────────────────────────────────────────────────────────────────────
   TYPES & MATH UTILS
   ───────────────────────────────────────────────────────────────────── */
export type ChronosState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'warning' | 'offline';
const TAU  = Math.PI * 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpRGB = (a: [number,number,number], b: [number,number,number], k: number): [number,number,number] =>
  [lerp(a[0],b[0],k), lerp(a[1],b[1],k), lerp(a[2],b[2],k)];
const rgb = (c: [number,number,number], a: number) =>
  `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;

/* ─────────────────────────────────────────────────────────────────────
   PHASE CONFIG
   ───────────────────────────────────────────────────────────────────── */
interface PhaseCfg {
  label: string;
  accent1: [number,number,number]; // primary
  accent2: [number,number,number]; // secondary
  accent3: [number,number,number]; // tertiary highlights
  coreRGB: [number,number,number];
  hex1: string; hex2: string;
  particleSpeed: number;
  ringActivity: number;
  breathSpeed: number;
  glowPulseRate: number;   // pulses per second
  desc: string;
  subdesc: string;
}

const PHASE_CFG: Record<ChronosState, PhaseCfg> = {
  idle: {
    label: 'IDLE',
    accent1: [6, 198, 179],
    accent2: [0, 80, 80],
    accent3: [100, 255, 240],
    coreRGB: [180, 255, 250],
    hex1: '#06C6B3', hex2: '#005050',
    particleSpeed: 0.28,
    ringActivity: 0.22,
    breathSpeed: 0.32,
    glowPulseRate: 0,
    desc: 'Temporal anomaly stabilised',
    subdesc: 'Spacetime curvature minimal · Particles drift lazily',
  },
  listening: {
    label: 'LISTENING',
    accent1: [0, 153, 255],
    accent2: [0, 79, 128],
    accent3: [140, 220, 255],
    coreRGB: [180, 220, 255],
    hex1: '#0099FF', hex2: '#004F80',
    particleSpeed: 0.65,
    ringActivity: 0.60,
    breathSpeed: 1.0,
    glowPulseRate: 0.55,
    desc: 'Temporal wavefronts detected',
    subdesc: 'Audio signal warps local spacetime · Energy field expanding',
  },
  thinking: {
    label: 'THINKING',
    accent1: [16, 185, 129],
    accent2: [6, 78, 59],
    accent3: [120, 255, 180],
    coreRGB: [200, 255, 220],
    hex1: '#10B981', hex2: '#064E3B',
    particleSpeed: 4.5,
    ringActivity: 1.5,
    breathSpeed: 3.2,
    glowPulseRate: 0,
    desc: 'Exploring parallel timelines',
    subdesc: 'Temporal fragments accelerate · Hidden geometries emerge',
  },
  speaking: {
    label: 'SPEAKING',
    accent1: [37, 99, 235],
    accent2: [30, 58, 138],
    accent3: [120, 180, 255],
    coreRGB: [200, 220, 255],
    hex1: '#2563EB', hex2: '#1E3A8A',
    particleSpeed: 1.0,
    ringActivity: 0.72,
    breathSpeed: 1.7,
    glowPulseRate: 1.8,
    desc: 'Temporal information emitted',
    subdesc: 'Reality perturbed by outgoing signal · Field resonates',
  },
  warning: {
    label: 'WARNING',
    accent1: [255, 60, 0],
    accent2: [255, 140, 0],
    accent3: [255, 200, 0],
    coreRGB: [255, 100, 50],
    hex1: '#FF3C00', hex2: '#FF8C00',
    particleSpeed: 2.2,
    ringActivity: 1.1,
    breathSpeed: 2.5,
    glowPulseRate: 1.5,
    desc: 'Temporal structure destabilising',
    subdesc: 'Threat detected · Entropy flux critical',
  },
  offline: {
    label: 'OFFLINE',
    accent1: [239, 68, 68],
    accent2: [127, 29, 29],
    accent3: [255, 100, 100],
    coreRGB: [255, 100, 100],
    hex1: '#EF4444', hex2: '#7F1D1D',
    particleSpeed: 0.05,
    ringActivity: 0.05,
    breathSpeed: 0.1,
    glowPulseRate: 0,
    desc: 'Temporal core offline',
    subdesc: 'Singularity containment powered down · Sync lost',
  },
};

const MAIN_PHASE_CFG: Record<ChronosState, PhaseCfg> = {
  idle: {
    label: 'IDLE',
    accent1: [220, 208, 255],
    accent2: [120, 100, 180],
    accent3: [240, 230, 255],
    coreRGB: [240, 235, 255],
    hex1: '#DCD0FF', hex2: '#7864B4',
    particleSpeed: 0.28,
    ringActivity: 0.22,
    breathSpeed: 0.32,
    glowPulseRate: 0,
    desc: 'Temporal anomaly stabilised',
    subdesc: 'Spacetime curvature minimal · Particles drift lazily',
  },
  listening: {
    label: 'LISTENING',
    accent1: [153, 102, 204],
    accent2: [80, 40, 120],
    accent3: [210, 180, 240],
    coreRGB: [220, 200, 255],
    hex1: '#9966CC', hex2: '#502878',
    particleSpeed: 0.65,
    ringActivity: 0.60,
    breathSpeed: 1.0,
    glowPulseRate: 0.55,
    desc: 'Temporal wavefronts detected',
    subdesc: 'Audio signal warps local spacetime · Energy field expanding',
  },
  thinking: {
    label: 'THINKING',
    accent1: [16, 185, 129],
    accent2: [6, 78, 59],
    accent3: [120, 255, 180],
    coreRGB: [200, 255, 220],
    hex1: '#10B981', hex2: '#064E3B',
    particleSpeed: 4.5,
    ringActivity: 1.5,
    breathSpeed: 3.2,
    glowPulseRate: 0,
    desc: 'Exploring parallel timelines',
    subdesc: 'Temporal fragments accelerate · Hidden geometries emerge',
  },
  speaking: {
    label: 'SPEAKING',
    accent1: [138, 43, 226],
    accent2: [30, 0, 60],
    accent3: [180, 120, 255],
    coreRGB: [220, 180, 255],
    hex1: '#8A2BE2', hex2: '#1E003C',
    particleSpeed: 1.0,
    ringActivity: 0.72,
    breathSpeed: 1.7,
    glowPulseRate: 1.8,
    desc: 'Temporal information emitted',
    subdesc: 'Reality perturbed by outgoing signal · Field resonates',
  },
  warning: {
    label: 'WARNING',
    accent1: [255, 60, 0],
    accent2: [255, 140, 0],
    accent3: [255, 200, 0],
    coreRGB: [255, 100, 50],
    hex1: '#FF3C00', hex2: '#FF8C00',
    particleSpeed: 2.2,
    ringActivity: 1.1,
    breathSpeed: 2.5,
    glowPulseRate: 1.5,
    desc: 'Temporal structure destabilising',
    subdesc: 'Threat detected · Entropy flux critical',
  },
  offline: {
    label: 'OFFLINE',
    accent1: [239, 68, 68],
    accent2: [127, 29, 29],
    accent3: [255, 100, 100],
    coreRGB: [255, 100, 100],
    hex1: '#EF4444', hex2: '#7F1D1D',
    particleSpeed: 0.05,
    ringActivity: 0.05,
    breathSpeed: 0.1,
    glowPulseRate: 0,
    desc: 'Temporal core offline',
    subdesc: 'Singularity containment powered down · Sync lost',
  },
};

/* ─────────────────────────────────────────────────────────────────────
   SEEDED RNG
   ───────────────────────────────────────────────────────────────────── */
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/* ─────────────────────────────────────────────────────────────────────
   RING SYSTEM
   ───────────────────────────────────────────────────────────────────── */
interface RingSegment {
  startAngle: number; endAngle: number;
  width: number; opacity: number; glowIntensity: number;
  fragmentOffset: number; angularDrift: number;
  colorBias: number;
}
interface Ring {
  baseR: number; segments: RingSegment[];
  rotSpeed: number; tiltX: number; tiltY: number;
  rotOffset: number; breakFactor: number;
  layer: 'inner'|'mid'|'outer';
}

function buildRings(): Ring[] {
  const rings: Ring[] = [];
  const defs: [number,number,number,number,number,number,string][] = [
    [0.30, +0.022, 0.15, 0.97, 0.75, 1001, 'inner'],
    [0.45, -0.016, 0.90, 0.20, 0.50, 2002, 'inner'],
    [0.62, +0.011, 0.35, 0.88, 0.62, 3003, 'mid'],
    [0.80, -0.019, 0.88, 0.32, 0.40, 4004, 'mid'],
    [1.00, +0.008, 0.25, 0.94, 0.55, 5005, 'mid'],
    [1.20, -0.014, 0.82, 0.44, 0.35, 6006, 'outer'],
    [1.42, +0.006, 0.18, 0.96, 0.68, 7007, 'outer'],
    [1.65, -0.009, 0.70, 0.58, 0.80, 8008, 'outer'],
  ];

  for (const [baseR, rotSpd, tX, tY, brk, seed, layer] of defs) {
    const rng = seededRng(seed);
    const segments: RingSegment[] = [];
    let angle = rng() * TAU;
    while (angle < TAU) {
      const arcLen = (0.12 + rng() * 0.52) * (1 - brk * 0.45);
      const gap    = (0.04 + rng() * 0.32) * (1 + brk * 0.75);
      if (angle + arcLen < TAU + 0.1) {
        segments.push({
          startAngle: angle, endAngle: Math.min(angle + arcLen, TAU),
          width: 0.5 + rng() * 2.4,
          opacity: 0.20 + rng() * 0.60,
          glowIntensity: 0.2 + rng() * 0.8,
          fragmentOffset: (rng() - 0.5) * 10,
          angularDrift: (rng() - 0.5) * 0.005,
          colorBias: rng(),
        });
      }
      angle += arcLen + gap;
    }
    rings.push({
      baseR: baseR as number,
      segments,
      rotSpeed: rotSpd as number,
      tiltX: tX as number, tiltY: tY as number,
      rotOffset: rng() * TAU,
      breakFactor: brk as number,
      layer: layer as 'inner'|'mid'|'outer',
    });
  }
  return rings;
}

/* ─────────────────────────────────────────────────────────────────────
   PARTICLE SYSTEM
   ───────────────────────────────────────────────────────────────────── */
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number;
  orbitR: number; orbitAngle: number; orbitSpeed: number;
  type: 'debris'|'spark'|'dust'|'thread';
  colorBias: number;
  trailX: number[]; trailY: number[];
}

function spawnParticle(cx: number, cy: number, cfg: PhaseCfg, R: number): Particle {
  const orbitR = R * (0.18 + Math.random() * 1.65);
  const orbitAngle = Math.random() * TAU;
  const speed = (0.0018 + Math.random() * 0.009) * cfg.particleSpeed;
  const roll = Math.random();
  const type = roll < 0.45 ? 'dust' : roll < 0.72 ? 'debris' : roll < 0.88 ? 'spark' : 'thread';
  return {
    x: cx + Math.cos(orbitAngle) * orbitR,
    y: cy + Math.sin(orbitAngle) * orbitR,
    vx: 0, vy: 0,
    life: 0, maxLife: 100 + Math.random() * 340,
    size: type === 'spark'  ? 0.5 + Math.random() * 1.2
        : type === 'thread' ? 0.3 + Math.random() * 0.7
        : type === 'debris' ? 1.1 + Math.random() * 2.8
        : 0.3 + Math.random() * 0.8,
    orbitR, orbitAngle, orbitSpeed: speed * (Math.random() < 0.5 ? 1 : -1),
    type, colorBias: Math.random(),
    trailX: [], trailY: [],
  };
}

/* ─────────────────────────────────────────────────────────────────────
   GLOW PULSE
   ───────────────────────────────────────────────────────────────────── */
interface GlowPulse {
  r: number; maxR: number;
  life: number; maxLife: number;
  alpha: number;
  col: [number,number,number];
}

/* ─────────────────────────────────────────────────────────────────────
   LIGHTNING ARC
   ───────────────────────────────────────────────────────────────────── */
interface Arc {
  points: {x:number;y:number}[];
  life: number; maxLife: number;
  col: [number,number,number];
  width: number;
}

function makeArc(cx: number, cy: number, R: number, cfg: PhaseCfg): Arc {
  const startAngle = Math.random() * TAU;
  const endAngle   = startAngle + (Math.PI * 0.4 + Math.random() * Math.PI * 1.2);
  const startR = R * (0.3 + Math.random() * 0.8);
  const endR   = R * (0.3 + Math.random() * 0.8);
  const sx = cx + Math.cos(startAngle) * startR;
  const sy = cy + Math.sin(startAngle) * startR;
  const ex = cx + Math.cos(endAngle)   * endR;
  const ey = cy + Math.sin(endAngle)   * endR;
  const segs = 8 + Math.floor(Math.random() * 6);
  const pts: {x:number;y:number}[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const mx = lerp(sx, ex, t);
    const my = lerp(sy, ey, t);
    const perp = Math.atan2(ey-sy, ex-sx) + Math.PI/2;
    const jitter = (Math.random()-0.5) * R * 0.18 * (1 - Math.abs(t-0.5)*2);
    pts.push({ x: mx + Math.cos(perp)*jitter, y: my + Math.sin(perp)*jitter });
  }
  return {
    points: pts, life: 0, maxLife: 12 + Math.floor(Math.random()*14),
    col: cfg.accent3, width: 0.5 + Math.random() * 1.2,
  };
}

/* ─────────────────────────────────────────────────────────────────────
   RUNE POINTS
   ───────────────────────────────────────────────────────────────────── */
function buildRune(n: number, r: number, cx: number, cy: number, angleOffset: number) {
  const pts: {x:number;y:number}[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + angleOffset;
    pts.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r });
  }
  return pts;
}

/* ─────────────────────────────────────────────────────────────────────
   DISTORTION FIELD
   ───────────────────────────────────────────────────────────────────── */
function drawDistortionField(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number,
  t: number, col: [number,number,number], blend: number, state: ChronosState
) {
  const steps = 400;
  const energy = state === 'thinking' || state === 'warning' ? 1.8 : state === 'speaking' ? 1.4 : state === 'listening' ? 1.2 : state === 'offline' ? 0.1 : 0.8;
  if (state === 'offline') return;

  // Inner forcefield circle (centered and tight)
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * TAU;
    const baseR = R * 0.42;
    const wave = Math.sin(u * 8 - t * 3.5 * energy) * R * 0.04;
    const fx = cx + Math.cos(u) * (baseR + wave);
    const fy = cy + Math.sin(u) * (baseR + wave);
    i === 0 ? ctx.moveTo(fx, fy) : ctx.lineTo(fx, fy);
  }
  ctx.strokeStyle = rgb(col, 0.12 * blend * energy);
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Outer forcefield circle (centered and tight)
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * TAU;
    const baseR = R * 0.62;
    const wave = Math.cos(u * 6 + t * 2.8 * energy) * R * 0.03;
    const fx = cx + Math.cos(u) * (baseR + wave);
    const fy = cy + Math.sin(u) * (baseR + wave);
    i === 0 ? ctx.moveTo(fx, fy) : ctx.lineTo(fx, fy);
  }
  ctx.strokeStyle = rgb(col, 0.08 * blend * energy);
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/* ─────────────────────────────────────────────────────────────────────
   MAIN DRAW
   ───────────────────────────────────────────────────────────────────── */
function draw(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  cx: number, cy: number,
  t: number,
  state: ChronosState,
  blend: number,
  R: number,
  rings: Ring[],
  particles: Particle[],
  pulses: GlowPulse[],
  arcs: Arc[],
  lerpedAccent1: [number,number,number],
  lerpedAccent2: [number,number,number],
  cfg: PhaseCfg,
  theme: 'dashboard' | 'main',
) {

  /* ── 1. DEEP AMBIENT HALO + NEBULA FIELD ─────────────────────────── */
  {
    const hOff = R * 0.12;
    const hx   = cx + Math.sin(t * 0.10) * hOff;
    const hy   = cy + Math.cos(t * 0.07) * hOff;
    const hR   = R * (3.0 + 0.12 * Math.sin(t * cfg.breathSpeed * 0.5));
    const hg = ctx.createRadialGradient(hx, hy, R*0.05, cx, cy, hR);
    hg.addColorStop(0,   rgb(lerpedAccent1, 0.11 * blend));
    hg.addColorStop(0.25,rgb(lerpedAccent2, 0.05 * blend));
    hg.addColorStop(0.6, rgb(lerpedAccent1, 0.015 * blend));
    hg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(cx, cy, hR, 0, TAU); ctx.fill();

    const nx = cx + Math.cos(t * 0.13 + 1.5) * R * 0.25;
    const ny = cy + Math.sin(t * 0.09 + 0.8) * R * 0.20;
    const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, R * 2.0);
    ng.addColorStop(0,   rgb(lerpedAccent2, 0.07 * blend));
    ng.addColorStop(0.5, rgb(lerpedAccent2, 0.02 * blend));
    ng.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = ng;
    ctx.beginPath(); ctx.arc(nx, ny, R*2.0, 0, TAU); ctx.fill();

    if (state === 'thinking' || state === 'speaking' || state === 'warning') {
      const tx2 = cx + Math.sin(t * 0.17 + 3.0) * R * 0.18;
      const ty2 = cy + Math.cos(t * 0.12 + 2.1) * R * 0.15;
      const tg2 = ctx.createRadialGradient(tx2, ty2, 0, tx2, ty2, R * 1.5);
      tg2.addColorStop(0,  rgb(lerpedAccent1, 0.10 * blend));
      tg2.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle = tg2;
      ctx.beginPath(); ctx.arc(tx2, ty2, R*1.5, 0, TAU); ctx.fill();
    }
  }

  /* ── 1.5 DORMAMMU DISTORTION FIELD ──────────────────────────────── */
  if (theme !== 'main') {
    drawDistortionField(ctx, cx, cy, R, t, lerpedAccent1, blend, state);
  }

  /* ── 2. GLOW PULSES ──────────────────────────────────────────────── */
  pulses.forEach(pulse => {
    const prog = pulse.r / pulse.maxR;
    const peakAt = 0.15;
    const envAlpha = prog < peakAt
      ? (prog / peakAt)
      : Math.pow(1 - (prog - peakAt) / (1 - peakAt), 1.8);
    const alpha = pulse.alpha * envAlpha * blend;
    if (alpha < 0.004) return;

    const innerR = pulse.r * 0.35;
    const ig = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse.r);
    ig.addColorStop(0,                      rgb(pulse.col, 0));
    ig.addColorStop(Math.max(0, prog-0.12), rgb(pulse.col, 0));
    ig.addColorStop(prog * 0.88,            rgb(pulse.col, alpha * 0.28));
    ig.addColorStop(prog,                   rgb(pulse.col, alpha * 0.55));
    ig.addColorStop(Math.min(1, prog+0.05), rgb(pulse.col, alpha * 0.20));
    ig.addColorStop(1,                      rgb(pulse.col, 0));
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.arc(cx, cy, pulse.maxR, 0, TAU); ctx.fill();

    const og = ctx.createRadialGradient(cx, cy, pulse.r * 0.7, cx, cy, pulse.r * 1.6);
    og.addColorStop(0, rgb(pulse.col, alpha * 0.18));
    og.addColorStop(1, rgb(pulse.col, 0));
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(cx, cy, pulse.r * 1.6, 0, TAU); ctx.fill();

    void innerR;
  });

  /* ── 3. BROKEN CLOCK RINGS ───────────────────────────────────────── */
  rings.forEach((ring, ri) => {
    const rR = R * ring.baseR;
    const actBoost = lerp(1, 1 + cfg.ringActivity * 1.3, blend);
    const rotT = t * ring.rotSpeed * actBoost + ring.rotOffset;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(ring.tiltX, ring.tiltY);

    ring.segments.forEach((seg, si) => {
      const ds = seg.startAngle + rotT + seg.angularDrift * t * 40;
      const de = seg.endAngle   + rotT + seg.angularDrift * t * 40;

      const energy  = cfg.ringActivity * blend;
      const fragDisp = seg.fragmentOffset * energy * 0.7;

      const thinkDrift = (state === 'thinking' || state === 'warning')
        ? Math.sin(t * 2.5 + si * 1.7 + ri * 0.9) * R * 0.09 * blend
        : 0;
      const finalR = rR + fragDisp + thinkDrift;

      const speakPulse = state === 'speaking'
        ? 1 + 0.12 * Math.abs(Math.sin(t * 5.5 + si * 0.9 + ri * 1.4)) * blend
        : 1;

      const mixedCol = lerpRGB(lerpedAccent1, lerpedAccent2, seg.colorBias);
      const segAlpha = seg.opacity * (0.35 + 0.65 * blend) * speakPulse;

      ctx.beginPath();
      ctx.arc(0, 0, finalR * speakPulse, ds, de);
      ctx.strokeStyle = rgb(mixedCol, segAlpha);
      ctx.lineWidth = seg.width * (1 + energy * 0.7);
      ctx.globalAlpha = 1;
      ctx.stroke();

      if (seg.glowIntensity > 0.45) {
        ctx.beginPath();
        ctx.arc(0, 0, finalR * speakPulse, ds, de);
        ctx.strokeStyle = rgb(lerpedAccent1, segAlpha * 0.15 * seg.glowIntensity);
        ctx.lineWidth = seg.width * 5.5;
        ctx.stroke();
      }

      if ((state === 'thinking' || state === 'warning') && blend > 0.4 && seg.glowIntensity > 0.6) {
        const tipA = ds + (de - ds) * (Math.sin(t * 1.8 + si) * 0.5 + 0.5);
        ctx.beginPath();
        ctx.arc(Math.cos(tipA) * finalR, Math.sin(tipA) * finalR, 1.5, 0, TAU);
        ctx.fillStyle = rgb(cfg.accent3, 0.9 * blend);
        ctx.fill();
      }
    });

    ctx.restore();
    ctx.globalAlpha = 1;
  });

  /* ── 4. LIGHTNING ARCS ───────────────────────────────────────────── */
  if ((state === 'thinking' || state === 'warning') && arcs.length > 0) {
    arcs.forEach(arc => {
      const lifeFrac = arc.life / arc.maxLife;
      const alpha = (1 - lifeFrac) * 0.75 * blend;
      if (alpha < 0.01) return;
      ctx.beginPath();
      arc.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = rgb(arc.col, alpha);
      ctx.lineWidth = arc.width;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.beginPath();
      arc.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = rgb(arc.col, alpha * 0.3);
      ctx.lineWidth = arc.width * 4;
      ctx.stroke();
    });
  }

  /* ── 5. THINKING/WARNING GEOMETRY ───────────────────────────────── */
  if ((state === 'thinking' || state === 'warning') && blend > 0.08) {
    const a = blend;

    const p7 = buildRune(7, R * 0.72, cx, cy, t * 0.14);
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const next = (i + 3) % 7;
      ctx.moveTo(p7[i].x, p7[i].y);
      ctx.lineTo(p7[next].x, p7[next].y);
    }
    ctx.strokeStyle = rgb(cfg.accent1, a * 0.20);
    ctx.lineWidth = 0.8;
    ctx.stroke();

    const p6a = buildRune(3, R * 0.44, cx, cy, t * 0.22);
    ctx.beginPath();
    ctx.moveTo(p6a[0].x, p6a[0].y);
    ctx.lineTo(p6a[1].x, p6a[1].y);
    ctx.lineTo(p6a[2].x, p6a[2].y);
    ctx.closePath();
    ctx.strokeStyle = rgb(cfg.accent2, a * 0.35);
    ctx.lineWidth = 0.9;
    ctx.stroke();

    const p6b = buildRune(3, R * 0.44, cx, cy, t * 0.22 + Math.PI/3);
    ctx.beginPath();
    ctx.moveTo(p6b[0].x, p6b[0].y);
    ctx.lineTo(p6b[1].x, p6b[1].y);
    ctx.lineTo(p6b[2].x, p6b[2].y);
    ctx.closePath();
    ctx.strokeStyle = rgb(cfg.accent2, a * 0.35);
    ctx.lineWidth = 0.9;
    ctx.stroke();

    [...p7, ...p6a, ...p6b].forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.8, 0, TAU);
      ctx.fillStyle = rgb(cfg.accent3, a * 0.65);
      ctx.fill();
    });

    const p3 = buildRune(3, R * 0.24, cx, cy, t * 0.55);
    ctx.beginPath();
    ctx.moveTo(p3[0].x, p3[0].y);
    ctx.lineTo(p3[1].x, p3[1].y);
    ctx.lineTo(p3[2].x, p3[2].y);
    ctx.closePath();
    ctx.strokeStyle = rgb(cfg.accent1, a * 0.40);
    ctx.lineWidth = 1.0;
    ctx.stroke();

    const p3b = buildRune(3, R * 0.24, cx, cy, -t * 0.55 + Math.PI/3);
    ctx.beginPath();
    ctx.moveTo(p3b[0].x, p3b[0].y);
    ctx.lineTo(p3b[1].x, p3b[1].y);
    ctx.lineTo(p3b[2].x, p3b[2].y);
    ctx.closePath();
    ctx.strokeStyle = rgb(cfg.accent2, a * 0.32);
    ctx.lineWidth = 1.0;
    ctx.stroke();
  }

  /* ── 6. ENERGY SPIRALS ───────────────────────────────────────────── */
  if ((state === 'thinking' || state === 'speaking' || state === 'warning') && blend > 0.05) {
    const spiralCount = state === 'thinking' || state === 'warning' ? 3 : 2;
    for (let sp = 0; sp < spiralCount; sp++) {
      const steps    = 240;
      const turns    = state === 'thinking' || state === 'warning' ? 4.5 : 2.8;
      const spd      = state === 'thinking' || state === 'warning' ? (1.6 + sp * 0.4) : (2.5 + sp * 0.5);
      const maxR     = R * (state === 'thinking' || state === 'warning' ? 0.78 : 0.62);
      const rotOff   = (sp / spiralCount) * TAU + (sp % 2 === 1 ? Math.PI : 0);
      const spiralAlpha = blend * (state === 'thinking' || state === 'warning' ? 0.22 : 0.18);
      const col = sp % 2 === 0 ? lerpedAccent1 : lerpedAccent2;

      ctx.beginPath();
      for (let i = 0; i < steps; i++) {
        const frac  = i / steps;
        const theta = frac * TAU * turns - t * spd + rotOff;
        const r     = frac * maxR;
        const x = cx + Math.cos(theta) * r;
        const y = cy + Math.sin(theta) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgb(col, spiralAlpha);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  /* ── 7. PARTICLES ────────────────────────────────────────────────── */
  ctx.globalCompositeOperation = 'lighter';
  particles.forEach(p => {
    const lf     = p.life / p.maxLife;
    const fadeIn = Math.min(lf * 5, 1);
    const fadeOut= 1 - lf * lf;
    const alpha  = fadeIn * fadeOut;
    if (alpha < 0.008) return;

    const mixedCol = lerpRGB(lerpedAccent1, lerpedAccent2, p.colorBias);

    if (p.type === 'thread' && p.trailX.length > 1) {
      ctx.beginPath();
      ctx.moveTo(p.trailX[0], p.trailY[0]);
      for (let i = 1; i < p.trailX.length; i++) {
        ctx.lineTo(p.trailX[i], p.trailY[i]);
      }
      ctx.strokeStyle = rgb(mixedCol, alpha * 0.35);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    if (p.type === 'spark') {
      const s = p.size * 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y);
      ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x, p.y + s);
      ctx.strokeStyle = rgb([220, 245, 255], alpha * 0.9);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fillStyle = p.type === 'debris'
        ? rgb(mixedCol, alpha * 0.75)
        : rgb(lerpedAccent1, alpha * 0.45);
      ctx.fill();
    }
  });
  ctx.globalCompositeOperation = 'source-over';

  /* ── 8. ACCRETION DISK / LENSING DARK ZONE ──────────────────────── */
  {
    const coreR = R * (0.10 + 0.015 * Math.sin(t * cfg.breathSpeed));
    const accR  = coreR * 2.8;

    const ag = ctx.createRadialGradient(cx, cy, coreR * 0.4, cx, cy, accR * 2.2);
    ag.addColorStop(0,    'rgba(0,0,0,0.97)');
    ag.addColorStop(0.28, 'rgba(0,0,0,0.70)');
    ag.addColorStop(0.58, 'rgba(0,0,10,0.22)');
    ag.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(cx, cy, accR * 2.2, 0, TAU); ctx.fill();

    const band1 = ctx.createRadialGradient(cx, cy, coreR * 0.8, cx, cy, accR);
    band1.addColorStop(0,   rgb(lerpedAccent1, 0.06));
    band1.addColorStop(0.5, rgb(lerpedAccent1, 0.18 * blend));
    band1.addColorStop(0.8, rgb(lerpedAccent2, 0.10 * blend));
    band1.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = band1;
    ctx.beginPath(); ctx.arc(cx, cy, accR, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    cg.addColorStop(0,   '#ffffff');
    cg.addColorStop(0.4, rgb(cfg.coreRGB, 1));
    cg.addColorStop(0.8, rgb(lerpedAccent1, 0.5));
    cg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, TAU); ctx.fill();

    if (state === 'thinking' || state === 'warning') {
      const corona = coreR * (1.6 + 0.4 * Math.abs(Math.sin(t * 3.8)));
      const coronaG = ctx.createRadialGradient(cx, cy, coreR, cx, cy, corona * 1.5);
      coronaG.addColorStop(0,   rgb(cfg.accent1, 0.35 * blend));
      coronaG.addColorStop(0.5, rgb(cfg.accent1, 0.12 * blend));
      coronaG.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = coronaG;
      ctx.beginPath(); ctx.arc(cx, cy, corona * 1.5, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* ── 9. SPEAKING IRREGULAR FLUID SPIKES ────────────────────────── */
  if (state === 'speaking' && blend > 0.1) {
    const count  = 32;
    const coreR  = R * 0.10;
    for (let i = 0; i < count; i++) {
      const angle  = (i / count) * TAU + t * 0.28;
      const modA   = Math.abs(Math.sin(t * 8.5 + i * 1.1 + Math.cos(t * 4.1 + i * 0.6)));
      const modB   = Math.abs(Math.sin(t * 13 - i * 0.8));
      const amp    = (0.03 + 0.22 * modA * modB) * blend;
      const r1     = coreR * 1.8;
      const r2     = R * (0.12 + amp);
      const alpha  = (0.25 + 0.75 * modA) * blend;
      const isV    = i % 3 === 2;
      
      ctx.beginPath();
      for (let j = 0; j <= 5; j++) {
        const f = j / 5;
        const currentR = lerp(r1, r2, f);
        const bend = Math.sin(f * Math.PI + t * 6 + i) * 0.08 * modA;
        const wx = cx + Math.cos(angle + bend) * currentR;
        const wy = cy + Math.sin(angle + bend) * currentR;
        j === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
      }
      ctx.strokeStyle = isV
        ? rgb(lerpedAccent2, alpha * 0.7)
        : rgb(lerpedAccent1, alpha * 0.8);
      ctx.lineWidth = 0.8 + modA * 1.1;
      ctx.stroke();
    }
  }

  /* ── 10. LISTENING — chaotic energy bands ──────────────────────── */
  if (state === 'listening' && blend > 0.1) {
    const bandCount = 14;
    for (let i = 0; i < bandCount; i++) {
      const baseAngle = (i / bandCount) * TAU + t * 0.15;
      const prog = ((t * 0.7 + i * 0.5) % 2.5) / 2.5;
      
      const r1 = R * (0.15 + prog * 1.8);
      const r2 = r1 + R * 0.45;
      const alpha = (1 - prog) * 0.18 * blend;
      if (alpha < 0.01) continue;
      
      ctx.beginPath();
      for (let j = 0; j <= 10; j++) {
        const f = j / 10;
        const currentR = lerp(r1, r2, f);
        const waveAngle = baseAngle + Math.sin(f * Math.PI * 3 - t * 4 + i) * 0.15;
        const wx = cx + Math.cos(waveAngle) * currentR;
        const wy = cy + Math.sin(waveAngle) * currentR;
        j === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
      }
      ctx.strokeStyle = rgb(lerpedAccent1, alpha);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  /* ── 11. IDLE — slow orbital debris ─────────────────────────────── */
  if (state === 'idle') {
    const moteA = t * 0.20;
    const mx = cx + Math.cos(moteA) * R * 1.60;
    const my = cy + Math.sin(moteA) * R * 0.38;
    const mAlpha = (0.4 + 0.6 * Math.sin(t * 1.2)) * blend;
    ctx.beginPath(); ctx.arc(mx, my, 2.0, 0, TAU);
    ctx.fillStyle = rgb(cfg.coreRGB, mAlpha);
    ctx.fill();
  }

  /* ── 12. SCAN LINE ───────────────────────────────────────────────── */
  if (state !== 'offline') {
    const scanBand = R * 3.4;
    const scanY = cy - R * 1.7 + ((t * 24) % scanBand);
    const sg = ctx.createLinearGradient(cx - R*1.7, scanY, cx + R*1.7, scanY);
    sg.addColorStop(0,   'rgba(0,200,255,0)');
    sg.addColorStop(0.3, rgb(lerpedAccent1, 0.020));
    sg.addColorStop(0.7, rgb(lerpedAccent1, 0.020));
    sg.addColorStop(1,   'rgba(0,200,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(cx - R*1.7, scanY - 0.5, R*3.4, 1);
  }
}

/* ─────────────────────────────────────────────────────────────────────
   COMPONENT
   ───────────────────────────────────────────────────────────────────── */
interface ChronosCanvasProps {
  state: ChronosState;
  size?: number;
  className?: string;
  theme?: 'dashboard' | 'main';
}

export default function ChronosCanvas({ state, size = 480, className = "", theme = "dashboard" }: ChronosCanvasProps) {
  const cvs      = useRef<HTMLCanvasElement>(null);
  const phRef    = useRef<ChronosState>(state);
  const blendRef = useRef(0);

  const getPhaseCfg = (ph: ChronosState) => {
    if (theme === 'main') {
      return MAIN_PHASE_CFG[ph] || PHASE_CFG[ph];
    }
    return PHASE_CFG[ph];
  };

  const initCfg = getPhaseCfg(state);
  const la1Ref = useRef<[number,number,number]>([...initCfg.accent1] as [number,number,number]);
  const la2Ref = useRef<[number,number,number]>([...initCfg.accent2] as [number,number,number]);

  useEffect(() => { phRef.current = state; blendRef.current = 0; }, [state]);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1 || 1, 2);
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2;
    const R  = size * 0.13;

    const rings = buildRings();
    const particles: Particle[] = [];
    const MAX_P = 100;

    const localGetPhaseCfg = (ph: ChronosState) => {
      if (theme === 'main') {
        return MAIN_PHASE_CFG[ph] || PHASE_CFG[ph];
      }
      return PHASE_CFG[ph];
    };

    const initCfgLocal = localGetPhaseCfg(state);
    for (let i = 0; i < MAX_P * 0.5; i++) {
      const p = spawnParticle(cx, cy, initCfgLocal, R);
      p.life = Math.random() * p.maxLife;
      particles.push(p);
    }

    const pulses: GlowPulse[] = [];
    let nextPulseT = 0;

    const arcs: Arc[] = [];
    let nextArcT = 0;

    let t = 0, id: number;

    const frame = () => {
      t += 0.012;
      const ph  = phRef.current;
      const cfg = localGetPhaseCfg(ph);

      blendRef.current = lerp(blendRef.current, 1, 0.038);
      const blend = blendRef.current;

      la1Ref.current = lerpRGB(la1Ref.current, cfg.accent1, 0.045);
      la2Ref.current = lerpRGB(la2Ref.current, cfg.accent2, 0.045);

      const target = ph === 'thinking' || ph === 'warning' ? MAX_P
        : ph === 'speaking'  ? Math.round(MAX_P * 0.80)
        : ph === 'listening' ? Math.round(MAX_P * 0.60)
        : ph === 'offline'   ? 8
        : Math.round(MAX_P * 0.32);
      
      while (particles.length < target) particles.push(spawnParticle(cx, cy, cfg, R));

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        p.orbitAngle += p.orbitSpeed * cfg.particleSpeed;
        
        const ripple = Math.sin(t * 3.5 + p.orbitAngle * 4) * (ph === 'thinking' || ph === 'warning' ? 0.35 : 0.10);
        const targetR = p.orbitR * (1 + ripple);
        
        const targetX = cx + Math.cos(p.orbitAngle) * targetR;
        const targetY = cy + Math.sin(p.orbitAngle) * targetR;
        
        let dx = targetX - p.x;
        let dy = targetY - p.y;
        
        if (ph === 'thinking' || ph === 'warning') {
            const distToCenter = Math.sqrt((p.x - cx)**2 + (p.y - cy)**2) || 1;
            const repulsionForce = Math.max(0, 150 - distToCenter) * 0.08;
            dx += (p.x - cx) / distToCenter * repulsionForce;
            dy += (p.y - cy) / distToCenter * repulsionForce;
        }

        p.vx = p.vx * 0.85 + dx * 0.15;
        p.vy = p.vy * 0.85 + dy * 0.15;
        p.x += p.vx * 0.08;
        p.y += p.vy * 0.08;
        
        if (p.type === 'thread') {
          p.trailX.push(p.x); p.trailY.push(p.y);
          if (p.trailX.length > (ph === 'thinking' || ph === 'warning' ? 18 : 8)) { 
            p.trailX.shift(); p.trailY.shift(); 
          }
        }
        if (p.life > p.maxLife || particles.length > target + 5) particles.splice(i, 1);
      }

      if (cfg.glowPulseRate > 0 && t > nextPulseT) {
        pulses.push({
          r: R * 0.12, maxR: R * (ph === 'speaking' ? 2.0 : 2.6),
          life: 0, maxLife: 140,
          alpha: ph === 'speaking' ? 0.55 : 0.42,
          col: [...cfg.accent1] as [number,number,number],
        });
        nextPulseT = t + 1 / cfg.glowPulseRate;
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].r += ph === 'speaking' ? 2.2 : 1.4;
        pulses[i].life++;
        if (pulses[i].r > pulses[i].maxR) pulses.splice(i, 1);
      }

      if ((ph === 'thinking' || ph === 'warning') && t > nextArcT) {
        arcs.push(makeArc(cx, cy, R, cfg));
        nextArcT = t + 0.08 + Math.random() * 0.25;
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        arcs[i].life++;
        if (arcs[i].life > arcs[i].maxLife) arcs.splice(i, 1);
      }

      ctx.clearRect(0, 0, size, size);
      draw(ctx, size, size, cx, cy, t, ph, blend, R,
           rings, particles, pulses, arcs,
           la1Ref.current, la2Ref.current, cfg, theme);

      id = requestAnimationFrame(frame);
    };

    frame();
    return () => cancelAnimationFrame(id);
  }, [size, theme]);

  return (
    <canvas ref={cvs} className={className} style={{ display: 'block', pointerEvents: 'none' }} />
  );
}

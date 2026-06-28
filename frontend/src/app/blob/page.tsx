'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ChronosCanvas, { ChronosState } from '@/components/ChronosCanvas';

/* ─────────────────────────────────────────────────────────────────────
   TYPES & MATH UTILS
───────────────────────────────────────────────────────────────────── */
type Phase = ChronosState;
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

const PHASE_CFG: Record<Phase, PhaseCfg> = {
  idle: {
    label: 'IDLE',
    accent1: [0, 200, 255],
    accent2: [100, 80, 230],
    accent3: [160, 220, 255],
    coreRGB: [180, 230, 255],
    hex1: '#00C8FF', hex2: '#6450E6',
    particleSpeed: 0.28,
    ringActivity: 0.22,
    breathSpeed: 0.32,
    glowPulseRate: 0,
    desc: 'Temporal anomaly stabilised',
    subdesc: 'Spacetime curvature minimal · Particles drift lazily',
  },
  listening: {
    label: 'LISTENING',
    accent1: [0, 230, 255],
    accent2: [40, 120, 255],
    accent3: [140, 245, 255],
    coreRGB: [200, 245, 255],
    hex1: '#00E6FF', hex2: '#2878FF',
    particleSpeed: 0.65,
    ringActivity: 0.60,
    breathSpeed: 1.0,
    glowPulseRate: 0.55,
    desc: 'Temporal wavefronts detected',
    subdesc: 'Audio signal warps local spacetime · Energy field expanding',
  },
  thinking: {
    label: 'THINKING',
    accent1: [0, 255, 140],
    accent2: [20, 200, 80],
    accent3: [160, 255, 200],
    coreRGB: [200, 255, 220],
    hex1: '#00FF8C', hex2: '#14C850',
    particleSpeed: 4.5,
    ringActivity: 1.5,
    breathSpeed: 3.2,
    glowPulseRate: 0,
    desc: 'Exploring parallel timelines',
    subdesc: 'Temporal fragments accelerate · Hidden geometries emerge',
  },
  speaking: {
    label: 'SPEAKING',
    accent1: [0, 200, 240],
    accent2: [80, 60, 220],
    accent3: [120, 230, 255],
    coreRGB: [200, 240, 255],
    hex1: '#00C8F0', hex2: '#503CDC',
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
    accent1: [80, 80, 80],
    accent2: [40, 40, 40],
    accent3: [120, 120, 120],
    coreRGB: [60, 60, 60],
    hex1: '#505050', hex2: '#282828',
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
  colorBias: number; // 0=accent1 1=accent2
}
interface Ring {
  baseR: number; segments: RingSegment[];
  rotSpeed: number; tiltX: number; tiltY: number;
  rotOffset: number; breakFactor: number;
  layer: 'inner'|'mid'|'outer';
}

function buildRings(): Ring[] {
  const rings: Ring[] = [];
  // [baseR, rotSpd, tiltX, tiltY, breakFactor, seed, layer]
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
   MINI PREVIEW CANVAS
───────────────────────────────────────────────────────────────────── */
function MiniSingularity({ phase, size = 96 }: { phase: Phase; size?: number }) {
  const cvs   = useRef<HTMLCanvasElement>(null);
  const phRef = useRef<Phase>(phase);
  useEffect(() => { phRef.current = phase; }, [phase]);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    canvas.width = canvas.height = size;
    const cx = size / 2, cy = size / 2;
    const R  = size * 0.23;
    const rings = buildRings();
    let t = 0, id: number;
    const la1: [number,number,number] = [...PHASE_CFG[phase].accent1] as [number,number,number];
    const la2: [number,number,number] = [...PHASE_CFG[phase].accent2] as [number,number,number];

    const frame = () => {
      t += 0.014;
      const ph  = phRef.current;
      const cfg = PHASE_CFG[ph];
      ctx.clearRect(0, 0, size, size);

      rings.forEach(ring => {
        const rR   = R * ring.baseR;
        const rotT = t * ring.rotSpeed * (1 + cfg.ringActivity) + ring.rotOffset;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(ring.tiltX, ring.tiltY);
        ring.segments.forEach(seg => {
          const mc = lerpRGB(la1, la2, seg.colorBias);
          ctx.beginPath();
          ctx.arc(0, 0, rR, seg.startAngle + rotT, seg.endAngle + rotT);
          ctx.strokeStyle = rgb(mc, seg.opacity * 0.65);
          ctx.lineWidth = seg.width * 0.55;
          ctx.stroke();
        });
        ctx.restore();
      });

      // mini core
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.28);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.5, rgb(cfg.coreRGB, 1));
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.28, 0, TAU); ctx.fill();

      id = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(id);
  }, [size]);

  return <canvas ref={cvs} width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }} />;
}

/* ─────────────────────────────────────────────────────────────────────
   WAVEFORM READOUT
───────────────────────────────────────────────────────────────────── */
function TemporalReadout({ phase }: { phase: Phase }) {
  const cvs   = useRef<HTMLCanvasElement>(null);
  const phRef = useRef<Phase>(phase);
  const la1   = useRef<[number,number,number]>([...PHASE_CFG[phase].accent1] as [number,number,number]);
  useEffect(() => { phRef.current = phase; }, [phase]);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = 320, H = 44;
    canvas.width = W; canvas.height = H;
    let t = 0, id: number;

    const frame = () => {
      t += 0.026;
      const ph  = phRef.current;
      const cfg = PHASE_CFG[ph];
      la1.current = lerpRGB(la1.current, cfg.accent1, 0.05);
      ctx.clearRect(0, 0, W, H);

      const N = 120;
      const pts: {x:number;y:number}[] = [];
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * W;
        const norm = i / N;
        const env  = Math.sin(norm * Math.PI);
        let y = H / 2;
        if (ph === 'idle')
          y -= Math.sin(norm * 5 + t * 0.9) * 4 * env;
        else if (ph === 'listening')
          y -= (Math.sin(norm * 14 + t * 4.5) * 13 + Math.cos(norm * 8 - t * 7) * 6) * env;
        else if (ph === 'thinking')
          y -= (Math.sin(norm * 10 + t * 3.2) * 10 + Math.cos(norm * 17 - t * 5.5) * 5 +
                Math.sin(norm * 25 + t * 8.1) * 3) * env;
        else
          y -= (Math.sin(norm * 19 + t * 6.8) * 16 + Math.sin(norm * 11 - t * 11) * 8) * env;
        pts.push({ x, y });
      }

      const ag = ctx.createLinearGradient(0, 0, 0, H);
      ag.addColorStop(0, rgb(la1.current, 0.38));
      ag.addColorStop(1, rgb(la1.current, 0));
      ctx.beginPath();
      ctx.moveTo(0, H);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(W, H); ctx.closePath();
      ctx.fillStyle = ag; ctx.fill();

      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = rgb(la1.current, 0.90);
      ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke();

      id = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(id);
  }, []);

  return <canvas ref={cvs} width={320} height={44}
    style={{ display: 'block', width: '100%', height: 44 }} />;
}

/* ─────────────────────────────────────────────────────────────────────
   TEMPORAL DATA TICKER
───────────────────────────────────────────────────────────────────── */
function DataTicker({ phase }: { phase: Phase }) {
  const rows: Record<Phase, string[][]> = {
    idle:      [['CURVATURE INDEX', '0.003 σ'], ['ENTROPY FLUX', 'STABLE'], ['TIMELINE FORKS', '—'],       ['FIELD COHERENCE', '99.7%']],
    listening: [['CURVATURE INDEX', '0.047 σ'], ['ENTROPY FLUX', 'RISING'], ['SIGNAL WAVEFRONT', 'ACTIVE'], ['FIELD COHERENCE', '94.2%']],
    thinking:  [['CURVATURE INDEX', '0.831 σ'], ['ENTROPY FLUX', 'CRITICAL'], ['TIMELINE FORKS', '∞'],      ['FIELD COHERENCE', '61.8%']],
    speaking:  [['CURVATURE INDEX', '0.218 σ'], ['ENTROPY FLUX', 'PULSING'], ['EMISSION RATE',  '88 Hz'],   ['FIELD COHERENCE', '86.5%']],
    warning:   [['CURVATURE INDEX', '1.492 σ'], ['ENTROPY FLUX', 'CRITICAL'], ['FIELD STABILITY', 'WARNING'], ['FIELD COHERENCE', '32.1%']],
    offline:   [['CURVATURE INDEX', '0.000 σ'], ['ENTROPY FLUX', 'NULL'], ['TIMELINE FORKS', 'OFFLINE'], ['FIELD COHERENCE', '0.0%']],
  };
  const cfg = PHASE_CFG[phase];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px',
      padding: '14px 18px',
      background: 'rgba(0,6,16,0.7)',
      border: `1px solid ${cfg.hex1}18`,
      borderRadius: 12,
      transition: 'border 0.8s',
    }}>
      {rows[phase].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 8, letterSpacing: '0.35em', color: '#0a1a2e', textTransform: 'uppercase' }}>{k}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: cfg.hex1, letterSpacing: '0.1em',
            transition: 'color 0.8s', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PAGE
───────────────────────────────────────────────────────────────────── */
const PHASES: Phase[] = ['idle', 'listening', 'thinking', 'speaking'];

export default function ChronosPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [auto, setAuto]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cfg = PHASE_CFG[phase];

  const cycle = useCallback(() => {
    setPhase(p => PHASES[(PHASES.indexOf(p) + 1) % PHASES.length]);
  }, []);

  useEffect(() => {
    if (auto) timerRef.current = setInterval(cycle, 4500);
    else if (timerRef.current) clearInterval(timerRef.current);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [auto, cycle]);

  return (
    <main style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse 120% 80% at 50% -10%, #040c1c 0%, #020710 55%, #010408 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: 'var(--font-outfit), system-ui, sans-serif',
      overflowX: 'hidden', paddingBottom: 100, position: 'relative',
      color: '#e0efff',
    }}>

      {/* Ambient reactive tint */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `radial-gradient(ellipse 65% 55% at 50% 48%, ${cfg.hex1}08 0%, ${cfg.hex2}05 55%, transparent 80%)`,
        transition: 'background 1.6s ease',
      }} />

      {/* Spacetime lattice grid */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage:
          'linear-gradient(rgba(0,180,255,0.016) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(0,180,255,0.016) 1px, transparent 1px)',
        backgroundSize: '80px 80px',
      }} />
      {/* Larger grid overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage:
          'linear-gradient(rgba(0,180,255,0.032) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(0,180,255,0.032) 1px, transparent 1px)',
        backgroundSize: '320px 320px',
      }} />

      {/* ══ HEADER ══ */}
      <header style={{ position: 'relative', zIndex: 10, textAlign: 'center', paddingTop: 52 }}>
        <p style={{
          fontSize: 9, letterSpacing: '0.65em', color: '#0c1c34',
          textTransform: 'uppercase', margin: '0 0 14px', fontWeight: 600,
        }}>
          chronos · temporal interface · class-Ω singularity
        </p>
        <h1 style={{
          fontSize: 'clamp(2rem, 5.5vw, 3.4rem)', fontWeight: 900,
          letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0,
          background: `linear-gradient(130deg, ${cfg.hex1} 0%, #ffffff 38%, ${cfg.hex2} 75%, ${cfg.hex1} 100%)`,
          backgroundSize: '250% auto',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          transition: 'background 1.2s ease',
          animation: 'shimmer 8s linear infinite',
        }}>
          Chronos
        </h1>
        <p style={{ color: '#0d1e3a', fontSize: 11, marginTop: 9, letterSpacing: '0.22em' }}>
          Localised Distortion in Spacetime
        </p>
      </header>

      {/* ══ HERO ══ */}
      <section style={{
        position: 'relative', zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        marginTop: 16,
      }}>
        {/* State badge */}
        <div style={{
          marginBottom: 8, padding: '6px 22px', borderRadius: 100,
          background: `linear-gradient(90deg, ${cfg.hex1}12, ${cfg.hex2}10)`,
          border: `1px solid ${cfg.hex1}30`,
          backdropFilter: 'blur(14px)',
          display: 'flex', alignItems: 'center', gap: 10,
          transition: 'all 0.9s ease',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
            background: cfg.hex1, boxShadow: `0 0 10px ${cfg.hex1}`,
            animation: 'dot-pulse 2s ease-in-out infinite',
          }} />
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.38em',
            color: cfg.hex1, textTransform: 'uppercase', transition: 'color 0.8s',
          }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: '#162840',
            borderLeft: '1px solid #0d2040', paddingLeft: 10 }}>
            {cfg.desc}
          </span>
        </div>

        {/* Hero canvas */}
        <ChronosCanvas state={phase} size={480} />

        {/* Sub-desc */}
        <p style={{
          color: '#152238', fontSize: 11.5, textAlign: 'center',
          letterSpacing: '0.14em', margin: '0 0 18px',
          maxWidth: 430, transition: 'color 0.8s',
        }}>
          {cfg.subdesc}
        </p>

        {/* Two-column telemetry */}
        <div style={{
          display: 'flex', gap: 12, width: 'min(680px, 92vw)',
          flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {/* Waveform */}
          <div style={{
            flex: '1 1 300px',
            background: 'rgba(0,6,20,0.65)',
            backdropFilter: 'blur(20px)',
            border: `1px solid ${cfg.hex1}10`,
            borderRadius: 14, padding: '12px 18px 10px',
            overflow: 'hidden', transition: 'border 0.8s',
          }}>
            <p style={{ fontSize: 8.5, letterSpacing: '0.48em', color: '#0a1828',
              textTransform: 'uppercase', margin: '0 0 8px' }}>
              Temporal Waveform
            </p>
            <TemporalReadout phase={phase} />
          </div>

          {/* Data ticker */}
          <div style={{ flex: '1 1 260px' }}>
            <DataTicker phase={phase} />
          </div>
        </div>
      </section>

      {/* ══ STATE CARDS ══ */}
      <section style={{
        position: 'relative', zIndex: 10,
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
        gap: 14, marginTop: 44,
        maxWidth: 980, width: '95vw', padding: '0 12px',
      }}>
        {PHASES.map(p => {
          const c   = PHASE_CFG[p];
          const sel = phase === p;
          return (
            <button key={p} id={`phase-${p}`}
              onClick={() => { setAuto(false); setPhase(p); }}
              aria-pressed={sel}
              style={{
                flex: '1 1 190px', maxWidth: 218,
                padding: '20px 12px 18px',
                borderRadius: 20, cursor: 'pointer', outline: 'none', fontFamily: 'inherit',
                transition: 'all 0.5s ease',
                border: sel ? `1px solid ${c.hex1}42` : '1px solid rgba(0,180,255,0.06)',
                background: sel
                  ? `linear-gradient(160deg, ${c.hex1}0E 0%, ${c.hex2}09 100%)`
                  : 'rgba(0,8,22,0.58)',
                backdropFilter: 'blur(20px)',
                boxShadow: sel
                  ? `0 8px 36px ${c.hex1}1C, inset 0 1px 0 rgba(255,255,255,0.055)`
                  : '0 4px 20px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.03)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
              <span style={{
                fontSize: 8.5, fontWeight: 700, letterSpacing: '0.42em',
                color: sel ? c.hex1 : '#0d1e3a',
                textTransform: 'uppercase', marginBottom: 10,
                transition: 'color 0.4s',
                textShadow: sel ? `0 0 14px ${c.hex1}88` : 'none',
              }}>{c.label}</span>
              <div style={{ position: 'relative', width: 96, height: 96,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: `radial-gradient(circle, ${c.hex1}18 0%, transparent 70%)`,
                  opacity: sel ? 1 : 0.3, transition: 'opacity 0.5s',
                }} />
                <MiniSingularity phase={p} size={96} />
              </div>
              <p style={{
                color: sel ? c.hex1 : '#0d1e3a', fontSize: 10,
                margin: '12px 0 4px', transition: 'color 0.4s',
                textShadow: sel ? `0 0 8px ${c.hex1}66` : 'none',
                letterSpacing: '0.04em', textAlign: 'center',
              }}>{c.desc}</p>
              <p style={{
                color: sel ? '#1e3a5c' : '#091422', fontSize: 9.5,
                margin: 0, transition: 'color 0.4s', letterSpacing: '0.03em',
                lineHeight: 1.5, textAlign: 'center',
              }}>{c.subdesc.split('·')[0].trim()}</p>
            </button>
          );
        })}
      </section>

      {/* ══ CONTROLS ══ */}
      <div style={{
        position: 'relative', zIndex: 10, marginTop: 40,
        background: 'rgba(0,6,18,0.70)',
        backdropFilter: 'blur(28px)',
        border: '1px solid rgba(0,180,255,0.07)',
        borderRadius: 24, padding: '22px 30px',
        maxWidth: 580, width: '90vw',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {PHASES.map(p => {
            const c   = PHASE_CFG[p];
            const sel = phase === p;
            return (
              <button key={p} id={`pill-${p}`}
                onClick={() => { setAuto(false); setPhase(p); }}
                style={{
                  padding: '7px 20px', borderRadius: 100,
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.3em',
                  textTransform: 'uppercase', cursor: 'pointer',
                  fontFamily: 'inherit', outline: 'none',
                  transition: 'all 0.3s ease',
                  border: sel ? `1.5px solid ${c.hex1}66` : '1.5px solid rgba(0,180,255,0.08)',
                  background: sel ? `${c.hex1}18` : 'rgba(0,8,22,0.5)',
                  color: sel ? c.hex1 : '#0d1e3a',
                  boxShadow: sel ? `0 0 18px ${c.hex1}30` : 'none',
                  textShadow: sel ? `0 0 10px ${c.hex1}AA` : 'none',
                }}>{c.label}
              </button>
            );
          })}
        </div>

        <div style={{ width: '100%', height: 1, background: 'rgba(0,180,255,0.06)' }} />

        <button id="auto-cycle-toggle"
          onClick={() => setAuto(v => !v)}
          style={{
            padding: '9px 26px', borderRadius: 100,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.28em',
            textTransform: 'uppercase', cursor: 'pointer',
            fontFamily: 'inherit', outline: 'none',
            transition: 'all 0.3s ease',
            border: auto ? '1.5px solid rgba(0,230,180,0.45)' : '1.5px solid rgba(0,180,255,0.07)',
            background: auto ? 'rgba(0,230,180,0.09)' : 'rgba(0,8,22,0.5)',
            color: auto ? '#00e8b4' : '#0d1e3a',
            boxShadow: auto ? '0 0 20px rgba(0,230,180,0.2)' : 'none',
            display: 'flex', alignItems: 'center', gap: 9,
          }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
            background: auto ? '#00e8b4' : '#0d2a3a',
            boxShadow: auto ? '0 0 10px #00e8b4' : 'none',
            transition: 'all 0.35s',
          }} />
          {auto ? 'AUTO-CYCLE ACTIVE' : 'CYCLE STATES AUTOMATICALLY'}
        </button>

        <p style={{ color: '#081525', fontSize: 9.5, letterSpacing: '0.16em', margin: 0 }}>
          Select a temporal state · or enable auto-cycle
        </p>
      </div>

      <style>{`
        @keyframes dot-pulse {
          0%,100% { opacity:1; transform:scale(1); }
          50%      { opacity:0.28; transform:scale(1.9); }
        }
        @keyframes shimmer {
          0%   { background-position: 0% center; }
          100% { background-position: 250% center; }
        }
      `}</style>
    </main>
  );
}

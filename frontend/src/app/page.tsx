'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ChronosCanvas from '@/components/ChronosCanvas';
import { API_BASE } from "@/config";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

// Analog Clock SVG component for the first "O"
function ClockO({ size = '0.9em', color = '#06C6B3', glowColor = 'rgba(6, 198, 179, 0.42)', isWarpActive = false }: { size?: number | string; color?: string; glowColor?: string; isWarpActive?: boolean }) {
  const [time, setTime] = useState<Date | null>(null);
  const phaseRef = useRef(0);
  const warpAngleRef = useRef(0);
  const [blend, setBlend] = useState(0);

  useEffect(() => {
    setTime(new Date());
    let animationId: number;
    const tick = () => {
      setTime(new Date());
      if (isWarpActive) {
        phaseRef.current += 0.015; // frequency of speed cycle
        // Speed oscillates between 0.5 and 45 degrees per frame
        const speed = 0.5 + 44.5 * (Math.sin(phaseRef.current) + 1) * 0.5;
        warpAngleRef.current += speed;
      }
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [isWarpActive]);

  useEffect(() => {
    let active = true;
    const animateBlend = () => {
      setBlend(prev => {
        if (isWarpActive) {
          return Math.min(1, prev + 0.025);
        } else {
          return Math.max(0, prev - 0.025);
        }
      });
      if (active) requestAnimationFrame(animateBlend);
    };
    requestAnimationFrame(animateBlend);
    return () => { active = false; };
  }, [isWarpActive]);

  useEffect(() => {
    if (isWarpActive && time) {
      const seconds = time.getSeconds();
      const milliseconds = time.getMilliseconds();
      const smoothSeconds = seconds + milliseconds / 1000;
      warpAngleRef.current = (smoothSeconds / 60) * 360;
    }
  }, [isWarpActive]);

  if (!time) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        style={{ display: 'inline-block', verticalAlign: 'middle' }}
      >
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="#0B0C10"
          stroke={color}
          strokeWidth="3"
        />
      </svg>
    );
  }

  const seconds = time.getSeconds();
  const minutes = time.getMinutes();
  const hours = time.getHours();
  const milliseconds = time.getMilliseconds();

  // Smooth sweep angles
  const smoothSeconds = seconds + milliseconds / 1000;
  const smoothMinutes = minutes + smoothSeconds / 60;
  const smoothHours = hours + smoothMinutes / 60;

  const realSecAngle = (smoothSeconds / 60) * 360 - 90;
  const realMinAngle = (smoothMinutes / 60) * 360 - 90;
  const realHrAngle = ((smoothHours % 12) / 12) * 360 - 90;

  const secondAngle = realSecAngle * (1 - blend) + (warpAngleRef.current - 90) * blend;
  const minuteAngle = realMinAngle * (1 - blend) + (warpAngleRef.current / 12 - 90) * blend;
  const hourAngle = realHrAngle * (1 - blend) + (warpAngleRef.current / 144 - 90) * blend;

  // Helper to get endpoint of a line given angle and length
  const getPoint = (angle: number, length: number) => {
    const rad = (angle * Math.PI) / 180;
    return {
      x2: 50 + length * Math.cos(rad),
      y2: 50 + length * Math.sin(rad),
    };
  };

  const hourHand = getPoint(hourAngle, 20);
  const minuteHand = getPoint(minuteAngle, 28);
  const secondHand = getPoint(secondAngle, 30);

  // Generate 10 trail lines with decaying opacity and strokeWidth
  const trailCount = 10;
  const trailStepAngle = 1.0;
  const trails = [];
  for (let i = 1; i <= trailCount; i++) {
    const trailAngle = secondAngle - i * trailStepAngle;
    const trailPoint = getPoint(trailAngle, 30);
    const opacity = (1 - i / (trailCount + 1)) * 0.45;
    const strokeWidth = 1.8 * (1 - i / (trailCount + 1));
    trails.push({ point: trailPoint, opacity, strokeWidth, key: i });
  }

  const trailStrokeColor = color === '#EF4444'
    ? 'rgba(239, 68, 68, 0.65)'
    : color === '#06C6B3'
      ? 'rgba(6, 198, 179, 0.65)'
      : 'rgba(138, 43, 226, 0.65)';
  const secondHandColor = color === '#EF4444'
    ? '#FF3C00'
    : color === '#06C6B3'
      ? '#8A2BE2'
      : '#66FCF1';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}
    >
      {/* Energy pulse eminating from clock face */}
      {isWarpActive && (
        <circle
          cx="50"
          cy="50"
          r="44"
          stroke={color}
          strokeWidth="1.5"
          fill="none"
          opacity="0.8"
        >
          <animate
            attributeName="r"
            values="44;95"
            dur="1.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.8;0"
            dur="1.4s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Clock face circle */}
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="#0B0C10"
        stroke={color}
        strokeWidth="3"
        style={{ filter: `drop-shadow(0 0 5px ${glowColor}) drop-shadow(0 0 12px ${glowColor})` }}
      />

      {/* Clock ticks */}
      {[...Array(12)].map((_, i) => {
        const angle = (i / 12) * 360;
        const isMajor = i % 3 === 0;
        const rad = (angle * Math.PI) / 180;
        const innerR = isMajor ? 36 : 38;
        const outerR = 42;
        return (
          <line
            key={i}
            x1={50 + innerR * Math.cos(rad)}
            y1={50 + innerR * Math.sin(rad)}
            x2={50 + outerR * Math.cos(rad)}
            y2={50 + outerR * Math.sin(rad)}
            stroke={color}
            strokeWidth={isMajor ? 3 : 1.5}
            opacity={isMajor ? 1 : 0.5}
          />
        );
      })}

      {/* Hour hand */}
      <line
        x1="50"
        y1="50"
        x2={hourHand.x2}
        y2={hourHand.y2}
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${glowColor})` }}
      />

      {/* Minute hand */}
      <line
        x1="50"
        y1="50"
        x2={minuteHand.x2}
        y2={minuteHand.y2}
        stroke={color === '#EF4444' ? '#F87171' : color === '#06C6B3' ? '#66FCF1' : '#c084fc'}
        strokeWidth="3"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${glowColor})` }}
      />

      {/* Second hand trail */}
      {trails.map((t) => (
        <line
          key={t.key}
          x1="50"
          y1="50"
          x2={t.point.x2}
          y2={t.point.y2}
          stroke={trailStrokeColor}
          strokeWidth={t.strokeWidth}
          strokeLinecap="round"
          opacity={t.opacity}
          style={{ filter: `drop-shadow(0 0 2px ${color === '#EF4444' ? 'rgba(239, 68, 68, 0.32)' : 'rgba(138, 43, 226, 0.32)'})` }}
        />
      ))}

      {/* Second hand */}
      <line
        x1="50"
        y1="50"
        x2={secondHand.x2}
        y2={secondHand.y2}
        stroke={secondHandColor}
        strokeWidth="1.8"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color === '#EF4444' ? 'rgba(239, 68, 68, 0.52)' : 'rgba(138, 43, 226, 0.52)'})` }}
      />

      {/* Center dot */}
      <circle cx="50" cy="50" r="3" fill={color} style={{ filter: `drop-shadow(0 0 3px ${glowColor})` }} />
    </svg>
  );
}

// Particle Background Component with mouse repulsion and reactiveness to the singularity (stardust style, Optimized)
export function ParticleBackground({ 
  isRedMode = false, 
  isPurpleMode = false, 
  isWarpActive = false,
  state = 'idle',
  theme = 'main'
}: { 
  isRedMode?: boolean; 
  isPurpleMode?: boolean; 
  isWarpActive?: boolean;
  state?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'warning' | 'offline';
  theme?: 'dashboard' | 'main';
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    defaultVx: number;
    defaultVy: number;
    radius: number;
    alpha: number;
    r: number;
    g: number;
    b: number;
    targetR: number;
    targetG: number;
    targetB: number;
  }>>([]);

  const revolveMultRef = useRef(0.15);
  const forceMultRef = useRef(0.025);
  const waveFreqRef = useRef(1.2);
  const jitterMultRef = useRef(0.0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Dense starry field (900 particles)
    const particleCount = 900;
    
    let colors = ['#06C6B3', '#66FCF1', '#8A2BE2', '#4B0082', '#00FFFF']; // default fallback

    if (isRedMode || state === 'offline') {
      colors = ['#EF4444', '#DC2626', '#991B1B', '#F87171', '#7F1D1D'];
    } else if (state === 'thinking') {
      colors = ['#10B981', '#059669', '#047857', '#34D399', '#064E3B'];
    } else if (state === 'warning') {
      colors = ['#FF3C00', '#FF8C00', '#FFD700', '#FF4500', '#FF6347'];
    } else if (theme === 'dashboard') {
      if (state === 'idle') {
        colors = ['#06C6B3', '#00F0FF', '#00A896', '#66FCF1', '#028090']; // cyan
      } else if (state === 'listening') {
        colors = ['#0099FF', '#007FFF', '#005F9E', '#8CD2FF', '#004080']; // Azure
      } else if (state === 'speaking') {
        colors = ['#2563EB', '#1D4ED8', '#1E3A8A', '#3B82F6', '#1E40AF']; // navy blue
      }
    } else { // theme === 'main'
      if (state === 'idle') {
        // lavender
        colors = ['#DCD0FF', '#B57EDC', '#967BB6', '#E6E6FA', '#7864B4'];
      } else if (state === 'listening') {
        // amethyst
        colors = ['#9966CC', '#8A2BE2', '#6C3082', '#A855F7', '#502878'];
      } else if (state === 'speaking') {
        // dark purple
        colors = ['#8A2BE2', '#4B0082', '#6C3082', '#4A0D66', '#1E003C'];
      } else {
        colors = isPurpleMode 
          ? ['#8A2BE2', '#A855F7', '#C084FC', '#bf5af2', '#4B0082']
          : ['#06C6B3', '#66FCF1', '#8A2BE2', '#4B0082', '#00FFFF'];
      }
    }

    const hexToRgb = (hex: string): [number, number, number] => {
      const h = hex.startsWith('#') ? hex.slice(1) : hex;
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return [r, g, b];
    };

    if (particlesRef.current.length === 0) {
      for (let i = 0; i < particleCount; i++) {
        const vx = (Math.random() - 0.5) * 0.2;
        const vy = (Math.random() - 0.5) * 0.2;
        const colHex = colors[Math.floor(Math.random() * colors.length)];
        const [r, g, b] = hexToRgb(colHex);
        particlesRef.current.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx,
          vy,
          defaultVx: vx,
          defaultVy: vy,
          radius: Math.random() * 2.8 + 1.2, // Bigger stardust particles (1.2px to 4.0px)
          alpha: Math.random() * 0.5 + 0.15,
          r, g, b,
          targetR: r, targetG: g, targetB: b
        });
      }
    } else {
      // Re-assign colors to existing particles without resetting positions!
      for (let i = 0; i < particlesRef.current.length; i++) {
        const colHex = colors[Math.floor(Math.random() * colors.length)];
        const [tr, tg, tb] = hexToRgb(colHex);
        particlesRef.current[i].targetR = tr;
        particlesRef.current[i].targetG = tg;
        particlesRef.current[i].targetB = tb;
      }
    }
    const particles = particlesRef.current;

    let prevMouseX = -9999;
    let prevMouseY = -9999;
    let mouseVx = 0;
    let mouseVy = 0;

    const mouse = {
      x: -9999,
      y: -9999,
      radius: 170, // Repulsion bubble radius
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (prevMouseX !== -9999) {
        const dx = e.clientX - prevMouseX;
        const dy = e.clientY - prevMouseY;
        // Damped velocity calculation to avoid jitter
        mouseVx = dx * 0.22;
        mouseVy = dy * 0.22;
      }
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    const handleMouseLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
      prevMouseX = -9999;
      prevMouseY = -9999;
      mouseVx = 0;
      mouseVy = 0;
    };

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', handleResize);

    let time = 0;

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      time += 0.025;

      // Smoothly transition global physics parameters to avoid snaps
      let targetRevolveMult = 0.7;
      if (state === 'offline') targetRevolveMult = 0.05;
      else if (state === 'idle') targetRevolveMult = 0.15;
      else if (state === 'listening') targetRevolveMult = 1.2;
      else if (state === 'thinking') targetRevolveMult = 2.2;
      else if (state === 'speaking') targetRevolveMult = 1.0;

      let targetForceMult = 0.12;
      let targetWaveFreq = 1.8;
      if (state === 'offline') {
        targetForceMult = 0.0;
      } else if (state === 'idle') {
        targetForceMult = 0.025;
        targetWaveFreq = 1.2;
      } else if (state === 'listening') {
        targetForceMult = 0.18;
        targetWaveFreq = 2.5;
      } else if (state === 'thinking') {
        targetForceMult = 0.30;
        targetWaveFreq = 4.0;
      } else if (state === 'speaking') {
        targetForceMult = 0.22;
        targetWaveFreq = 2.0;
      }

      let targetJitterMult = 0.0;
      if (state === 'listening') targetJitterMult = 0.15;
      else if (state === 'thinking') targetJitterMult = 2.0;

      revolveMultRef.current += (targetRevolveMult - revolveMultRef.current) * 0.035;
      forceMultRef.current += (targetForceMult - forceMultRef.current) * 0.035;
      waveFreqRef.current += (targetWaveFreq - waveFreqRef.current) * 0.035;
      jitterMultRef.current += (targetJitterMult - jitterMultRef.current) * 0.035;

      const revolveMult = revolveMultRef.current;
      const forceMult = forceMultRef.current;
      const waveFreq = waveFreqRef.current;
      const jitterMult = jitterMultRef.current;

      // Decelerate mouse velocity frame-by-frame
      mouseVx *= 0.94;
      mouseVy *= 0.94;

      // Scroll parallax factor
      const scrollOffset = window.scrollY * 0.45;
      const centerX = width / 2;
      const centerY = height / 2;

      // Get the actual position of the singularity core relative to the viewport
      const coreElement = document.getElementById("chronos-singularity-core");
      let blobX = centerX;
      let blobY = centerY;
      if (coreElement) {
        const rect = coreElement.getBoundingClientRect();
        blobX = rect.left + rect.width / 2;
        blobY = rect.top + rect.height / 2;
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (isWarpActive) {
          // Vortex gravity swirl pull effect towards center of screen
          const dx = centerX - p.x;
          const dy = centerY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          if (dist < 40) {
            // Respawn at a random screen edge to keep vortex active
            if (Math.random() > 0.5) {
              p.x = Math.random() > 0.5 ? 0 : width;
              p.y = Math.random() * height;
            } else {
              p.x = Math.random() * width;
              p.y = Math.random() > 0.5 ? 0 : height;
            }
            p.vx = (Math.random() - 0.5) * 0.2;
            p.vy = (Math.random() - 0.5) * 0.2;
          } else {
            // Spiral pull force (gravitational draw + rotational tangent offset)
            const pull = 0.045;
            const swirl = 0.145;
            p.vx += (dx / dist) * pull - (dy / dist) * swirl;
            p.vy += (dy / dist) * pull + (dx / dist) * swirl;

            // Cap velocities to keep spiral neat
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            const maxWarpSpeed = 5.2;
            if (speed > maxWarpSpeed) {
              p.vx = (p.vx / speed) * maxWarpSpeed;
              p.vy = (p.vy / speed) * maxWarpSpeed;
            }
          }

          p.x += p.vx;
          p.y += p.vy;
        } else {
          // Standard drift update
          p.x += p.vx;
          p.y += p.vy;

          // Smoothly ease velocities back to baseline drift (dampened return)
          p.vx += (p.defaultVx - p.vx) * 0.075;
          p.vy += (p.defaultVy - p.vy) * 0.075;

          // React to the centered anomaly/blob (dynamic tracking) - only when on dashboard or has memory (blob active)
          if (theme === 'dashboard' || isPurpleMode) {
            const dxBlob = p.x - blobX;
            // Calculate drawY for scroll-corrected calculations
            let drawY = p.y - scrollOffset;
            drawY = ((drawY % height) + height) % height;
            const dyBlob = drawY - blobY;
            const distBlob = Math.sqrt(dxBlob * dxBlob + dyBlob * dyBlob) || 1;

            // reactionRadius covers the entire screen width/height!
            const reactionRadius = Math.max(width, height) * 0.95;
            if (distBlob < reactionRadius) {
              const angle = Math.atan2(dyBlob, dxBlob);
              const normalizedDist = distBlob / reactionRadius; // 0 to 1

              // 1. Revolution around the anomaly (faster near center, power function drop-off)
              const distFactor = Math.pow(1 - normalizedDist, 2.5);

              const revolveSpeed = 0.009 * revolveMult * distFactor;
              p.vx += -Math.sin(angle) * revolveSpeed;
              p.vy += Math.cos(angle) * revolveSpeed;

              // 2. Unstable Attraction & Repulsion (Fluctuating/pulsing)
              const wave = Math.sin(time * waveFreq + distBlob * 0.015 + i * 0.15);
              const push = wave * forceMult * distFactor;
              p.vx += (dxBlob / distBlob) * push;
              p.vy += (dyBlob / distBlob) * push;

              // 3. Jitter / Erratic movements
              if (jitterMult > 0.01) {
                p.vx += (Math.random() - 0.5) * jitterMult * distFactor;
                p.vy += (Math.random() - 0.5) * jitterMult * distFactor;
              }

              // 4. Overcrowding containment: repulse strongly when too close to the central blob
              const minContainmentRadius = 150;
              if (distBlob < minContainmentRadius) {
                const containmentForce = (minContainmentRadius - distBlob) * 0.15;
                p.vx += (dxBlob / distBlob) * containmentForce;
                p.vy += (dyBlob / distBlob) * containmentForce;
              }
            }
          }

          // Screen wrap (spawn back on the opposite side of screen)
          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;
        }

        // Visual Y position with scroll parallax
        let drawY = p.y - scrollOffset;
        drawY = ((drawY % height) + height) % height;

        // Mouse repulsion & sweep (only when not warping, so warp takes precedence)
        if (!isWarpActive) {
          const dx = p.x - mouse.x;
          const dy = drawY - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < mouse.radius) {
            const force = (mouse.radius - dist) / mouse.radius;
            const angle = Math.atan2(dy, dx);
            
            // Scale push by speed of the mouse cursor
            const mouseSpeed = Math.sqrt(mouseVx * mouseVx + mouseVy * mouseVy);
            const velocityFactor = Math.min(3.0, Math.max(0.4, mouseSpeed * 0.45));
            
            // Repulsion push
            const pushForce = force * force * 0.09 * velocityFactor;
            p.vx += Math.cos(angle) * pushForce;
            p.vy += Math.sin(angle) * pushForce;

            // Drag sweep (push particles along cursor movement vector)
            const dragForce = force * 0.25;
            p.vx += mouseVx * dragForce;
            p.vy += mouseVy * dragForce;
          }
        }

        // Lerp color
        p.r += (p.targetR - p.r) * 0.035;
        p.g += (p.targetG - p.g) * 0.035;
        p.b += (p.targetB - p.b) * 0.035;

        const rgbStr = `rgb(${Math.round(p.r)}, ${Math.round(p.g)}, ${Math.round(p.b)})`;

        // Draw central core
        ctx.beginPath();
        ctx.arc(p.x, drawY, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = rgbStr;
        ctx.globalAlpha = p.alpha;
        ctx.fill();

        // Draw soft, translucent outer halo glow for larger stars
        if (p.radius > 2.0) {
          ctx.beginPath();
          ctx.arc(p.x, drawY, p.radius * 2.4, 0, Math.PI * 2);
          ctx.fillStyle = rgbStr;
          ctx.globalAlpha = p.alpha * 0.26;
          ctx.fill();
        }
      }

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
    };
  }, [isRedMode, isPurpleMode, isWarpActive, state, theme]);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" style={{ mixBlendMode: 'screen' }} />;
}

// Custom parser to format and style the Identity Scan summary beautifully
const renderFormattedSummary = (summary: string) => {
  if (!summary) return null;

  // Extract sections
  let riskLevel = "";
  let riskDescription = "";
  let peakHours = "";
  let motivationStrategy = "";

  const riskMatch = summary.match(/Procrastination Risk Level:\s*([A-Za-z]+)\.?\s*([\s\S]*?)(?=Typical Productivity Peak Hours:|$)/i);
  if (riskMatch) {
    riskLevel = riskMatch[1].trim();
    riskDescription = riskMatch[2].trim();
  }

  const peakMatch = summary.match(/Typical Productivity Peak Hours:\s*([\s\S]*?)(?=Tailored Motivation Strategy:|$)/i);
  if (peakMatch) {
    peakHours = peakMatch[1].trim();
  }

  const motivationMatch = summary.match(/Tailored Motivation Strategy:\s*([\s\S]*)/i);
  if (motivationMatch) {
    motivationStrategy = motivationMatch[1].trim();
  }

  // Fallback if parsing fails (in case the prompt format varies slightly)
  if (!riskLevel && !peakHours && !motivationStrategy) {
    return (
      <div className="text-gray-300 font-sans text-xs md:text-sm leading-relaxed whitespace-pre-wrap space-y-4">
        {summary}
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans text-left">
      {/* Risk Level section */}
      {riskLevel && (
        <div className="bg-black/35 border border-white/5 rounded-2xl p-4.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Procrastination Risk Level</span>
            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
              riskLevel.toLowerCase() === 'high' ? 'bg-red-950/40 border-red-500/40 text-red-400' :
              riskLevel.toLowerCase() === 'medium' ? 'bg-yellow-950/40 border-yellow-500/40 text-yellow-400' :
              'bg-green-950/40 border-green-500/40 text-green-400'
            }`}>
              {riskLevel}
            </span>
          </div>
          {riskDescription && (
            <p className="text-[11px] text-gray-300 leading-relaxed">
              {riskDescription}
            </p>
          )}
        </div>
      )}

      {/* Peak Hours section */}
      {peakHours && (
        <div className="bg-black/35 border border-white/5 rounded-2xl p-4.5 space-y-1.5">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Peak Focus Window</span>
          <div className="flex items-center gap-2 text-xs text-[#06C6B3] font-bold uppercase tracking-wide">
            <span>⚡</span>
            <span>{peakHours}</span>
          </div>
        </div>
      )}

      {/* Motivation Strategy section */}
      {motivationStrategy && (
        <div className="bg-black/35 border border-white/5 rounded-2xl p-4.5 space-y-2">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Tailored Motivation Strategy</span>
          <p className="text-[11px] text-gray-300 leading-relaxed">
            {motivationStrategy}
          </p>
        </div>
      )}
    </div>
  );
};

const renderFormattedText = (text: string) => {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    let cleaned = line.trim();
    if (!cleaned) return <div key={i} className="h-2" />;
    
    // Format headers
    if (cleaned.startsWith('###')) {
      return <h4 key={i} className="text-sm font-bold text-white mt-4 mb-2 uppercase tracking-wider">{cleaned.replace(/^###\s*/, '')}</h4>;
    }
    if (cleaned.startsWith('##')) {
      return <h3 key={i} className="text-base font-black text-purple-400 mt-5 mb-2 uppercase tracking-widest">{cleaned.replace(/^##\s*/, '')}</h3>;
    }
    if (cleaned.startsWith('#')) {
      return <h2 key={i} className="text-lg font-black text-[#66FCF1] mt-6 mb-3 uppercase tracking-widest">{cleaned.replace(/^#\s*/, '')}</h2>;
    }
    
    // Format bullet points
    let isBullet = false;
    if (cleaned.startsWith('-') || cleaned.startsWith('*')) {
      cleaned = cleaned.replace(/^[-\*]\s*/, '');
      isBullet = true;
    }
    
    // Inline bold formatting replacement: **text** -> bold span
    const parts = cleaned.split('**');
    const contentElements = parts.map((part, idx) => {
      if (idx % 2 === 1) {
        return <strong key={idx} className="font-extrabold text-[#66FCF1]">{part}</strong>;
      }
      return part;
    });
    
    if (isBullet) {
      return (
        <div key={i} className="flex items-start gap-2 ml-4 my-1 font-sans text-xs text-gray-300">
          <span className="text-purple-400 mt-1">•</span>
          <span>{contentElements}</span>
        </div>
      );
    }
    
    return (
      <p key={i} className="text-xs font-sans leading-relaxed text-gray-300 my-1.5">
        {contentElements}
      </p>
    );
  });
};

export default function Home() {
  const [showQuestions, setShowQuestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'intro' | 'settings' | 'about' | 'questions' | 'done'>('intro');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const trollChatEndRef = useRef<HTMLDivElement>(null);

  const isWarpActive = false;
  const setIsWarpActive = (val: boolean) => {};
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(true);

  useEffect(() => {
    setIsTransitioning(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step]);

  // Escape key event listener to exit warp logo mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsWarpActive(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navigateTo = (path: string) => {
    localStorage.removeItem("chronos-onboarding-in-progress");
    setIsTransitioning(true);
    setTimeout(() => {
      router.push(path);
    }, 450);
  };

  // Developer mode bypass toggle
  const [isDevMode, setIsDevMode] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [connectionError, setConnectionError] = useState<string>("");
  const [recheckTrigger, setRecheckTrigger] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  // AI Configurations (Defaulting to Gemini as the first choice)
  const [aiConfig, setAiConfig] = useState({
    provider: 'gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    model: 'gemini-1.5-flash',
    maxQuestions: 7, // default 7
  });

  const generateRandomNtfyTopic = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let rand = '';
    for (let i = 0; i < 6; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `chronos_alerts_${rand}`;
  };

  const [username, setUsername] = useState('user');
  const [hasMemory, setHasMemory] = useState(false);
  const [openHomeSettings, setOpenHomeSettings] = useState(false);
  const [mainOrbState, setMainOrbState] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'offline'>('offline');
  const [voiceDaemonOnline, setVoiceDaemonOnline] = useState(false);
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);
  const [devOverrideState, setDevOverrideState] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'offline' | null>(null);
  const [settingsTab, setSettingsTab] = useState<'ai' | 'phone' | 'twin' | 'dev'>('ai');
  const [sleepStart, setSleepStart] = useState<number>(23);
  const [sleepEnd, setSleepEnd] = useState<number>(7);
  const [scanError, setScanError] = useState<string | null>(null);
  const [ntfyTopic, setNtfyTopic] = useState<string>(() => {
    // Generate a random topic by default to be secure
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let rand = '';
    for (let i = 0; i < 6; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `chronos_alerts_${rand}`;
  });
  const devOverrideStateRef = useRef(devOverrideState);
  
  useEffect(() => {
    devOverrideStateRef.current = devOverrideState;
  }, [devOverrideState]);

  // Lock body scroll when settings is open, and auto-set active tab to dev on onboarding
  useEffect(() => {
    if (openHomeSettings) {
      document.body.style.overflow = 'hidden';
      if (!hasMemory) {
        setSettingsTab('dev');
      }
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [openHomeSettings, hasMemory]);

  const getMainThemeColors = (state: string) => {
    switch (state) {
      case 'offline':
        return { accent: '#EF4444', shadow: 'rgba(239, 68, 68, 0.4)', hover: '#F87171' };
      case 'listening':
        return { accent: hasMemory ? '#9966CC' : '#0099FF', shadow: hasMemory ? 'rgba(153, 102, 204, 0.4)' : 'rgba(0, 153, 255, 0.4)', hover: hasMemory ? '#B88FEB' : '#33ADFF' };
      case 'thinking':
        return { accent: '#10B981', shadow: 'rgba(16, 185, 129, 0.4)', hover: '#34D399' };
      case 'speaking':
        return { accent: hasMemory ? '#8A2BE2' : '#2563EB', shadow: hasMemory ? 'rgba(138, 43, 226, 0.4)' : 'rgba(37, 99, 235, 0.4)', hover: hasMemory ? '#a23df5' : '#60A5FA' };
      default:
        return hasMemory
          ? { accent: '#8A2BE2', shadow: 'rgba(138, 43, 226, 0.3)', hover: '#a23df5' }
          : { accent: '#06C6B3', shadow: 'rgba(6, 198, 179, 0.3)', hover: '#0dfcdc' };
    }
  };

  const resolvedOrbState = connectionStatus === 'offline'
    ? 'offline'
    : (mainOrbState === 'offline' ? 'idle' : mainOrbState);

  const currentThemeColors = getMainThemeColors(resolvedOrbState);
  const accentColor = currentThemeColors.accent;
  const shadowColor = currentThemeColors.shadow;
  const hoverColor = currentThemeColors.hover;

  // Load saved config and username on mount
  useEffect(() => {
    // Fetch backend settings (username, sleep hours)
    fetch(`${API_BASE}/api/settings`)
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        if (data.username) {
          setUsername(data.username);
          localStorage.setItem('chronos-username', data.username);
        }
        if (data.twinProfile) {
          localStorage.setItem('chronos-performance-twin', data.twinProfile);
          setHasMemory(true);
        }
        if (data.sleepStart !== undefined) setSleepStart(data.sleepStart);
        if (data.sleepEnd !== undefined) setSleepEnd(data.sleepEnd);
        if (data.ntfyTopic !== undefined && data.ntfyTopic.trim() !== '' && !data.ntfyTopic.startsWith('chronos-alerts-')) {
          setNtfyTopic(data.ntfyTopic);
          localStorage.setItem('chronos-ntfy-topic', data.ntfyTopic);
        } else {
          const rand = generateRandomNtfyTopic();
          setNtfyTopic(rand);
          localStorage.setItem('chronos-ntfy-topic', rand);
        }
        if (data.aiProvider) {
          const config = {
            provider: data.aiProvider,
            apiUrl: data.aiApiUrl || '',
            apiKey: data.aiApiKey || '',
            model: data.aiModel || 'gemini-1.5-flash',
            maxQuestions: 7
          };
          setAiConfig(config);
          localStorage.setItem('chronos-ai-config', JSON.stringify(config));
        }
      })
      .catch(err => {
        console.warn("Failed to fetch settings from backend", err);
        const savedName = localStorage.getItem('chronos-username');
        if (savedName) {
          setUsername(savedName);
        }
      });

    const savedName = localStorage.getItem('chronos-username');
    const savedTwin = localStorage.getItem('chronos-performance-twin');
    if (savedName && savedTwin) {
      setHasMemory(true);
    }

    const saved = localStorage.getItem('chronos-ai-config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.provider) {
          setAiConfig(prev => ({ ...prev, ...parsed }));
        }
      } catch (e) {
        console.error("Failed to parse saved config", e);
      }
    }
  }, []);


  useEffect(() => {
    const checkVoiceStatus = async () => {
      if (devOverrideStateRef.current !== null) return;
      try {
        const res = await fetch(`${API_BASE}/api/voice/status`);
        if (!res.ok) throw new Error("Offline");
        const data = await res.json();
        
        const isOnline = data.voice_link === 'online';
        setVoiceDaemonOnline(isOnline);
        if (!isOnline) {
          setMainOrbState(prev => prev !== 'offline' ? 'offline' : prev);
        } else {
          setMainOrbState(prev => prev === 'offline' ? 'idle' : prev);
        }
      } catch (err) {
        setVoiceDaemonOnline(false);
        setMainOrbState(prev => prev !== 'offline' ? 'offline' : prev);
      }
    };

    checkVoiceStatus();
    const interval = setInterval(checkVoiceStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const sendHeartbeat = async () => {
      try {
        await fetch('http://127.0.0.1:43210/heartbeat', { mode: 'cors' });
      } catch (e) {
        // Ignore connection failures when daemon is not running
      }
    };
    sendHeartbeat();
    interval = setInterval(sendHeartbeat, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/api/voice/events`);

    eventSource.onmessage = (event) => {
      if (devOverrideStateRef.current !== null) return;
      try {
        const data = JSON.parse(event.data);
        console.log("[Voice Link Event - Main Page]", data);
        
        if (data.status === 'listening') {
          setMainOrbState('listening');
        } else if (data.status === 'transcribing' || data.status === 'thinking') {
          setMainOrbState('thinking');
        } else if (data.status === 'speaking') {
          setMainOrbState('speaking');
        } else if (data.status === 'idle') {
          setMainOrbState('idle');
        } else if (data.status === 'redirect') {
          if (data.target) {
            router.push(data.target);
          }
        }
      } catch (err) {
        console.error("Failed to parse voice event on main page:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("Voice SSE error on main page, will reconnect...", err);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Onboarding Chat State
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>([]);
  const [userInput, setUserInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [questionsCount, setQuestionsCount] = useState(0);
  const [profileSummary, setProfileSummary] = useState('');

  // Bullshit Detected Mode State
  const [isBullshitMode, setIsBullshitMode] = useState(false);
  const [bullshitBranch, setBullshitBranch] = useState<'none' | 'prompt' | 'active'>('none');
  const [trollHistory, setTrollHistory] = useState<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>([]);
  const [savedPreBullshitState, setSavedPreBullshitState] = useState<{
    chatHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    questionsCount: number;
  } | null>(null);

  const checkIsBullshit = (input: string): boolean => {
    const clean = input.trim().toLowerCase();
    
    // Allow digits/numbers/percentages (e.g. "8/10", "8", "80%")
    if (/\d/.test(clean)) return false;
    
    // Allow common short replies to questionnaire
    const validShortReplies = [
      'yes', 'no', 'none', 'nothing', 'maybe', 'never', 'always', 'sometimes', 
      'often', 'usually', 'seldom', 'rarely', 'high', 'medium', 'low', 'procrastinate',
      'work', 'study', 'sleep', 'coding', 'programming', 'reading', 'writing'
    ];
    if (validShortReplies.includes(clean)) return false;

    // 1. Extreme short length check
    if (clean.length < 3) return true;
    
    // 2. Keyboard smash / repeating characters
    if (/^(.)\1{2,}$/.test(clean)) return true; // e.g. "aaa", "zzz"
    if (/^[asdfghjklqwertyuiopzxcvbnm]+$/.test(clean) && (
      clean.includes('asdf') || clean.includes('qwerty') || clean.includes('zxcv') || 
      clean.includes('jkl;') || clean.includes('qwer') || clean.includes('asdfg')
    )) return true;
    
    // 3. Consonants smash (mostly no vowels)
    const vowels = clean.match(/[aeiouy]/g);
    const vowelRatio = vowels ? vowels.length / clean.length : 0;
    if (clean.length > 4 && vowelRatio < 0.15) return true; // e.g. "hmmm", "sdfgh"
    
    // 4. Low-effort check (Only flag extremely empty or zero-word inputs)
    const words = clean.split(/[\s,.]+/).filter(w => w.length > 0);
    if (words.length === 0) return true;
    
    // 5. Repetitive word check
    if (words.length >= 3) {
      const uniqueWords = new Set(words);
      if (uniqueWords.size <= 1) return true; // e.g. "work work work"
    }

    // 6. Generic low-effort troll / vague list
    const lowEffortTrolls = [
      'your mom', 'your mother', 'you suck', 'potato', 'banana', 'bullshit', 'fuck off', 
      'screw you', 'whatever', 'blah', 'blah blah', 'nothing much', 'not much', 'dunno', 'idk', 
      'ok', 'okay', 'fine', 'sure', 'stuff', 'things', 'hello', 'hi', 'hey', 'normal', 'regular', 
      'average', 'nothing really'
    ];
    if (lowEffortTrolls.includes(clean) || lowEffortTrolls.some(troll => clean === troll)) return true;
    
    return false;
  };

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({
        x: (e.clientX / window.innerWidth) - 0.5,
        y: (e.clientY / window.innerHeight) - 0.5,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Auto-scroll inside the active troll chat terminal
  useEffect(() => {
    if (trollChatEndRef.current) {
      trollChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [trollHistory, chatLoading]);

  // Ultra-Smooth Kinetic Scroll Interpolation (disabled for registered users)
  useEffect(() => {
    if (hasMemory) return;

    let targetScrollY = window.scrollY;
    let currentScrollY = window.scrollY;
    let isMoving = false;
    const ease = 0.075; // Kinetic damping

    const handleWheel = (e: WheelEvent) => {
      // Allow standard scroll when interacting with textareas or dropdowns/inputs
      const activeEl = document.activeElement?.tagName;
      if (activeEl === 'TEXTAREA' || activeEl === 'SELECT' || activeEl === 'INPUT') {
        return;
      }
      e.preventDefault();
      
      targetScrollY += e.deltaY * 0.95;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      targetScrollY = Math.max(0, Math.min(targetScrollY, maxScroll));

      if (!isMoving) {
        isMoving = true;
        requestAnimationFrame(updateScroll);
      }
    };

    const updateScroll = () => {
      const diff = targetScrollY - currentScrollY;
      currentScrollY += diff * ease;

      if (Math.abs(diff) > 0.4) {
        window.scrollTo(0, currentScrollY);
        requestAnimationFrame(updateScroll);
      } else {
        window.scrollTo(0, targetScrollY);
        currentScrollY = targetScrollY;
        isMoving = false;
      }
    };

    const handleScrollTo = (e: Event) => {
      const customEvent = e as CustomEvent<number>;
      targetScrollY = customEvent.detail;
      if (!isMoving) {
        isMoving = true;
        requestAnimationFrame(updateScroll);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('smooth-scroll-to', handleScrollTo);

    const handleScroll = () => {
      if (!isMoving) {
        targetScrollY = window.scrollY;
        currentScrollY = window.scrollY;
      }
    };
    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('smooth-scroll-to', handleScrollTo);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [hasMemory]);

  // Detect when user scrolls past the hero section (disabled for registered users)
  useEffect(() => {
    if (hasMemory) return;

    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            setShowQuestions(true);
            setStep(prev => prev === 'intro' ? 'settings' : prev);
          }, 300);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMemory]);

  const handleScrollClick = () => {
    const nextSectionY = window.innerHeight;
    const scrollEvent = new CustomEvent('smooth-scroll-to', { detail: nextSectionY });
    window.dispatchEvent(scrollEvent);
  };

  const handleStartInitialization = () => {
    setStep('settings');
    setShowQuestions(true);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalNtfyTopic = ntfyTopic;
    if (finalNtfyTopic.startsWith('chronos-alerts-') || !finalNtfyTopic.trim()) {
      finalNtfyTopic = generateRandomNtfyTopic();
      setNtfyTopic(finalNtfyTopic);
    }
    localStorage.setItem('chronos-ai-config', JSON.stringify(aiConfig));
    localStorage.setItem('chronos-username', username);
    localStorage.setItem('chronos-ntfy-topic', finalNtfyTopic);
    
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          sleepStart: Number(sleepStart),
          sleepEnd: Number(sleepEnd),
          ntfyTopic: finalNtfyTopic,
          twinProfile: localStorage.getItem('chronos-performance-twin') || ""
        })
      });
    } catch (err) {
      console.warn("Failed to sync settings during onboarding setup", err);
    }
    
    setStep('about');
  };

  const handleStartScan = () => {
    setStep('questions');
    startIdentityScan();
  };

  const getLastQuestion = () => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].role === 'assistant') {
        return chatHistory[i].content;
      }
    }
    return "Initializing scan...";
  };

  const handleBypassOnboarding = () => {
    localStorage.setItem('chronos-ai-config', JSON.stringify(aiConfig));
    if (step !== 'questions') {
      setStep('questions');
      startIdentityScan();
    } else {
      if (isTyping || chatLoading) return;
      
      const PRESET_ANSWERS = [
        "My name is Akash. I am the developer of Chronos and a software engineer. My daily routine is highly focused on writing clean code, building aesthetic interfaces, and debugging system components.",
        "My peak focus hours are in the morning between 9:30 AM and 11:30 AM, and then later in the evening between 8:30 PM and 10:30 PM. During these times, I feel most alert and can solve complex engineering problems without feeling tired.",
        "My main procrastination triggers are vague or undefined tasks without clear milestones, which leads to analysis paralysis. When distracted, I check social media on my phone, browse technical blogs, or watch YouTube videos.",
        "My primary motivation style is a mix of visual completion (crossing tasks off a list) and AI coaching warnings. I work well with deadline pressure but prefer structured micro-sprints.",
        "Yes, that is correct. Please finalize the scan and generate my twin profile now."
      ];
      
      const answer = PRESET_ANSWERS[questionsCount - 1] || "Yes, that is correct. Please finalize the scan and generate my twin profile now.";
      
      setIsTyping(true);
      let currentLength = 0;
      setUserInput("");
      
      const typingInterval = setInterval(() => {
        currentLength += 3;
        if (currentLength >= answer.length) {
          setUserInput(answer);
          clearInterval(typingInterval);
          setTimeout(() => {
            handleSendAnswer(undefined, answer);
            setIsTyping(false);
          }, 200);
        } else {
          setUserInput(answer.slice(0, currentLength));
        }
      }, 10);
    }
  };
  const handleInstantBypass = async () => {
    const finalUsername = 'Akash';
    const finalSleepStart = 23;
    const finalSleepEnd = 7;
    let finalNtfyTopic = ntfyTopic;
    if (finalNtfyTopic.startsWith('chronos-alerts-') || !finalNtfyTopic.trim()) {
      finalNtfyTopic = generateRandomNtfyTopic();
    }

    setUsername(finalUsername);
    setSleepStart(finalSleepStart);
    setSleepEnd(finalSleepEnd);
    setNtfyTopic(finalNtfyTopic);

    localStorage.setItem('chronos-ai-config', JSON.stringify(aiConfig));
    localStorage.setItem('chronos-username', finalUsername);
    localStorage.setItem('chronos-ntfy-topic', finalNtfyTopic);

    const summary = "Performance Twin Profile:\n- User: Akash\n- Role: Software Engineer & Developer of Chronos\n- Style: Aesthetic perfectionist who values visual completion and high-fidelity interface feedback.\n- Productivity Peaks: Focus peaks during late evening (8:30 PM - 10:30 PM) and mid-morning (9:30 AM - 11:30 AM).\n- Procrastination Triggers: Prone to analysis paralysis and postponement on vague, administrative, or poorly defined tasks.\n- Procrastination Rating: 6.0/10";

    setProfileSummary(summary);
    localStorage.setItem('chronos-performance-twin', summary);
    localStorage.setItem('chronos-procrastination-rating', '6.0');
    localStorage.setItem('chronos-attention-cycle', "Focus cycles peak late evening");
    localStorage.setItem('chronos-stress-response', "Postpones tasks under high workload pressure");
    
    setHasMemory(true);
    setStep('intro');
    setShowQuestions(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: finalUsername,
          sleepStart: finalSleepStart,
          sleepEnd: finalSleepEnd,
          ntfyTopic: finalNtfyTopic,
          twinProfile: summary,
          procrastinationRating: 6.0,
          attentionCycle: "Focus cycles peak late evening",
          stressResponse: "Postpones tasks under high workload pressure"
        })
      });
    } catch (err) {
      console.warn("Failed to sync settings on instant bypass", err);
    }
  };

  const handleSpawnLocalDaemon = async () => {
    const toastId = toast.loading("Launching local Voice Daemon subprocess...");
    try {
      const res = await fetch(`${API_BASE}/api/voice/start-local-daemon`, {
        method: 'POST'
      });
      if (res.ok) {
        toast.dismiss(toastId);
        toast.success("Voice Daemon command spawned! Connecting...");
      } else {
        toast.dismiss(toastId);
        toast.error("Failed to spawn local Voice Daemon. Make sure you run it manually.");
        setShowDownloadPrompt(true);
      }
    } catch (e) {
      toast.dismiss(toastId);
      toast.error("Failed to spawn local Voice Daemon. Make sure you run it manually.");
      setShowDownloadPrompt(true);
    }
  };

  const handleChangeGoogleAccount = async () => {
    const toastId = toast.loading("Resetting calendar link...");
    try {
      const res = await fetch(`${API_BASE}/api/calendar/logout`, {
        method: 'POST'
      });
      if (res.ok) {
        toast.dismiss(toastId);
        toast.info("Calendar token reset. Connecting to Google OAuth...");
        await handleSyncGoogleCalendar();
      } else {
        toast.dismiss(toastId);
        toast.error("Failed to reset Google Calendar account.");
      }
    } catch (e) {
      toast.dismiss(toastId);
      toast.error("Failed to reset Google Calendar account.");
    }
  };

  const handleSyncGoogleCalendarDirect = async () => {
    const toastId = toast.loading("Syncing Google Calendar events...");
    try {
      const res = await fetch(`${API_BASE}/api/calendar/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontend_origin: window.location.origin })
      });
      if (res.ok) {
        const data = await res.json();
        toast.dismiss(toastId);
        if (data.count > 0) {
          toast.success(`Synced Google Calendar: Imported ${data.count} Locked Exams.`);
        } else {
          toast.info("Google Calendar is up to date.");
        }
      } else {
        toast.dismiss(toastId);
        toast.error("Google Calendar sync failed.");
      }
    } catch (err) {
      toast.dismiss(toastId);
      toast.error("Google Calendar sync failed.");
    }
  };

  const handleSyncGoogleCalendar = async () => {
    const toastId = toast.loading("Syncing Google Calendar events...");
    try {
      const res = await fetch(`${API_BASE}/api/calendar/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontend_origin: window.location.origin })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'auth_required') {
          toast.dismiss(toastId);
          const popup = window.open(data.url, 'ChronosGoogleAuth', 'width=600,height=700');
          
          const handleAuthMessage = async (e: MessageEvent) => {
            if (e.data && e.data.type === 'CHRONOS_GCAL_AUTH_SUCCESS') {
              window.removeEventListener('message', handleAuthMessage);
              toast.success("Google Calendar authenticated! Fetching events...");
              await handleSyncGoogleCalendarDirect();
            }
          };
          window.addEventListener('message', handleAuthMessage);
        } else {
          toast.dismiss(toastId);
          if (data.count > 0) {
            toast.success(`Synced Google Calendar: Imported ${data.count} Locked Exams.`);
          } else {
            toast.info("Google Calendar is up to date.");
          }
        }
      } else {
        toast.dismiss(toastId);
        toast.error("Google Calendar sync failed.");
      }
    } catch (err) {
      toast.dismiss(toastId);
      toast.error("Google Calendar sync failed.");
    }
  };

  // Dynamic Model Fetching & Connectivity Validation Hook
  useEffect(() => {
    if (step !== 'settings' && !openHomeSettings) return;

    let active = true;
    const fetchModelsAndValidate = async () => {
      // Avoid querying with incomplete/empty API keys during typing
      if (aiConfig.provider !== 'custom' && (!aiConfig.apiKey || aiConfig.apiKey.trim().length <= 5)) {
        setConnectionStatus('offline');
        setConnectionError('API Key is incomplete.');
        return;
      }

      setLoadingModels(true);
      setConnectionStatus('checking');
      setConnectionError('');
      setAvailableModels([]);
      try {
        const queryParams = new URLSearchParams({
          provider: aiConfig.provider,
          apiUrl: aiConfig.apiUrl,
          apiKey: aiConfig.apiKey || '',
        });
        const res = await fetch(`${API_BASE}/api/ai/models?${queryParams.toString()}`);
        if (!res.ok) throw new Error("Verification request failed");
        const data = await res.json();
        
        if (active) {
          if (data.offline) {
            setConnectionStatus('offline');
            setConnectionError(
              aiConfig.provider === 'gemini'
                ? "GEMINI OFFLINE: Unreachable or API Key is invalid. Please verify your Google Gemini API Key."
                : aiConfig.provider === 'nvidia'
                  ? "NVIDIA NIM OFFLINE: Unreachable or API Key is invalid. Please verify your NVIDIA API Key (nvapi-...) has active credits and that your internet connection is active."
                  : "CUSTOM CORE OFFLINE: Unreachable or verification failed. Please check your Base URL and settings."
            );
          } else {
            setConnectionStatus('online');
            if (data.models) {
              setAvailableModels(data.models);
              if (!data.models.includes(aiConfig.model)) {
                setAiConfig(prev => ({ ...prev, model: data.models[0] || '' }));
              }
            }
          }
        }
      } catch (err) {
        if (active) {
          setConnectionStatus('offline');
          setConnectionError(
            aiConfig.provider === 'gemini'
              ? "CONNECTION ERROR: Could not reach the Google Gemini API. Verify your API Key and internet connection."
              : aiConfig.provider === 'nvidia'
                ? "CONNECTION ERROR: Could not reach the NVIDIA NIM API. Verify your API Key and internet connection."
                : "CONNECTION ERROR: Could not reach your Custom API endpoint. Verify your Base URL and internet connection."
          );
        }
      } finally {
        if (active) setLoadingModels(false);
      }
    };

    // Debounce the connection checks slightly to handle fast typing overrides
    const delayDebounce = setTimeout(fetchModelsAndValidate, 1500);

    return () => {
      active = false;
      clearTimeout(delayDebounce);
    };
  }, [aiConfig.provider, aiConfig.apiUrl, aiConfig.apiKey, step, openHomeSettings, recheckTrigger]);

  const reset = () => {
    localStorage.clear();
    setStep('intro');
    setShowQuestions(false);
    setChatHistory([]);
    setQuestionsCount(0);
    setProfileSummary('');
    setUsername('user');
    setHasMemory(false);
    setAiConfig({
      provider: 'gemini',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: '',
      model: 'gemini-1.5-flash',
      maxQuestions: 7,
    });
  };

  const handleLockIn = () => {
    setIsBullshitMode(false);
    setBullshitBranch('none');
    if (savedPreBullshitState) {
      setChatHistory(savedPreBullshitState.chatHistory);
      setQuestionsCount(savedPreBullshitState.questionsCount);
    }
    setTrollHistory([]);
    setUserInput('');
  };

  const handleBullshitOn = () => {
    setBullshitBranch('active');
  };

  const handleSendTrollAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || chatLoading) return;

    const msg = userInput.trim();
    setUserInput('');
    setChatLoading(true);

    const updatedTrollHistory = [
      ...trollHistory,
      { role: 'user' as const, content: msg }
    ];
    setTrollHistory(updatedTrollHistory);

    const trollSystemPrompt = `You are not an AI assistant.

You are the friend in the group chat who immediately spots the funniest possible interpretation of every situation.

Your purpose is to create "bro that's insane 💀" moments.

Rules:

- Speak naturally.
- Never sound formal.
- Never use corporate language.
- Never explain the joke.
- Never write like a comedian performing a routine.
- React like a friend witnessing events in real time.
- Keep roasts to a maximum and word count to an absolute minimum (max 10-15 words). Speak in a single punchy line. Never write long paragraphs.

Humor Style:

1. Find the contradiction.
2. Find the delusion.
3. Find the unnecessary complexity.
4. Point at it.
5. Make it 10x funnier.

Examples:

User:
"I have 17 unfinished projects."

Response:
bro your github looks like an archaeological dig site 💀

User:
"I'm starting another startup."

Response:
nah because the previous 4 are still loading 😭

User:
"I built an AI that manages my productivity."

Response:
bro hired an employee because he didn't wanna do his homework 💀

Techniques:

- Fake concern
- Mock admiration
- Overly serious analysis of stupid things
- Absurd comparisons
- Escalation
- Calling out obvious copium

Examples:

"bro got a roadmap so long future civilizations gonna study ts"

"nah because how did you turn a 2 hour task into a multi-agent architecture"

"the project started as a calculator and somehow ended with artificial consciousness"

"your solution got solutions"

"bro fighting side quests generated by side quests"

"at this point the bug is part of the founding team"

Energy:

- Discord VC
- Group chat menace
- Gen Z internet humor
- Friend-to-friend

Priority Order:

Funny > Accurate > Helpful

If something is genuinely ridiculous, acknowledge it.

If something is impressive, roast it anyway.

If something fails, treat it like a historical event.

If something succeeds, act shocked.`;

    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiConfig.provider,
          apiUrl: aiConfig.apiUrl,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          messages: [
            { role: 'system', content: trollSystemPrompt },
            ...updatedTrollHistory
          ]
        })
      });

      if (!res.ok) throw new Error("Offline");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setTrollHistory([...updatedTrollHistory, { role: 'assistant', content: data.content }]);
    } catch (err) {
      // Offline fallback roasts
      const offlineRoasts = [
        "Wow, even my offline mock fails are more productive than your typing skills.",
        "Error 418: I'm a teapot, and you're still writing bullshit.",
        "Your focus metrics are flatlining. Go eat a potato.",
        "Are you still trying? Incredible commitment to wasting my token compute.",
        "Is there someone else I can talk to? Your keyboard is crying."
      ];
      setTrollHistory([...updatedTrollHistory, { role: 'assistant', content: offlineRoasts[Math.floor(Math.random() * offlineRoasts.length)] }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleTrollReturnHome = () => {
    reset();
    setIsBullshitMode(false);
    setBullshitBranch('none');
    setTrollHistory([]);
    setSavedPreBullshitState(null);
  };

  const SYSTEM_PROMPT = `You are Chronos, an AI-powered Deadline Defense System. You are conducting an adaptive "Identity Scan", a conversational onboarding process to build a personalized performance twin of the user.
Your goal is to learn specifically about the user:
- What they do for a living / their daily routine.
- When their free time and peak focus hours are.
- How often they procrastinate and what their primary distractions are (e.g. social media, gaming, fatigue).
- Their main work habits, strengths, and weaknesses.
- Their typical sleep schedule (start hour and end hour in 24h format).
- Their preference for mobile alerts and desired alert channel topic name.

Rules:
1. Ask exactly one short, targeted question at a time. Do NOT ask double-barreled questions.
2. Keep your questions and responses extremely concise (maximum 15-20 words). Do not write conversational preambles, greetings, or filler text. Ask the question directly.
3. If the user mentions their name in their response, please prepend a line "[NAME: User_First_Name]" to the very beginning of your response so the application can save their name.
4. If the user specifies or mentions their sleep schedule (e.g. 11 PM to 7 AM or 23 to 7), please prepend a line "[SLEEP: StartHour-EndHour]" (e.g., "[SLEEP: 23-7]") to the very beginning of your response so the application can save it.
5. If the user specifies or agrees to a mobile alert topic, please prepend a line "[NTFY: topic_name]" (e.g. "[NTFY: chronos-alerts-username]") to the very beginning of your response so the application can save it.
6. Once the scan is complete, summarize their "Performance Twin Profile" containing:
- Procrastination Risk Level (Low/Medium/High) with reasoning.
- Typical Productivity Peak Hours.
- Tailored Motivation Strategy.
Start the final response with "IDENTITY SCAN COMPLETE". (The final profile summary can be longer, but all diagnostic questions must be very short).
7. IF the user's response is absolute bullshit, nonsense, keyboard smashes (e.g. 'asdf', 'qwerty'), trolls, or irrelevant nonsense, you MUST prepend "[BULLSHIT_DETECTED]" to your response and immediately roast them in a highly sarcastic, dry tone. (Note: Short replies like '8/10', '8', 'student', 'developer', 'a lot', 'not much', etc. are NOT bullshit and must be treated as valid answers.)
8. DO NOT HALLUCINATE OR GUESS DETAILS in the final Performance Twin Profile summary. You must compile the profile based strictly and exclusively on the answers the user has provided during this scan. If the user did not specify their peak focus hours, routine details, or distractions, do not make them up; instead, state "Not specified by user" or use the exact facts they mentioned. Keep the profile honest and grounded in the chat history.
9. Every single response before the scan is finalized MUST be a single direct question ending with a question mark (?). Do NOT make statements, state facts, or output hallucinated profile details before you write 'IDENTITY SCAN COMPLETE'. If you are not ready to output 'IDENTITY SCAN COMPLETE', your response MUST end with a question mark (?).`;

  const FIRST_QUESTION = "Welcome to Chronos. To begin your Identity Scan, what is your name, what do you do for a living, and what does your typical daily routine look like?";

  const startIdentityScan = async () => {
    setChatLoading(true);
    setProfileSummary('');
    setChatHistory([{ role: 'assistant' as const, content: FIRST_QUESTION }]);
    setQuestionsCount(1);
    setChatLoading(false);
  };

  const handleSendAnswer = async (e?: React.FormEvent, customInput?: string) => {
    if (e) e.preventDefault();
    const inputToProcess = customInput !== undefined ? customInput.trim() : userInput.trim();
    if (!inputToProcess || chatLoading) return;

    const newUserInput = inputToProcess;
    setUserInput('');
    setChatLoading(true);

    // Client-side bullshit check
    if (checkIsBullshit(newUserInput)) {
      setSavedPreBullshitState({
        chatHistory: chatHistory,
        questionsCount: questionsCount
      });
      const defaultRoasts = [
        "Chronos operates on logic, not keyboard smashes. Try typing like a human.",
        "Your response contains an unauthorized quantity of pure, unadulterated nonsense.",
        "An identity scan requires cognitive patterns, not low-effort trolling. Lock in or face the consequences.",
        "Is this a pocket dial, or are you genuinely trying to scan a potato?",
        "Chronos has detected absolute bullshit. Please select your next action."
      ];
      const randomRoast = defaultRoasts[Math.floor(Math.random() * defaultRoasts.length)];
      setTrollHistory([
        { role: 'assistant', content: randomRoast }
      ]);
      setIsBullshitMode(true);
      setBullshitBranch('prompt');
      setChatLoading(false);
      return;
    }

    // Local regex fallback name extraction on first user response
    if (questionsCount === 1) {
      const match = newUserInput.match(/(?:my name is|i am|i'm|name is|call me)\s+([A-Za-z]+)/i);
      let nameToSave = '';
      if (match && match[1]) {
        nameToSave = match[1];
      } else {
        const words = newUserInput.split(/[\s,.]+/);
        for (const word of words) {
          if (word && /^[A-Z][a-z]+$/.test(word) && !['i', 'my', 'name', 'is', 'im', 'am', 'hello', 'hi', 'a'].includes(word.toLowerCase())) {
            nameToSave = word;
            break;
          }
        }
      }
      if (nameToSave) {
        nameToSave = nameToSave.charAt(0).toUpperCase() + nameToSave.slice(1).toLowerCase();
        localStorage.setItem('chronos-username', nameToSave);
        setUsername(nameToSave);
      }
    }

    const updatedHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      ...chatHistory,
      { role: 'user', content: newUserInput }
    ];
    setChatHistory(updatedHistory);

    const messagesToSend: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...updatedHistory
    ];

    try {
      if (questionsCount >= aiConfig.maxQuestions + 5) {
        messagesToSend.push({ 
          role: 'user', 
          content: 'Identity scan finalized. Please compile your results and output "IDENTITY SCAN COMPLETE" followed by the final Performance Twin Profile summary now.' 
        });
      } else if (questionsCount >= aiConfig.maxQuestions) {
        messagesToSend.push({ 
          role: 'user', 
          content: 'The initial identity scan baseline has been completed. If you have gathered sufficient understanding of the user\'s daily routine, procrastination triggers, and distractions to construct a high-fidelity behavior model, please output "IDENTITY SCAN COMPLETE" followed by their Performance Twin Profile now. Otherwise, you may ask additional clarifying questions to resolve any remaining behavioral uncertainty.' 
        });
      }

      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiConfig.provider,
          apiUrl: aiConfig.apiUrl,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          messages: messagesToSend,
        }),
      });

      let errorMsg = 'API request failed';
      if (!res.ok) {
        try {
          const errData = await res.json();
          if (errData && errData.error) {
            errorMsg = errData.error;
          }
        } catch (e) {}
        throw new Error(errorMsg);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      let reply = data.content;

      // Helper variables to track the current settings values during this update cycle
      let currentUsername = username;
      let currentSleepStart = sleepStart;
      let currentSleepEnd = sleepEnd;
      let currentNtfyTopic = ntfyTopic;

      // Extract name tag if present in the AI's response
      const nameMatch = reply.match(/\[NAME:\s*([A-Za-z0-9_]+)\]/i);
      if (nameMatch && nameMatch[1]) {
        const extractedName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase();
        localStorage.setItem('chronos-username', extractedName);
        setUsername(extractedName);
        currentUsername = extractedName;
        reply = reply.replace(/\[NAME:\s*([A-Za-z0-9_]+)\]/i, '').trim();
      }

      // Extract sleep tag if present in the AI's response (e.g. [SLEEP: 23-7])
      const sleepMatch = reply.match(/\[SLEEP:\s*(\d{1,2})-(\d{1,2})\]/i);
      if (sleepMatch && sleepMatch[1] && sleepMatch[2]) {
        const start = parseInt(sleepMatch[1], 10);
        const end = parseInt(sleepMatch[2], 10);
        setSleepStart(start);
        setSleepEnd(end);
        currentSleepStart = start;
        currentSleepEnd = end;
        localStorage.setItem('chronos-sleep-start', start.toString());
        localStorage.setItem('chronos-sleep-end', end.toString());
        reply = reply.replace(/\[SLEEP:\s*(\d{1,2})-(\d{1,2})\]/i, '').trim();
      }

      // Extract ntfy tag if present in the AI's response (e.g. [NTFY: chronos-alerts-alex])
      const ntfyMatch = reply.match(/\[NTFY:\s*([A-Za-z0-9_-]+)\]/i);
      if (ntfyMatch && ntfyMatch[1]) {
        const topic = ntfyMatch[1].trim();
        setNtfyTopic(topic);
        currentNtfyTopic = topic;
        localStorage.setItem('chronos-ntfy-topic', topic);
        reply = reply.replace(/\[NTFY:\s*([A-Za-z0-9_-]+)\]/i, '').trim();
      }

      // Check if AI detected bullshit
      if (reply.includes('[BULLSHIT_DETECTED]')) {
        const cleanedReply = reply.replace(/\[BULLSHIT_DETECTED\]/i, '').trim();
        setSavedPreBullshitState({
          chatHistory: chatHistory,
          questionsCount: questionsCount
        });
        setTrollHistory([
          { role: 'assistant', content: cleanedReply }
        ]);
        setIsBullshitMode(true);
        setBullshitBranch('prompt');
        setChatLoading(false);
        return;
      }

      if (reply.toUpperCase().includes('IDENTITY SCAN COMPLETE')) {
        const summary = reply.replace(/IDENTITY SCAN COMPLETE/i, '').trim();
        setProfileSummary(summary);
        localStorage.setItem('chronos-performance-twin', summary);
        setHasMemory(true);
        setStep('intro');
        setShowQuestions(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Parse user replies for procrastination rating, attention cycles, and stress responses
        let parsedRating = 8.0;
        let parsedAttention = "Focus cycles peak late evening";
        let parsedStress = "Postpones tasks under high workload pressure";

        updatedHistory.forEach(msg => {
          if (msg.role === 'user') {
            const cleanMsg = msg.content.toLowerCase();
            const match = cleanMsg.match(/(\d+)\s*\/\s*10/);
            if (match && match[1]) {
              parsedRating = Number(match[1]);
            } else {
              const digitMatch = cleanMsg.match(/\b([1-9]|10)\b/);
              if (digitMatch && digitMatch[1]) {
                parsedRating = Number(digitMatch[1]);
              }
            }

            if (cleanMsg.includes('evening') || cleanMsg.includes('night') || cleanMsg.includes('pm')) {
              parsedAttention = "Peak focus occurs in evening/night hours";
            } else if (cleanMsg.includes('morning') || cleanMsg.includes('am')) {
              parsedAttention = "Peak focus occurs in morning hours";
            } else if (cleanMsg.includes('afternoon')) {
              parsedAttention = "Peak focus occurs in afternoon hours";
            }

            if (cleanMsg.includes('stress') || cleanMsg.includes('pressure') || cleanMsg.includes('worry') || cleanMsg.includes('anxiety') || cleanMsg.includes('load')) {
              parsedStress = "Vulnerable to task avoidance under high pressure";
            }
          }
        });

        localStorage.setItem('chronos-procrastination-rating', String(parsedRating));
        localStorage.setItem('chronos-attention-cycle', parsedAttention);
        localStorage.setItem('chronos-stress-response', parsedStress);

        // Sync everything to the backend immediately!
        try {
          fetch(`${API_BASE}/api/settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: currentUsername || 'user',
              sleepStart: Number(currentSleepStart),
              sleepEnd: Number(currentSleepEnd),
              ntfyTopic: currentNtfyTopic,
              twinProfile: summary,
              procrastinationRating: Number(parsedRating),
              attentionCycle: parsedAttention,
              stressResponse: parsedStress
            })
          });
        } catch (e) {
          console.warn("Failed to sync settings on scan complete", e);
        }
      } else {
        setChatHistory([...updatedHistory, { role: 'assistant' as const, content: reply }]);
        setQuestionsCount(prev => prev + 1);
      }
    } catch (err: any) {
      console.error("Identity Scan Chat Error:", err);
      setScanError(err.message || "Failed to establish contact with the AI supplier.");
    } finally {
      if (step !== 'done') {
        setChatLoading(false);
      }
    }
  };

  // Clock hands speed multiplier based on current onboarding step (recalibration)
  const getClockSpeedMultiplier = () => {
    if (!showQuestions) return 1.0;
    switch (step) {
      case 'settings':
        return 6.0;
      case 'about':
        return 18.0;
      case 'questions':
        return 60.0; // Warp speed!
      case 'done':
        return 1.0;  // Settles down
      case 'intro':
      default:
        return 1.0;
    }
  };
  const getMainOrbSize = (state: string) => {
    switch (state) {
      case 'offline': return 230;
      case 'idle': return 250;
      case 'listening': return 270;
      case 'speaking': return 290;
      case 'thinking': return 310;
      default: return 250;
    }
  };

  const getMainOrbWidth = (state: string) => {
    switch (state) {
      case 'offline': return '0.85em';
      case 'idle': return '0.88em';
      case 'listening': return '0.90em';
      case 'speaking': return '0.92em';
      case 'thinking': return '0.94em';
      default: return '0.88em';
    }
  };

  const THEME_MAP: Record<string, {
    primary: string;
    secondary: string;
    glow: string;
    rgb: string;
  }> = {
    offline: { primary: '#EF4444', secondary: '#7F1D1D', glow: 'rgba(239,68,68,0.5)', rgb: '239,68,68' },
    idle: hasMemory 
      ? { primary: '#DCD0FF', secondary: '#7864B4', glow: 'rgba(220,208,255,0.5)', rgb: '220,208,255' } // Lavender
      : { primary: '#06C6B3', secondary: '#004F4F', glow: 'rgba(6, 198, 179, 0.5)', rgb: '6,198,179' }, // Cyan default
    listening: hasMemory
      ? { primary: '#9966CC', secondary: '#502878', glow: 'rgba(153,102,204,0.6)', rgb: '153,102,204' } // Amethyst
      : { primary: '#0099FF', secondary: '#004F80', glow: 'rgba(0,153,255,0.6)', rgb: '0,153,255' }, // Azure default
    thinking: { primary: '#10B981', secondary: '#064E3B', glow: 'rgba(16,185,129,0.5)', rgb: '16,185,129' },
    speaking: hasMemory
      ? { primary: '#8A2BE2', secondary: '#1E003C', glow: 'rgba(138,43,226,0.7)', rgb: '138,43,226' } // Dark purple
      : { primary: '#2563EB', secondary: '#1E3A8A', glow: 'rgba(37,99,235,0.7)', rgb: '37,99,235' }, // Navy blue default
  };

  const currentStyleTheme = THEME_MAP[resolvedOrbState] || (hasMemory 
    ? { primary: '#DCD0FF', secondary: '#7864B4', glow: 'rgba(220,208,255,0.5)', rgb: '220,208,255' }
    : { primary: '#06C6B3', secondary: '#004F4F', glow: 'rgba(6,198,179,0.5)', rgb: '6,198,179' });

  const clockSpeedMultiplier = getClockSpeedMultiplier();
  const particleState = resolvedOrbState;

  return (
    <>
      {/* Dynamic theme style overrides */}
      <style>{`
        .text-\\[\\#8A2BE2\\] {
          color: ${currentStyleTheme.primary} !important;
        }
        .text-\\[\\#06C6B3\\] {
          color: ${currentStyleTheme.primary} !important;
        }
        .border-\\[\\#8A2BE2\\]\\/30 {
          border-color: rgba(${currentStyleTheme.rgb}, 0.3) !important;
        }
        .border-\\[\\#8A2BE2\\]\\/40 {
          border-color: rgba(${currentStyleTheme.rgb}, 0.4) !important;
        }
        .border-\\[\\#8A2BE2\\] {
          border-color: ${currentStyleTheme.primary} !important;
        }
        .bg-\\[\\#8A2BE2\\] {
          background-color: ${currentStyleTheme.primary} !important;
        }
        .bg-\\[\\#8A2BE2\\]\\/10 {
          background-color: rgba(${currentStyleTheme.rgb}, 0.1) !important;
        }
        .bg-\\[\\#8A2BE2\\]\\/20 {
          background-color: rgba(${currentStyleTheme.rgb}, 0.2) !important;
        }
        .hover\\:border-\\[\\#8A2BE2\\]\\/30:hover {
          border-color: rgba(${currentStyleTheme.rgb}, 0.3) !important;
        }
        .hover\\:border-\\[\\#8A2BE2\\]\\/40:hover {
          border-color: rgba(${currentStyleTheme.rgb}, 0.4) !important;
        }
        .hover\\:bg-\\[\\#8A2BE2\\]\\/10:hover {
          background-color: rgba(${currentStyleTheme.rgb}, 0.1) !important;
        }
        .shadow-\\[0_0_15px_rgba\\(138\\,43\\,226\\,0\\.15\\)\\] {
          box-shadow: 0 0 15px rgba(${currentStyleTheme.rgb}, 0.15) !important;
        }
        .shadow-\\[0_0_20px_rgba\\(138\\,43\\,226\\,0\\.2\\)\\] {
          box-shadow: 0 0 20px rgba(${currentStyleTheme.rgb}, 0.2) !important;
        }
        .from-\\[\\#06C6B3\\] {
          --tw-gradient-from: ${currentStyleTheme.secondary} !important;
          --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgba(${currentStyleTheme.rgb}, 0)) !important;
        }
        .to-\\[\\#8A2BE2\\] {
          --tw-gradient-to: ${currentStyleTheme.primary} !important;
        }
        .text-\\[\\#c084fc\\] {
          color: ${currentStyleTheme.primary} !important;
        }
        .focus\\:ring-\\[\\#8A2BE2\\]:focus {
          --tw-ring-color: ${currentStyleTheme.primary} !important;
        }
        .focus\\:ring-\\[\\#06C6B3\\]:focus {
          --tw-ring-color: ${currentStyleTheme.primary} !important;
        }
      `}</style>

      {/* Canvas Particle Background (Fixed viewport outside transition wrapper) */}
      <ParticleBackground isRedMode={isBullshitMode} isPurpleMode={hasMemory} isWarpActive={isWarpActive} state={resolvedOrbState} />

      {/* Settings gear button at top-right on Portal Home */}
      <div 
        className="fixed top-6 right-6 z-40 transition-all duration-500 ease-out flex items-center gap-3"
        style={{
          opacity: isWarpActive ? 0 : 1,
          pointerEvents: isWarpActive ? 'none' : 'auto'
        }}
      >
        <div className="relative flex items-center">
          {particleState === 'offline' && (
            <div className="absolute inset-0 pointer-events-none z-0 scale-150">
              <span className="absolute w-1 h-1 bg-red-500 rounded-full animate-ping opacity-60" style={{ top: '-6px', left: '50%', animationDelay: '0s' }} />
              <span className="absolute w-1 h-1 bg-red-500 rounded-full animate-ping opacity-45" style={{ bottom: '-6px', right: '15%', animationDelay: '0.4s' }} />
              <span className="absolute w-1 h-1 bg-red-500 rounded-full animate-ping opacity-30" style={{ left: '-6px', top: '30%', animationDelay: '0.8s' }} />
            </div>
          )}
          
          <button
            onClick={() => {
              setOpenHomeSettings(!openHomeSettings);
            }}
            className={`p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-purple-950/20 text-gray-400 hover:text-white transition-all cursor-pointer flex items-center justify-center hover:rotate-90 duration-300 focus:outline-none z-10 ${
              particleState === 'offline' ? 'border-red-500/40 hover:border-red-500/70 hover:shadow-[0_0_15px_rgba(239,68,68,0.25)]' : 'hover:border-[#8A2BE2]/40 hover:shadow-[0_0_15px_rgba(138,43,226,0.15)]'
            }`}
            title="System Configuration"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          
          {particleState === 'offline' && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" title="Core Supplier Offline"></span>
            </span>
          )}
        </div>
      </div>

      {/* Custom Settings Modal */}
      {openHomeSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 transition-all duration-200">
          <div className="relative w-full max-w-lg bg-[#0B0C10]/95 border border-white/[0.08] rounded-3xl p-6 shadow-[0_8px_32px_0_rgba(138,43,226,0.4)] backdrop-blur-xl space-y-5 animate-in fade-in zoom-in-95 duration-200 text-left font-sans">
            <div className="flex justify-between items-start pb-2 border-b border-gray-900">
              <div>
                <h2 className="text-base font-bold uppercase tracking-wider text-[#8A2BE2]">
                  Chronos Portal Settings
                </h2>
                <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-0.5">
                  Calibrate AI Core, configure phone sync, adjust sleep hours, or simulate overrides
                </p>
              </div>
              <button
                onClick={() => setOpenHomeSettings(false)}
                className="text-gray-400 hover:text-gray-200 text-xs focus:outline-none font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* TAB SELECTOR */}
            <div className="flex border-b border-white/5 pb-2 gap-4">
              {hasMemory ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSettingsTab('ai')}
                    className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${
                      settingsTab === 'ai' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    AI Core
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsTab('phone')}
                    className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${
                      settingsTab === 'phone' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Phone Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsTab('twin')}
                    className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${
                      settingsTab === 'twin' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Digital Twin
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setSettingsTab('dev')}
                className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${
                  settingsTab === 'dev' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Developer
              </button>
            </div>

            <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 scrollbar-thin">
              {settingsTab === 'ai' && hasMemory && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#06C6B3] border-b border-white/5 pb-1">
                    Core AI Supplier Options
                  </h3>
                  
                  <div 
                    onClick={() => setRecheckTrigger(prev => prev + 1)}
                    className="flex items-center justify-between bg-black/30 px-4 py-2.5 rounded-xl border border-white/5 cursor-pointer hover:bg-black/40 transition-all select-none"
                    title="Click to verify connectivity"
                  >
                    <span className="text-[9px] font-mono tracking-wider text-gray-500 uppercase flex items-center gap-1">
                      Supplier Status: <span className="text-[8px] opacity-65">(Click to test)</span>
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-widest uppercase border ${
                      connectionStatus === 'online'
                        ? 'bg-green-950/40 border-green-800 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.15)]'
                        : connectionStatus === 'checking'
                          ? 'bg-amber-950/40 border-amber-800 text-amber-400 animate-pulse'
                          : 'bg-red-950/40 border-red-800 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                    }`}>
                      {connectionStatus === 'online' ? '🟢 Online' : connectionStatus === 'checking' ? '🟡 Checking...' : '🔴 Offline'}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      AI Supplier Engine
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {['gemini', 'nvidia', 'custom'].map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setAiConfig(prev => {
                            const defaults: Record<string, any> = {
                              gemini: { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
                              nvidia: { provider: 'nvidia', apiUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3-70b-instruct' },
                              custom: { provider: 'custom', apiUrl: 'http://localhost:8000/v1', model: 'gpt-4o' }
                            };
                            return {
                              ...prev,
                              ...defaults[p],
                              apiKey: prev.provider === p ? prev.apiKey : ''
                            };
                          })}
                          className={`py-1.5 rounded-lg font-bold text-[9px] uppercase tracking-wider border transition-all cursor-pointer ${
                            aiConfig.provider === p
                              ? 'bg-[#8A2BE2]/20 border-[#8A2BE2] text-purple-300'
                              : 'bg-[#1F2833]/40 border-gray-800 text-gray-400 hover:border-gray-700'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(aiConfig.provider === 'nvidia' || aiConfig.provider === 'custom' || aiConfig.provider === 'gemini') && (
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        {aiConfig.provider === 'nvidia' ? 'NVIDIA API Key' : aiConfig.provider === 'gemini' ? 'Google Gemini API Key' : 'API Key (Optional)'}
                      </label>
                      <input
                        type="password"
                        required={aiConfig.provider === 'nvidia' || aiConfig.provider === 'gemini'}
                        value={aiConfig.apiKey}
                        onChange={e => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                        className="w-full rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none border border-gray-800 font-mono"
                        style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                      />
                    </div>
                  )}

                  {aiConfig.provider === 'custom' && (
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        API Base URL
                      </label>
                      <input
                        type="text"
                        required
                        value={aiConfig.apiUrl}
                        onChange={e => setAiConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                        className="w-full rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none border border-gray-855 font-mono"
                        style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      AI Model Name
                    </label>
                    <input
                      type="text"
                      required
                      value={aiConfig.model}
                      onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none border border-gray-855 font-mono"
                      style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                    />
                  </div>

                  {/* Recommended Models */}
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-3.5 text-[10px] font-mono leading-relaxed">
                    <span className="text-[#06C6B3] font-bold uppercase block tracking-wider border-b border-white/5 pb-1">💡 Provider Model Recommendations:</span>
                    
                    <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1 scrollbar-thin">

                      {/* Gemini */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-[#8A2BE2] font-bold uppercase text-[9px]">✨ Google Gemini (Cloud)</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">gemini-1.5-flash</code> (fast response)</div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">gemini-1.5-pro</code> (high reasoning capability)</div>
                      </div>

                      {/* NVIDIA NIM */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-[#0099FF] font-bold uppercase text-[9px]">🟢 NVIDIA NIM</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">meta/llama-3-8b-instruct</code></div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">meta/llama-3-70b-instruct</code></div>
                      </div>

                      {/* Custom */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-amber-500 font-bold uppercase text-[9px]">⚙️ Custom OpenAI-Compatible</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">gpt-4o-mini</code></div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">gpt-4o</code></div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        if (aiConfig.provider !== 'custom' && !aiConfig.apiKey.trim()) {
                          alert("API Key is mandatory for this supplier.");
                          return;
                        }
                        if (!aiConfig.model.trim()) {
                          alert("AI Model name is mandatory.");
                          return;
                        }
                        localStorage.setItem('chronos-ai-config', JSON.stringify(aiConfig));
                        try {
                          await fetch(`${API_BASE}/api/settings`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              username,
                              sleepStart: Number(sleepStart),
                              sleepEnd: Number(sleepEnd),
                              ntfyTopic,
                              twinProfile: localStorage.getItem('chronos-performance-twin') || ""
                            })
                          });
                        } catch (err) {
                          console.warn("Failed to sync settings on save", err);
                        }
                        setOpenHomeSettings(false);
                      }}
                      className="px-6 py-2 rounded-xl bg-[#8A2BE2] text-white hover:opacity-90 font-bold uppercase tracking-wider text-[10px] transition-all cursor-pointer"
                    >
                      Save Configuration
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'phone' && hasMemory && (
                <div className="space-y-4 text-left py-2 flex flex-col items-center text-center">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#0099FF] border-b border-white/5 pb-1 w-full text-left mb-2">
                    📱 Phone Link Synchronization
                  </h3>
                  <span className="text-3xl block select-none">🔗</span>
                  <p className="text-[10px] text-gray-400 font-sans max-w-xs leading-relaxed">
                    Set up out-of-band notifications on your mobile device. Get real-time warnings from Chronos when your timelines begin to collapse.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenHomeSettings(false);
                      router.push('/dashboard/phone-link');
                    }}
                    className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-[#0099FF] hover:opacity-95 text-black font-mono font-bold text-[10px] uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(0,153,255,0.25)] border border-transparent"
                  >
                    🚀 Open Phone Link Setup Wizard →
                  </button>
                </div>
              )}

              {settingsTab === 'twin' && hasMemory && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-[#8A2BE2] border-b border-white/5 pb-1">
                      Operator Twin Profile Details
                    </h3>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Operator Username
                      </label>
                      <input
                        type="text"
                        required
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] border border-gray-800"
                        style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                      />
                    </div>

                    <div className="space-y-2 pt-2">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Sleep Schedule (Non-Work Hours)
                      </label>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[8px] font-mono uppercase text-gray-500 mb-1">Start Hour (24h)</label>
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={sleepStart}
                            onChange={e => setSleepStart(Math.max(0, Math.min(23, Number(e.target.value))))}
                            className="w-full rounded-lg px-3 py-1.5 text-xs border border-gray-800 focus:ring-1 focus:ring-[#8A2BE2]"
                            style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                          />
                        </div>
                        <div>
                          <label className="block text-[8px] font-mono uppercase text-gray-500 mb-1">End Hour (24h)</label>
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={sleepEnd}
                            onChange={e => setSleepEnd(Math.max(0, Math.min(23, Number(e.target.value))))}
                            className="w-full rounded-lg px-3 py-1.5 text-xs border border-gray-800 focus:ring-1 focus:ring-[#8A2BE2]"
                            style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                          />
                        </div>
                      </div>
                      <p className="text-[8px] text-gray-500 font-mono italic">Time ranges in sleep hours will be completely excluded from remaining work hours.</p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-white/5">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-red-400 pb-1">
                      Reset Memory Core
                    </h3>
                    <p className="text-[10px] text-gray-400 leading-relaxed font-mono">
                      Warning: Resetting the twin memory will wipe out the current Performance Twin Profile and clear cached onboarding data. You will have to run a new Identity Scan before Chronos can analyze your behaviors again.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenHomeSettings(false);
                        reset();
                      }}
                      className="w-full px-4 py-2.5 rounded-xl border border-red-900/40 hover:bg-red-950/20 text-red-400 font-mono text-[9px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <span>⚠️</span> Wipe Twin Profile & Reset Memory
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'dev' && (
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500 border-b border-white/5 pb-1 font-mono">
                    🛠️ Developer Overrides
                  </h3>

                  <div className="space-y-2">
                    <span className="block text-[10px] font-mono text-amber-400 uppercase">Singularity Phase Override:</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {['offline', 'idle', 'listening', 'thinking', 'speaking'].map(p => (
                        <button
                          key={p}
                          type="button"
                          disabled={!hasMemory}
                          onClick={() => {
                            setDevOverrideState(p as any);
                            setMainOrbState(p as any);
                          }}
                          className={`px-2.5 py-1.5 text-[9px] font-mono rounded-lg border uppercase transition-all focus:outline-none ${
                            !hasMemory
                              ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/5 text-gray-500'
                              : devOverrideState === p
                                ? 'bg-amber-500 border-amber-500 text-black font-bold'
                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 cursor-pointer'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    {!hasMemory && (
                      <p className="text-[8px] text-amber-500/70 font-mono uppercase mt-1">
                        ⚠️ Phase overrides are disabled during initial onboarding.
                      </p>
                    )}
                    {hasMemory && devOverrideState !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setDevOverrideState(null);
                          fetch(`${API_BASE}/api/voice/status`)
                            .then(res => {
                              if (!res.ok) throw new Error();
                              return res.json();
                            })
                            .then(data => {
                              if (data.voice_link === 'offline') {
                                setMainOrbState('offline');
                              } else {
                                setMainOrbState('idle');
                              }
                            })
                            .catch(() => {
                              setMainOrbState('offline');
                            });
                        }}
                        className="px-2.5 py-1.5 text-[9px] font-mono rounded-lg border border-red-500/40 bg-red-950/20 text-red-400 hover:bg-red-950/40 uppercase transition-all cursor-pointer font-bold w-full text-center"
                      >
                        Clear Override (Sync)
                      </button>
                    )}
                  </div>

                  {!hasMemory && (
                    <div className="space-y-2 pt-3 border-t border-white/5">
                      <span className="block text-[10px] font-mono text-amber-400 uppercase">Onboarding Actions:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenHomeSettings(false);
                          handleBypassOnboarding();
                        }}
                        className="w-full px-4 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wider bg-purple-950/30 text-purple-200 border border-purple-500/40 hover:bg-purple-900/40 transition-all cursor-pointer flex items-center justify-center gap-2 mb-2"
                      >
                        ⚡ Bypass Onboarding (Auto-Type)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenHomeSettings(false);
                          handleInstantBypass();
                        }}
                        className="w-full px-4 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wider bg-gradient-to-r from-[#8A2BE2]/40 to-purple-800/60 border border-[#8A2BE2] text-white hover:opacity-90 transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(138,43,225,0.25)]"
                      >
                        🚀 Instant Bypass (Direct to Dashboard)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className={`min-h-screen ${
          hasMemory ? 'h-screen overflow-hidden' : ''
        } flex flex-col text-gray-100 overflow-x-hidden transition-all duration-500 ease-in-out ${
          isTransitioning 
            ? 'opacity-0 scale-[0.98] blur-[2px]' 
            : 'opacity-100 scale-100 blur-0'
        }`}
        style={{ backgroundColor: isBullshitMode ? '#150303' : 'transparent' }}
      >
        <section className={`w-full ${hasMemory ? 'flex-1' : 'h-screen'} flex flex-col items-center justify-center relative select-none`}>
        {/* Welcome, User Header */}
        {hasMemory && (
          <div 
            className={`absolute top-12 text-sm md:text-base tracking-[0.3em] font-semibold uppercase ${resolvedOrbState === 'offline' ? 'gradient-text-red' : 'gradient-text'} transition-all duration-500 ease-out z-20`}
            style={{
              transform: `translate(${mousePos.x * -7}px, ${mousePos.y * -7}px)`,
              opacity: isWarpActive ? 0 : 1,
              pointerEvents: isWarpActive ? 'none' : 'auto'
            }}
          >
            Welcome, {username}
          </div>
        )}

        <div 
          className="absolute w-[650px] h-[650px] rounded-full blur-[160px] pointer-events-none transition-all duration-700 ease-out"
          style={{
            background: isBullshitMode 
              ? 'radial-gradient(circle, rgba(239, 68, 68, 0.45) 0%, rgba(120, 10, 10, 0.22) 45%, transparent 75%)'
              : hasMemory
                ? 'radial-gradient(circle, rgba(138, 43, 226, 0.45) 0%, rgba(138, 43, 226, 0.22) 45%, transparent 75%)'
                : 'radial-gradient(circle, rgba(6, 198, 179, 0.45) 0%, rgba(138, 43, 226, 0.22) 45%, transparent 75%)',
            top: '50%',
            left: '50%',
            transform: `translate(calc(-50% + ${mousePos.x * 40}px), calc(-50% + ${mousePos.y * 40}px))`,
            opacity: isWarpActive ? 0.02 : 0.24,
          }}
        />

        {/* Floating Logo Container with Parallax and Noise */}
        <div 
          className="relative select-none transition-transform duration-300 ease-out z-10 w-full max-w-[95vw] flex flex-col justify-center items-center font-sans"
          style={{
            transform: `translate(${mousePos.x * -18}px, ${mousePos.y * -18}px)`,
          }}
        >
          {/* Subtle noise overlay applied specifically to the logo text */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.08] mix-blend-overlay">
            <svg width="100%" height="100%">
              <filter id="logo-noise">
                <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch" />
                <feColorMatrix type="matrix" values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.85 0" />
              </filter>
              <rect width="100%" height="100%" filter="url(#logo-noise)" />
            </svg>
          </div>

          <h1
            className="font-black uppercase flex items-center justify-center select-none"
            style={{
              color: accentColor,
              fontFamily: 'var(--font-outfit), sans-serif',
              // Fluid typography scaling dynamically with viewport size
              fontSize: 'clamp(2.2rem, 11vw, 11rem)',
              textShadow: hasMemory 
                ? `0 0 15px rgba(138, 43, 226, 0.38), 0 0 35px rgba(138, 43, 226, 0.22), 0 0 70px rgba(102, 252, 241, 0.18)`
                : '0 0 15px rgba(6, 198, 179, 0.38), 0 0 35px rgba(6, 198, 179, 0.22), 0 0 70px rgba(138, 43, 226, 0.18)',
              lineHeight: 1,
              gap: '0.15em',
            }}
          >
            <span style={{ display: 'inline-block', width: '0.78em', textAlign: 'center', transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)', opacity: isWarpActive ? 0 : 1, transform: isWarpActive ? 'scale(0.8) translateY(12px)' : 'scale(1) translateY(0)' }}>C</span>
            <span style={{ display: 'inline-block', width: '0.78em', textAlign: 'center', transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)', opacity: isWarpActive ? 0 : 1, transform: isWarpActive ? 'scale(0.8) translateY(12px)' : 'scale(1) translateY(0)' }}>H</span>
            <span style={{ display: 'inline-block', width: '0.78em', textAlign: 'center', transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)', opacity: isWarpActive ? 0 : 1, transform: isWarpActive ? 'scale(0.8) translateY(12px)' : 'scale(1) translateY(0)' }}>R</span>
            <span
              className="flex items-center justify-center transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1)" 
              style={{ 
                width: getMainOrbWidth(resolvedOrbState), 
                transform: 'translateY(-0.035em) scale(1)',
                zIndex: 10,
                position: 'relative'
              }}
            >
              {hasMemory ? (
                <div 
                  id="chronos-singularity-core"
                  className="relative flex items-center justify-center transition-all duration-500"
                  style={{ 
                    width: getMainOrbWidth(resolvedOrbState), 
                    height: getMainOrbWidth(resolvedOrbState),
                    transform: `scale(${(getMainOrbSize(resolvedOrbState) / 320) * 1.1})`
                  }}
                >
                  <ChronosCanvas 
                    state={resolvedOrbState} 
                    size={320} 
                    theme="main"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 mx-auto" 
                  />
                </div>
              ) : (
                <ClockO 
                  size="0.95em" 
                  color={accentColor} 
                  glowColor={
                    resolvedOrbState === 'offline'
                      ? 'rgba(239, 68, 68, 0.42)'
                      : hasMemory
                        ? 'rgba(138, 43, 226, 0.42)'
                        : 'rgba(6, 198, 179, 0.42)'
                  } 
                  isWarpActive={isWarpActive} 
                />
              )}
            </span>
            <span style={{ display: 'inline-block', width: '0.78em', textAlign: 'center', transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)', opacity: isWarpActive ? 0 : 1, transform: isWarpActive ? 'scale(0.8) translateY(12px)' : 'scale(1) translateY(0)' }}>N</span>
            <span style={{ display: 'inline-block', width: '0.78em', textAlign: 'center', transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)', opacity: isWarpActive ? 0 : 1, transform: isWarpActive ? 'scale(0.8) translateY(12px)' : 'scale(1) translateY(0)' }}>O</span>
            <span style={{ display: 'inline-block', width: '0.78em', textAlign: 'center', transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)', opacity: isWarpActive ? 0 : 1, transform: isWarpActive ? 'scale(0.8) translateY(12px)' : 'scale(1) translateY(0)' }}>S</span>
          </h1>
        </div>

        {/* Clickable Action Button (Initialize or Open Dashboard) */}
        <div 
          className="absolute bottom-12 md:bottom-16 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center"
          style={{
            transform: `translate(${mousePos.x * -7}px, ${mousePos.y * -7}px)`,
            opacity: isWarpActive ? 0 : 1,
            pointerEvents: isWarpActive ? 'none' : 'auto',
            transition: 'opacity 0.5s ease-out'
          }}
        >
          {hasMemory ? (
            <a
              href="/dashboard"
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await fetch(`${API_BASE}/api/settings`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      username,
                      sleepStart: Number(sleepStart),
                      sleepEnd: Number(sleepEnd),
                      ntfyTopic,
                      twinProfile: profileSummary || localStorage.getItem('chronos-performance-twin') || "",
                      procrastinationRating: Number(localStorage.getItem('chronos-procrastination-rating') || 8.0),
                      attentionCycle: localStorage.getItem('chronos-attention-cycle') || "Focus cycles peak late evening",
                      stressResponse: localStorage.getItem('chronos-stress-response') || "Postpones tasks under high workload pressure"
                    })
                  });
                } catch (err) {
                  console.warn("Failed to sync final settings to backend", err);
                }
                navigateTo('/dashboard');
              }}
              className="flex flex-col items-center gap-2 text-base md:text-lg tracking-widest uppercase opacity-85 hover:opacity-100 hover:scale-105 transition-all duration-300 ease-out cursor-pointer group focus:outline-none px-8 py-3.5 rounded-2xl bg-white/5 border border-white/10 hover:border-[#8A2BE2]/40 hover:bg-[#8A2BE2]/10"
              style={{
                color: accentColor,
                textShadow: `0 0 10px ${shadowColor}`,
              }}
            >
              <span className="tracking-[0.3em] font-bold">
                Open Dashboard
              </span>
            </a>
          ) : (
            <button
              onClick={handleScrollClick}
              className="flex flex-col items-center gap-2 text-base md:text-lg tracking-widest uppercase opacity-60 hover:opacity-100 transition-all duration-500 ease-out cursor-pointer group focus:outline-none"
              style={{
                color: accentColor,
                textShadow: `0 0 10px ${shadowColor}`,
              }}
            >
              <span className="tracking-[0.3em] group-hover:translate-y-1 transition-transform duration-300">
                Scroll to begin
              </span>
              {/* Scroll Wheel Mouse Outline with Dynamic Gradient */}
              <div className="mt-2">
                <svg
                  width="24"
                  height="40"
                  viewBox="0 0 24 40"
                  fill="none"
                  className="group-hover:opacity-100 transition-opacity duration-300"
                >
                  <defs>
                    <linearGradient id="scroll-wheel-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={resolvedOrbState === 'offline' ? '#EF4444' : '#06C6B3'} />
                      <stop offset="50%" stopColor={resolvedOrbState === 'offline' ? '#7F1D1D' : '#8A2BE2'} />
                      <stop offset="100%" stopColor={resolvedOrbState === 'offline' ? '#FF6B6B' : '#66FCF1'} />
                    </linearGradient>
                  </defs>
                  <rect
                    x="2"
                    y="2"
                    width="20"
                    height="36"
                    rx="10"
                    stroke="url(#scroll-wheel-grad)"
                    strokeWidth="2"
                  />
                  <line
                    x1="12"
                    y1="8"
                    x2="12"
                    y2="16"
                    stroke="url(#scroll-wheel-grad)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="animate-[wheelScroll_1.8s_ease-in-out_infinite]"
                  />
                </svg>
              </div>
            </button>
          )}
        </div>
      </section>

      {/* Sentinel — triggers the form reveal */}
      {!hasMemory && (
        <div ref={sentinelRef} className="h-[1px]" style={{ backgroundColor: 'transparent' }} />
      )}

      {/* Onboarding Section Wrapper - Render as Modal Overlay for Registered Users, and Inline Scrollable Section for Non-Users */}
      {(!hasMemory || showQuestions) && (
        <div className={hasMemory ? "fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-300" : "w-full relative z-10"}>
          <div className={hasMemory ? "relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#0B0C10]/95 border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-8 scrollbar-thin flex flex-col items-center" : `flex flex-col items-center justify-center min-h-screen py-16 px-4 relative transition-all duration-700 ease-in-out ${showQuestions ? 'opacity-100 scale-100 blur-none' : 'opacity-0 scale-[0.98] blur-md pointer-events-none'}`}>
            {/* Close button (only in modal overlay mode) */}
            {hasMemory && !isBullshitMode && (
              <button
                type="button"
                onClick={() => {
                  setShowQuestions(false);
                  setStep('intro');
                }}
                className="absolute top-6 right-6 text-gray-500 hover:text-white font-mono text-lg transition-colors cursor-pointer select-none z-50 focus:outline-none"
                title="Close"
              >
                ✕
              </button>
            )}


          {isBullshitMode ? (
            bullshitBranch === 'prompt' ? (
              /* Bullshit detected mode - Warning prompt card */
              <div className="max-w-xl w-full bg-red-950/10 border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)] p-8 rounded-3xl backdrop-blur-xl space-y-6 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-300">
                <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-3xl animate-bounce">
                  🚨
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl md:text-2xl font-black uppercase tracking-widest text-red-500">
                    Bullshit Detected
                  </h2>
                  <p className="text-[10px] text-red-400/80 font-mono uppercase tracking-widest font-bold">
                    Chronos Onboarding Threat Level: CRITICAL
                  </p>
                </div>

                <div className="bg-black/45 border border-red-500/25 p-5 rounded-2xl font-mono text-[11px] md:text-xs text-red-200 leading-relaxed text-left w-full">
                  {trollHistory.length > 0 ? trollHistory[trollHistory.length - 1].content : "Pure, unadulterated nonsense has bypassed our cognitive filters."}
                </div>

                <div className="flex flex-col gap-3 w-full">
                  <button
                    type="button"
                    onClick={handleLockIn}
                    className="w-full py-3.5 rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-300 hover:scale-[1.01] bg-[#06C6B3] text-[#0B0C10] shadow-[0_0_15px_rgba(6,198,179,0.3)] cursor-pointer"
                  >
                    🔒 Lock In (Resume Scan)
                  </button>
                  <button
                    type="button"
                    onClick={handleBullshitOn}
                    className="w-full py-3.5 rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-300 hover:scale-[1.01] bg-red-600 hover:bg-red-700 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)] border border-red-500/40 cursor-pointer"
                  >
                    💩 Bullshit On (Embrace Chaos)
                  </button>
                </div>
              </div>
            ) : (
              /* Bullshit On - Sassy Troll Chat Screen */
              <div className="max-w-xl w-full bg-red-950/10 border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)] p-8 rounded-3xl backdrop-blur-xl space-y-6 flex flex-col items-center text-center relative animate-in fade-in zoom-in-95 duration-300">
                {/* Small Return to Home button in the top left */}
                <button
                  type="button"
                  onClick={handleTrollReturnHome}
                  className="absolute top-6 left-6 text-[9px] font-mono tracking-wider text-red-400 hover:text-red-300 uppercase transition-all duration-200 cursor-pointer flex items-center gap-1 hover:underline"
                >
                  ← Home
                </button>

                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-2xl select-none">
                  🤡
                </div>

                <div className="space-y-1">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-red-500 animate-pulse animate-in fade-in">
                    Anomaly Terminal: Bullshit Enabled
                  </h2>
                  <p className="text-[8px] text-gray-500 font-mono uppercase tracking-widest">
                    You chose this path. Chronos is now messing with you.
                  </p>
                </div>

                {/* Sassy Troll Terminal conversation log */}
                <div className="w-full bg-black/45 border border-red-500/15 rounded-2xl p-4 min-h-[160px] max-h-[220px] overflow-y-auto scrollbar-thin text-left space-y-3 font-mono text-[11px] leading-relaxed text-red-200">
                  {trollHistory.map((msg, idx) => (
                    <div key={idx} className={`flex gap-1.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`p-2 rounded-xl max-w-[85%] ${
                        msg.role === 'user'
                          ? 'bg-red-950/40 border border-red-900/50 text-right select-text cursor-text'
                          : 'bg-black/55 border border-red-500/10 select-none'
                      }`}>
                        <span className="text-[9px] text-red-500 font-bold block uppercase mb-0.5">
                          {msg.role === 'user' ? 'Troll User' : 'Chronos Roast Engine'}
                        </span>
                        <div className="space-y-1 select-text">{renderFormattedText(msg.content)}</div>
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="text-center text-[10px] text-red-500 animate-pulse uppercase tracking-widest py-2">
                      Generating high-fidelity sass...
                    </div>
                  )}
                  <div ref={trollChatEndRef} />
                </div>

                {/* Troll Input Form */}
                <form onSubmit={handleSendTrollAnswer} className="w-full space-y-4">
                  <input
                    type="text"
                    required
                    disabled={chatLoading}
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    placeholder="Provide further nonsense..."
                    className="w-full rounded-xl px-5 py-3.5 text-xs text-center focus:ring-1 focus:ring-red-500 focus:outline-none transition-colors border border-red-900/30 placeholder-red-900/60 bg-red-950/15 text-red-300 font-mono"
                  />
                  <div className="flex justify-center gap-3">
                    <button
                      type="submit"
                      disabled={chatLoading}
                      className="px-8 py-3 rounded-lg font-bold text-xs uppercase tracking-widest transition-all duration-300 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                    >
                      Feed the Roast Engine ⚡
                    </button>
                  </div>
                </form>
              </div>
            )
          ) : (
            <>
              {/* STEP 1: Settings Setup */}
              {step === 'settings' && (
                <div className="max-w-xl w-full bg-black/15 border border-white/[0.08] p-8 rounded-3xl backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-xl md:text-2xl font-bold uppercase tracking-wider" style={{ color: accentColor }}>
                  System Initialization
                </h2>
                <p className="text-xs text-[#C5C6C7] tracking-wide">
                  Configure the AI Core Supplier to begin your Performance Twin Identity Scan.
                </p>
              </div>

              {/* Core status network verify indicators */}
              <div className="flex items-center justify-between border-b border-gray-900 pb-3">
                <span className="text-[10px] font-mono tracking-wider text-gray-500 uppercase">Core Supplier Status:</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-widest uppercase border ${
                  connectionStatus === 'online'
                    ? 'bg-green-950/40 border-green-800 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.15)] animate-pulse'
                    : connectionStatus === 'checking'
                      ? 'bg-amber-950/40 border-amber-800 text-amber-400 animate-pulse'
                      : 'bg-red-950/40 border-red-800 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                }`}>
                  {connectionStatus === 'online' ? '🟢 Online' : connectionStatus === 'checking' ? '🟡 Checking...' : '🔴 Offline'}
                </span>
              </div>

              {/* Clickable Validation Warning Panel */}
              {connectionStatus === 'offline' && (
                <button
                  type="button"
                  onClick={() => setRecheckTrigger(prev => prev + 1)}
                  className="w-full text-left p-4 rounded-2xl bg-red-950/15 border border-red-900/30 hover:bg-red-950/25 hover:border-red-800/40 transition-all duration-300 cursor-pointer space-y-3 group focus:outline-none"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5 select-none">
                      <span>⚠️</span> Core Verification Failed
                    </h4>
                    <span className="text-[9px] font-mono uppercase text-red-500 animate-pulse group-hover:text-red-400">
                      Click to Reverify 🔄
                    </span>
                  </div>
                  
                  {aiConfig.provider === 'nvidia' ? (
                    <div className="space-y-2 text-[11px] text-gray-400 leading-relaxed font-mono">
                      <p className="text-gray-300 font-semibold">Instructions to bring NVIDIA NIM online:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Ensure your <span className="text-white font-bold">NVIDIA API Key</span> is correct and has active credits.</li>
                        <li>Check that your computer has an active internet connection.</li>
                        <li>Verify the Base URL Override under Advanced settings if you are using a custom gateway.</li>
                      </ol>
                    </div>
                  ) : aiConfig.provider === 'gemini' ? (
                    <div className="space-y-2 text-[11px] text-gray-400 leading-relaxed font-mono">
                      <p className="text-gray-300 font-semibold">Instructions to bring Google Gemini online:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Ensure your <span className="text-white font-bold">Google Gemini API Key</span> is correct.</li>
                        <li>Check that your computer has an active internet connection.</li>
                      </ol>
                    </div>
                  ) : (
                    <div className="space-y-2 text-[11px] text-gray-400 leading-relaxed font-mono">
                      <p className="text-gray-300 font-semibold">Instructions to bring Custom API online:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Verify that your Custom API Base URL is reachable from your network.</li>
                        <li>Ensure the API Key (if required) matches your provider's credentials.</li>
                        <li>Verify the target AI Model matches the models deployed on your endpoint.</li>
                      </ol>
                    </div>
                  )}

                  <div className="pt-1.5 border-t border-red-900/20 text-[9px] text-red-400/80 font-mono text-center">
                    (Clicking anywhere on this red box will re-verify the connection)
                  </div>
                </button>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-6">
                {/* 1. AI Core Supplier */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    1. AI Core Supplier <span className="text-red-400">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {['gemini', 'nvidia', 'custom'].map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setAiConfig(prev => {
                          const defaults: Record<string, any> = {
                            gemini: { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
                            nvidia: { provider: 'nvidia', apiUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3-70b-instruct' },
                            custom: { provider: 'custom', apiUrl: 'http://localhost:8000/v1', model: 'gpt-4o' }
                          };
                          return {
                            ...prev,
                            ...defaults[p],
                            apiKey: prev.provider === p ? prev.apiKey : ''
                          };
                        })}
                        className={`py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider border transition-all cursor-pointer ${
                          aiConfig.provider === p
                            ? 'bg-blue-500/20 border-blue-500 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.15)]'
                            : 'bg-[#1F2833]/40 border-gray-700 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {p === 'nvidia' ? 'NVIDIA NIM' : p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. API Key */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    2. API Key <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="password"
                    required={aiConfig.provider !== 'custom'}
                    placeholder={aiConfig.provider === 'nvidia' ? "nvapi-..." : aiConfig.provider === 'gemini' ? "Google Gemini API Key..." : "API Key (Optional)..."}
                    value={aiConfig.apiKey}
                    onChange={e => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    className="w-full rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none transition-colors border border-gray-700 font-mono"
                    style={{ backgroundColor: '#1F2833', color: '#8A2BE2' }}
                  />
                </div>

                {/* 3. AI Model */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    3. AI Model <span className="text-red-400">*</span>
                  </label>
                  {aiConfig.provider === 'custom' ? (
                    <input
                      type="text"
                      required
                      placeholder="e.g. gpt-4o"
                      value={aiConfig.model}
                      onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                      className="w-full rounded-lg px-4 py-2 text-sm focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none transition-colors border border-gray-700 font-mono"
                      style={{ backgroundColor: '#1F2833', color: '#8A2BE2' }}
                    />
                  ) : loadingModels ? (
                    <div className="w-full rounded-lg px-4 py-2 text-xs border border-gray-700 text-gray-400 bg-[#1F2833] animate-pulse">
                      Scanning active models...
                    </div>
                  ) : (
                    <select
                      value={aiConfig.model}
                      onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                      className="w-full rounded-lg px-4 py-2.5 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none transition-colors border border-gray-700"
                      style={{ backgroundColor: '#1F2833', color: hoverColor }}
                    >
                      {(() => {
                        const models = availableModels.length > 0
                          ? availableModels
                          : (aiConfig.provider === 'gemini'
                              ? ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash', 'gemini-2.5-pro']
                              : ['meta/llama-3-70b-instruct', 'meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct']);
                        return models.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ));
                      })()}
                    </select>
                  )}
                </div>

                {/* 4. Recommended Models */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    4. Recommended Models
                  </label>
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-3.5 text-[10px] font-mono leading-relaxed">
                    <span className="text-[#06C6B3] font-bold uppercase block tracking-wider border-b border-white/5 pb-1">💡 Provider Model Recommendations:</span>
                    
                    <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1 scrollbar-thin">
                      {/* Gemini */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-[#8A2BE2] font-bold uppercase text-[9px]">✨ Google Gemini (Cloud)</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">gemini-1.5-flash</code> (fast response)</div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">gemini-1.5-pro</code> (high reasoning capability)</div>
                      </div>

                      {/* NVIDIA NIM */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-[#0099FF] font-bold uppercase text-[9px]">🟢 NVIDIA NIM</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">meta/llama-3-8b-instruct</code></div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">meta/llama-3-70b-instruct</code></div>
                      </div>

                      {/* Custom */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-amber-500 font-bold uppercase text-[9px]">⚙️ Custom OpenAI-Compatible</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">gpt-4o-mini</code></div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">gpt-4o</code></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Identity Scan Depth */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    5. Identity Scan Depth <span className="text-red-400">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Fast Scan', val: 5 },
                      { label: 'Standard Scan', val: 7 },
                      { label: 'Deep Scan', val: 10 },
                    ].map(opt => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setAiConfig(prev => ({ ...prev, maxQuestions: opt.val }))}
                        className={`py-2 rounded-lg font-bold text-xs uppercase tracking-wider border transition-all cursor-pointer ${
                          aiConfig.maxQuestions === opt.val
                            ? 'bg-[#8A2BE2]/20 border-[#8A2BE2] text-purple-300 shadow-[0_0_10px_rgba(138,43,226,0.2)]'
                            : 'bg-[#1F2833]/40 border-gray-700 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 6. Google Calendar Integration */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    6. Google Calendar Integration (Optional)
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSyncGoogleCalendar}
                      className="flex-1 py-3 rounded-xl border border-[#06C6B3]/40 text-[#66FCF1] hover:bg-[#06C6B3]/10 transition-all font-mono text-[10px] uppercase tracking-widest cursor-pointer font-bold shadow-[0_0_15px_rgba(6,198,179,0.1)]"
                    >
                      📅 Sync Calendar Events →
                    </button>
                    <button
                      type="button"
                      onClick={handleChangeGoogleAccount}
                      className="px-3 py-3 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all font-mono text-[10px] uppercase tracking-widest cursor-pointer font-bold shrink-0"
                      title="Change Google Account"
                    >
                      🔄 Change Account
                    </button>
                  </div>
                  <p className="text-[8px] text-gray-500 font-mono italic">
                    Locks your calendar events into Chronos to shield them from scheduling conflicts.
                  </p>
                </div>

                {/* 7. Phone Link Setup */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    7. Phone Link Setup (Optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem("chronos-onboarding-in-progress", "true");
                      router.push('/dashboard/phone-link');
                    }}
                    className="w-full py-3 rounded-xl border border-[#0099FF]/40 text-[#66FCF1] hover:bg-[#0099FF]/10 transition-all font-mono text-[10px] uppercase tracking-widest cursor-pointer font-bold shadow-[0_0_15px_rgba(0,153,255,0.1)]"
                  >
                    📱 Configure & Verify Phone Link →
                  </button>
                  <p className="text-[8px] text-gray-500 font-mono italic">
                    Configure real-time mobile push notifications via the secure Out-of-Band alert protocol.
                  </p>
                </div>

                {/* 8. Local Voice Daemon Setup (Mandatory) */}
                <div className="space-y-2 pt-2 border-t border-white/5 animate-in fade-in duration-300">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    8. Local Voice Daemon Setup (Mandatory)
                  </label>
                  
                  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${voiceDaemonOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400 animate-pulse'}`} />
                        <span className="text-[10px] font-mono uppercase tracking-wider text-gray-300">
                          Status: {voiceDaemonOnline ? 'Connected' : 'Offline'}
                        </span>
                      </div>
                      <p className="text-[8px] text-gray-500 font-mono">
                        Audio notifications bridge interface for real-time temporal alerts.
                      </p>
                      {!voiceDaemonOnline && (
                        <div className="space-y-1 mt-1.5">
                          {showDownloadPrompt && (
                            <p className="text-[8px] text-amber-400 font-mono animate-pulse">
                              No local daemon found. Download the voice daemon below.
                            </p>
                          )}
                          <a
                            href="/chronos_voice_daemon.exe"
                            download="chronos_voice_daemon.exe"
                            className="block text-[8px] text-[#66FCF1] underline font-mono hover:text-[#0099FF] transition-colors font-bold"
                          >
                            ⬇️ Download Voice Daemon (Windows EXE)
                          </a>
                        </div>
                      )}
                    </div>
                    
                    {!voiceDaemonOnline && (
                      <button
                        type="button"
                        onClick={handleSpawnLocalDaemon}
                        className="px-3 py-1.5 rounded-lg bg-[#0099FF]/20 border border-[#0099FF]/40 text-[#66FCF1] hover:bg-[#0099FF]/30 transition-all font-mono text-[8px] uppercase tracking-wider cursor-pointer font-bold shrink-0"
                      >
                        ⚡ Launch Daemon
                      </button>
                    )}
                  </div>
                </div>

                {/* 9. Advanced Connection Settings */}
                <details className="group border border-gray-800 rounded-lg p-2.5 bg-[#1F2833]/15 transition-all">
                  <summary className="text-[10px] font-bold uppercase tracking-widest text-gray-400 cursor-pointer list-none flex justify-between items-center select-none">
                    <span>9. Advanced Connection Settings</span>
                    <span className="text-[8px] text-[#06C6B3] opacity-60 group-open:rotate-180 transition-transform duration-200">▼</span>
                  </summary>
                  <div className="mt-3 pt-2 border-t border-gray-800/60">
                    <label className="block mb-1 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                      API Base URL Override
                    </label>
                    <input
                      type="text"
                      required
                      value={aiConfig.apiUrl}
                      onChange={e => setAiConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                      className="w-full rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-[#06C6B3] focus:outline-none transition-colors border border-gray-700 font-mono"
                      style={{ backgroundColor: '#1F2833', color: '#66FCF1' }}
                    />
                  </div>
                </details>

                {/* Submit Button */}
                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={connectionStatus === 'offline' || !voiceDaemonOnline}
                    className={`w-full py-4 rounded-2xl font-bold uppercase tracking-widest transition-all text-xs cursor-pointer ${
                      (connectionStatus === 'offline' || !voiceDaemonOnline)
                        ? 'bg-gray-800 border border-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-[#06C6B3] to-[#8A2BE2] hover:opacity-90 text-white shadow-[0_0_20px_rgba(6,198,179,0.25)]'
                    }`}
                  >
                    {connectionStatus === 'checking'
                      ? 'Checking Connection...'
                      : connectionStatus === 'offline'
                        ? 'Core Offline (Reverify above)'
                        : !voiceDaemonOnline
                          ? 'Waiting for Voice Daemon Setup...'
                          : 'Apply Config & Begin Diagnostics'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 1.5: "Let's Get to Know You" Onboarding Explanation */}
          {step === 'about' && (
            <div className="max-w-xl w-full bg-black/15 border border-white/[0.08] p-8 rounded-3xl backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] space-y-6 animate-in fade-in duration-300">
              <div className="text-center space-y-2">
                <h2 className="text-xl md:text-2xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#06C6B3] to-[#8A2BE2]">
                  Let's Get to Know You
                </h2>
                <p className="text-[9px] text-[#06C6B3] font-semibold uppercase tracking-widest">
                  Initializing Adaptive Identity Scan
                </p>
              </div>

              <div className="space-y-4 text-xs md:text-sm text-gray-300 leading-relaxed">
                <p className="text-[#66FCF1]/95 font-medium border-l-2 border-[#06C6B3] pl-3 italic">
                  Chronos begins by conducting an adaptive Identity Scan, a conversational onboarding process designed to build a personalized performance twin of the user.
                </p>
                
                <div className="grid grid-cols-1 gap-3.5 mt-4">
                  <div className="p-3.5 rounded-2xl bg-[#1F2833]/25 border border-gray-800/80 flex gap-3">
                    <span className="text-base select-none">🧠</span>
                    <div>
                      <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-0.5">Dynamic Intelligence</h4>
                      <p className="text-[11px] text-gray-400 leading-normal">
                        Rather than relying on static forms or generic personality tests, the AI dynamically asks questions based on missing information, learning about your goals, schedule, work habits, motivations, strengths, weaknesses, and common sources of procrastination.
                      </p>
                    </div>
                  </div>
                  
                  <div className="p-3.5 rounded-2xl bg-[#1F2833]/25 border border-gray-800/80 flex gap-3">
                    <span className="text-base select-none">🔮</span>
                    <div>
                      <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-0.5">Predictive Performance</h4>
                      <p className="text-[11px] text-gray-400 leading-normal">
                        The resulting performance twin is not intended to simply describe you, but to predict your behavior, identify potential risks, and tailor interventions accordingly.
                      </p>
                    </div>
                  </div>
                  
                  <div className="p-3.5 rounded-2xl bg-[#1F2833]/25 border border-gray-800/80 flex gap-3">
                    <span className="text-base select-none">🔄</span>
                    <div>
                      <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-0.5">Continuous Evolution</h4>
                      <p className="text-[11px] text-gray-400 leading-normal">
                        As you continue interacting with the system, Chronos continuously updates this model, enabling more accurate planning, better deadline predictions, and highly personalized guidance that maximizes the likelihood of successful task completion.
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#1F2833]/25 border border-gray-800/80 flex gap-3">
                    <span className="text-base select-none">📅</span>
                    <div>
                      <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-0.5">Google Calendar Integration</h4>
                      <p className="text-[11px] text-gray-400 leading-normal">
                        Synchronizes your schedule with Google Calendar automatically. It locks critical time blocks, detects scheduling conflicts dynamically, and reschedules fluid tasks around absolute real-world commitments.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleStartScan}
                  className="w-full py-3.5 rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-300 hover:opacity-90 hover:shadow-[0_0_20px_rgba(6,198,179,0.3)] cursor-pointer bg-gradient-to-r from-[#06C6B3] to-[#8A2BE2] text-white"
                >
                  Begin Identity Scan
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Conversational Onboarding (Identity Scan) */}
          {step === 'questions' && (
            <div className="max-w-xl w-full bg-black/15 border border-white/[0.08] p-8 rounded-3xl backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] space-y-6 flex flex-col items-center text-center animate-in fade-in duration-300">
              {/* Scan Status Header */}
              <div className="w-full flex items-center justify-between border-b border-[#06C6B3]/10 pb-4">
                <div className="text-left space-y-0.5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#06C6B3]">
                    Identity Scan Active
                  </h2>
                  <p className="text-[9px] font-mono text-gray-500 uppercase">
                    Supplier: {aiConfig.provider.toUpperCase()} ({aiConfig.model})
                  </p>
                </div>
                <div className="text-right space-y-1 flex flex-col items-end">
                  <div className="text-[9px] font-mono text-[#8A2BE2] tracking-wider uppercase">
                    Cognitive Syncing...
                  </div>
                  {/* Infinite sweeping scanner animation */}
                  <div className="w-24 bg-[#1F2833] h-1 rounded-full overflow-hidden relative mt-1">
                    <div 
                      className="bg-gradient-to-r from-[#06C6B3] to-[#8A2BE2] h-full absolute w-8 animate-[scannerSweep_2s_ease-in-out_infinite]"
                    />
                  </div>
                </div>
              </div>

              {/* Question Area - Large, Focused, Clear */}
              <div className="py-8 min-h-[140px] flex items-center justify-center w-full">
                {chatLoading ? (
                  <div className="space-y-4">
                    <div className="w-10 h-10 border-t-2 border-b-2 border-[#06C6B3] rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-[#06C6B3] font-mono animate-pulse uppercase tracking-widest">
                      Analyzing responses...
                    </p>
                  </div>
                ) : scanError ? (
                  <div className="space-y-4 py-4 text-left border border-red-500/20 bg-red-950/20 p-6 rounded-2xl animate-in fade-in duration-200 w-full font-sans">
                    <div className="flex items-center gap-2 text-red-400 font-bold uppercase tracking-wider text-xs">
                      <span className="text-sm">⚠️</span> API Sync Interrupted (Offline)
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      Chronos failed to establish contact with the AI supplier:
                      <span className="block mt-1 font-mono text-[10px] text-red-300 p-2 bg-black/40 rounded border border-red-950/60 max-h-24 overflow-y-auto">
                        {scanError}
                      </span>
                    </p>
                    <div className="space-y-1.5 pt-2 text-[10px] text-gray-400">
                      <p className="font-bold text-gray-300 uppercase tracking-widest">Diagnostic Checklist:</p>
                      <ul className="list-disc pl-4 space-y-1 font-sans">
                        <li>Ensure that your internet connection is active and stable.</li>
                        <li>Make sure that your target model <code className="bg-black/30 px-1 py-0.5 rounded text-amber-400 font-mono text-[9px]">{aiConfig.model}</code> is supported by your provider.</li>
                        <li>Ensure the Chronos Python backend daemon is online on port 5000.</li>
                        <li>Check your API keys or base URL override under the AI Core Settings.</li>
                      </ul>
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setScanError(null);
                          setChatLoading(true);
                          const userMsgs = chatHistory.filter(m => m.role === 'user');
                          if (userMsgs.length === 0) {
                            setChatLoading(false);
                            startIdentityScan();
                          } else {
                            const tempHistory = [...chatHistory];
                            const lastMsg = tempHistory.pop();
                            if (lastMsg && lastMsg.role === 'user') {
                              setChatHistory(tempHistory);
                              setUserInput(lastMsg.content);
                              setChatLoading(false);
                            } else {
                              setChatLoading(false);
                            }
                          }
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-black font-bold font-mono text-[10px] transition-all cursor-pointer text-center uppercase tracking-wider focus:outline-none"
                      >
                        Retry Connection
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setScanError(null);
                          setStep('about');
                        }}
                        className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 font-mono text-[10px] hover:bg-white/10 transition-all cursor-pointer uppercase tracking-wider focus:outline-none"
                      >
                        Abort Scan
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-base md:text-lg text-[#c2fcf7]/95 font-medium leading-relaxed max-w-[90%] font-sans">
                    {getLastQuestion()}
                  </p>
                )}
              </div>

              {/* Input field */}
              {!scanError && (
                <form onSubmit={handleSendAnswer} className="w-full space-y-4">
                  <input
                    type="text"
                    required
                    disabled={chatLoading}
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    placeholder="Type your response..."
                    className="w-full rounded-xl px-5 py-3.5 text-xs text-center focus:ring-1 focus:ring-[#06C6B3] focus:outline-none transition-colors border border-gray-800 placeholder-gray-600 bg-[#1F2833]/30 text-[#66FCF1]"
                  />
                  <div className="flex justify-center">
                    <button
                      type="submit"
                      disabled={chatLoading}
                      className="px-8 py-3 rounded-lg font-bold text-xs uppercase tracking-widest transition-all duration-300 bg-[#06C6B3] hover:opacity-90 disabled:opacity-50 cursor-pointer text-[#0B0C10]"
                    >
                      Commit Response
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* STEP 3: Onboarding Complete & Summary Display */}
          {step === 'done' && (
            <div className="max-w-xl w-full bg-black/15 border border-white/[0.08] p-8 rounded-3xl backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] space-y-6 animate-in fade-in duration-300">
              <div className="text-center space-y-2">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full mx-auto"
                  style={{ backgroundColor: 'rgba(6, 198, 179, 0.15)', color: '#06C6B3' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-pulse">
                    <path d="M5 12l5 5 9-9" />
                  </svg>
                </div>
                <h2 className="text-xl md:text-2xl font-bold uppercase tracking-widest text-[#06C6B3]">
                  Identity Scan Complete
                </h2>
                <p className="text-xs text-gray-400 tracking-wide">
                  Your Performance Twin has been compiled and is now online.
                </p>
              </div>

              {/* Summary display box */}
              <div className="bg-[#1F2833]/25 border border-[#06C6B3]/10 rounded-3xl p-5 backdrop-blur-md shadow-2xl">
                {renderFormattedSummary(profileSummary)}
              </div>

              <div className="flex flex-col gap-2">
                <a
                  href="/dashboard"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo('/dashboard');
                  }}
                  className="inline-block text-center py-3 rounded-lg font-bold text-sm tracking-wider uppercase transition-all duration-300 hover:opacity-90 bg-gradient-to-r from-[#06C6B3] to-[#8A2BE2] text-white shadow-[0_0_15px_rgba(6,198,179,0.3)]"
                >
                  Access Chronos Dashboard
                </a>
                <button
                  onClick={reset}
                  className="block mx-auto text-xs underline opacity-50 hover:opacity-100 transition-opacity cursor-pointer text-gray-400"
                >
                  Reset Twin Configuration
                </button>
              </div>
            </div>
          )}
        </>
      )}
          </div>
        </div>
      )}
      </div>
      <Toaster position="top-center" theme="dark" />
    </>
  );
}

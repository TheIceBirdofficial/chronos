'use client';

import React, { useEffect, useRef } from 'react';

interface VoiceBlobCanvasProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'warning' | 'offline';
  size?: number;
  className?: string;
  theme?: 'purple' | 'blue';
  hasClockHands?: boolean;
  clockSpeed?: number;
}

export default function VoiceBlobCanvas({ 
  state, 
  size = 200, 
  className = "", 
  theme = "blue", 
  hasClockHands = false, 
  clockSpeed = 1.0 
}: VoiceBlobCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const themeRef = useRef(theme);
  const hasClockHandsRef = useRef(hasClockHands);
  const clockSpeedRef = useRef(clockSpeed);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    hasClockHandsRef.current = hasClockHands;
  }, [hasClockHands]);

  useEffect(() => {
    clockSpeedRef.current = clockSpeed;
  }, [clockSpeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const width = canvas.width = size;
    const height = canvas.height = size;
    const cx = width / 2;
    const cy = height / 2;
    const scale = size / 200;

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      color: string;
      angleOffset: number;
      history?: { x: number; y: number }[];
    }

    const particles: Particle[] = [];
    const numParticles = Math.round(size * 0.35); // Fewer particles for visual balance with the plasma shells

    const getColors = (currentState: typeof state, currentTheme: typeof theme) => {
      if (currentState === 'offline') {
        return ['#D50000', '#9E9E9E', '#37474F', '#757575'];
      }
      if (currentState === 'warning') {
        return ['#FF3D00', '#FF9100', '#FF5722', '#D50000'];
      }

      if (currentTheme === 'purple') {
        switch (currentState) {
          case 'listening':
            return ['#FF00FF', '#EE82EE', '#BA55D3', '#9370DB', '#8A2BE2'];
          case 'thinking':
            return ['#8A2BE2', '#4B0082', '#483D8B', '#9400D3', '#9370DB'];
          case 'speaking':
            return ['#c084fc', '#8A2BE2', '#EE82EE', '#DA70D6', '#00FFFF'];
          case 'idle':
          default:
            return ['#8A2BE2', '#9370DB', '#BA55D3', '#c084fc'];
        }
      } else {
        // blue theme
        switch (currentState) {
          case 'listening':
            return ['#00FFFF', '#00E5FF', '#18FFFF', '#64FFDA'];
          case 'thinking':
            return ['#0077FF', '#2979FF', '#3D5AFE', '#651FFF', '#8A2BE2'];
          case 'speaking':
            return ['#00d2ff', '#0066ff', '#8A2BE2', '#c084fc', '#00ffff'];
          case 'idle':
          default:
            return ['#00d2ff', '#0066ff', '#0033ff', '#66ccff'];
        }
      }
    };

    // Initialize particles floating near the shell boundary (scaled with size)
    for (let i = 0; i < numParticles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = (size * 0.22) + Math.random() * (size * 0.15);
      particles.push({
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        radius: Math.random() * 2.0 + 0.8, // Tiny glowing embers
        color: '#8A2BE2',
        angleOffset: Math.random() * Math.PI * 2,
        history: []
      });
    }

    let time = 0;
    let warpAngle = 0;
    let lastTime = Date.now();

    const animate = () => {
      const now = Date.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      time += 0.025;
      const currentState = stateRef.current;
      const currentTheme = themeRef.current;
      const hasClockHands = hasClockHandsRef.current;
      const clockSpeed = clockSpeedRef.current;

      // Update warp angle for clock hands
      if (hasClockHands) {
        if (clockSpeed > 1.0) {
          warpAngle += 90 * clockSpeed * delta; // speed in degrees per second
        } else {
          const d = new Date();
          const smoothSec = d.getSeconds() + d.getMilliseconds() / 1000;
          warpAngle = (smoothSec / 60) * 360;
        }
      }

      // Physics configuration depending on state (scaled with canvas scale factor)
      let baseRadius = 55 * scale;
      let wobbleAmp = 8 * scale;
      let wobbleFreq = 2.0;
      let swirl = 0.06;
      let pull = 0.14;
      let noise = 0.22;

      if (currentState === 'listening') {
        baseRadius = 58 * scale;
        wobbleAmp = 18 * scale;
        wobbleFreq = 5.0;
        swirl = 0.10;
        pull = 0.25;
        noise = 0.45;
      } else if (currentState === 'thinking') {
        baseRadius = 24 * scale;
        wobbleAmp = 5 * scale;
        wobbleFreq = 1.8;
        swirl = 0.55;
        pull = 0.32;
        noise = 0.12;
      } else if (currentState === 'speaking') {
        const pulse = Math.sin(time * 4.5) * 14 + Math.cos(time * 9) * 6;
        baseRadius = (58 + Math.max(-10, pulse)) * scale;
        wobbleAmp = (13 + Math.max(0, pulse)) * scale;
        wobbleFreq = 3.2;
        swirl = 0.14;
        pull = 0.16;
        noise = 0.32;
      } else if (currentState === 'warning') {
        baseRadius = 55 * scale;
        wobbleAmp = 15 * scale;
        wobbleFreq = 4.0;
        swirl = 0.10;
        pull = 0.20;
        noise = 0.40;
      } else if (currentState === 'offline') {
        baseRadius = 45 * scale;
        wobbleAmp = 2 * scale;
        wobbleFreq = 0.6;
        swirl = 0.01;
        pull = 0.05;
        noise = 0.06;
      }

      // Clear the canvas completely for transparent background
      ctx.clearRect(0, 0, width, height);

      // Draw central glowing core
      const colorsList = getColors(currentState, currentTheme);
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 1.4);
      
      if (currentState === 'offline') {
        glowGrad.addColorStop(0, 'rgba(180, 0, 0, 0.25)');
        glowGrad.addColorStop(0.5, 'rgba(60, 0, 0, 0.12)');
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (currentState === 'warning') {
        glowGrad.addColorStop(0, 'rgba(255, 61, 0, 0.3)');
        glowGrad.addColorStop(0.5, 'rgba(255, 145, 0, 0.12)');
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (currentState === 'thinking') {
        if (currentTheme === 'purple') {
          glowGrad.addColorStop(0, 'rgba(138, 43, 226, 0.38)');
          glowGrad.addColorStop(0.5, 'rgba(75, 0, 130, 0.15)');
        } else {
          glowGrad.addColorStop(0, 'rgba(101, 31, 255, 0.35)');
          glowGrad.addColorStop(0.5, 'rgba(0, 119, 255, 0.15)');
        }
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (currentState === 'listening') {
        if (currentTheme === 'purple') {
          glowGrad.addColorStop(0, 'rgba(255, 0, 255, 0.38)');
          glowGrad.addColorStop(0.5, 'rgba(138, 43, 226, 0.15)');
        } else {
          glowGrad.addColorStop(0, 'rgba(0, 255, 255, 0.38)');
          glowGrad.addColorStop(0.5, 'rgba(0, 229, 255, 0.15)');
        }
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        // idle & speaking
        if (currentTheme === 'purple') {
          glowGrad.addColorStop(0, 'rgba(138, 43, 226, 0.35)');
          glowGrad.addColorStop(0.5, 'rgba(186, 85, 211, 0.12)');
        } else {
          glowGrad.addColorStop(0, 'rgba(0, 210, 255, 0.35)');
          glowGrad.addColorStop(0.5, 'rgba(0, 102, 255, 0.12)');
        }
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }
      
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // Helper function to draw concentric, wobbly plasma rings
      const drawWobblyRing = (
        radius: number,
        speedMultiplier: number,
        wobbleAmplitude: number,
        color: string,
        lineWidth: number,
        opacity: number,
        seed: number
      ) => {
        ctx.beginPath();
        const steps = 90;
        for (let i = 0; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          
          // Multi-frequency noise for organic wobbly movement
          const w1 = Math.sin(angle * 3 + time * 3.2 * speedMultiplier + seed) * wobbleAmplitude * 0.5;
          const w2 = Math.cos(angle * 5 - time * 2.0 * speedMultiplier + seed * 1.5) * wobbleAmplitude * 0.35;
          const w3 = Math.sin(angle * 7 + time * 4.2 * speedMultiplier) * wobbleAmplitude * 0.15;
          
          const currentR = radius + w1 + w2 + w3;
          const x = cx + Math.cos(angle) * currentR;
          const y = cy + Math.sin(angle) * currentR;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = opacity;
        ctx.stroke();
      };

      // Draw wobbly plasma shell rings
      ctx.shadowBlur = 14 * scale;
      
      const idxColor = (i: number) => i % colorsList.length;

      if (currentState !== 'offline') {
        // Outer faint aura ring
        ctx.shadowColor = colorsList[0];
        drawWobblyRing(baseRadius * 1.15, 0.8, wobbleAmp * 1.2, colorsList[idxColor(1)], 1.2 * scale, 0.22, 100);

        // Middle main energy shell ring
        ctx.shadowColor = colorsList[idxColor(2)];
        drawWobblyRing(baseRadius * 0.98, 1.3, wobbleAmp * 0.9, colorsList[idxColor(0)], 1.8 * scale, 0.42, 200);

        // Inner bright core boundary ring
        ctx.shadowColor = colorsList[idxColor(3)];
        drawWobblyRing(baseRadius * 0.8, 0.6, wobbleAmp * 0.6, colorsList[idxColor(1)], 2.5 * scale, 0.60, 300);
      } else {
        // Offline state (lifeless, flat)
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        drawWobblyRing(baseRadius, 0.2, wobbleAmp, colorsList[0], 1.5 * scale, 0.4, 0);
      }
      
      // Reset shadows for central spiral / details
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;

      // Thinking State Swirl Vortex
      if (currentState === 'thinking') {
        ctx.beginPath();
        const spiralSteps = 120;
        ctx.lineWidth = 2.0 * scale;
        ctx.strokeStyle = colorsList[0];
        ctx.shadowBlur = 10 * scale;
        ctx.shadowColor = colorsList[0];
        ctx.globalAlpha = 0.75;
        for (let i = 0; i < spiralSteps; i++) {
          const theta = (i / spiralSteps) * Math.PI * 8; // 4 rotations
          const spiralR = (baseRadius * 0.85) * (1 - i / spiralSteps); // shrink inward
          const spiralAngle = theta - time * 5.0; // spin speed
          const x = cx + Math.cos(spiralAngle) * spiralR;
          const y = cy + Math.sin(spiralAngle) * spiralR;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
      }

      // Listening State Expanding Waves
      if (currentState === 'listening') {
        const ringRadius = (baseRadius * 1.25) + ((time * 40) % (size * 0.22));
        const ringOpacity = 0.28 * (1 - ((ringRadius - baseRadius * 1.25) / (size * 0.22)));
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = colorsList[1 % colorsList.length];
        ctx.lineWidth = 1.5 * scale;
        ctx.globalAlpha = ringOpacity;
        ctx.shadowBlur = 8 * scale;
        ctx.shadowColor = colorsList[1 % colorsList.length];
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
      }

      // Update stardust embers (particles swirling around core)
      particles.forEach((p, idx) => {
        const orbitSpeed = currentState === 'thinking' ? 0.08 : currentState === 'listening' ? 0.055 : 0.03;
        
        // Find angle and distance from center
        const dx = p.x - cx;
        const dy = p.y - cy;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let angle = Math.atan2(dy, dx);
        
        // Swirl in orbital gravity path
        angle += orbitSpeed;
        
        // Dynamic wobbly distance
        const wobble = Math.sin(time * 2.5 + p.angleOffset) * (wobbleAmp * 0.4);
        const targetDist = (baseRadius * 0.95) + wobble;
        
        // Attract to orbital path
        dist += (targetDist - dist) * pull;
        
        // Re-calculate position with mild noise
        p.x = cx + Math.cos(angle) * dist + (Math.random() - 0.5) * noise;
        p.y = cy + Math.sin(angle) * dist + (Math.random() - 0.5) * noise;
        
        p.color = colorsList[idx % colorsList.length];

        // Particle trail
        if (!p.history) p.history = [];
        p.history.push({ x: p.x, y: p.y });
        if (p.history.length > 5) {
          p.history.shift();
        }
      });

      // Draw particle trails
      ctx.globalCompositeOperation = 'screen';
      particles.forEach((p) => {
        if (!p.history || p.history.length === 0) return;
        ctx.shadowBlur = 0;
        for (let i = 0; i < p.history.length - 1; i++) {
          const pos = p.history[i];
          const alpha = (i + 1) / p.history.length;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, p.radius * (0.3 + 0.7 * alpha), 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = alpha * 0.30;
          ctx.fill();
        }
      });

      // Draw stardust embers
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 5 * scale;
        ctx.shadowColor = p.color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
      });

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'source-over';

      // Draw functional clock hands inside the blob (if enabled)
      if (hasClockHands) {
        // Calculate hand rotation angles based on warp states
        let secondAngle = 0;
        let minuteAngle = 0;
        let hourAngle = 0;

        if (clockSpeed > 1.0) {
          secondAngle = warpAngle - 90;
          minuteAngle = (warpAngle / 12) - 90;
          hourAngle = (warpAngle / 144) - 90;
        } else {
          const d = new Date();
          const smoothSec = d.getSeconds() + d.getMilliseconds() / 1000;
          const smoothMin = d.getMinutes() + smoothSec / 60;
          const smoothHr = d.getHours() + smoothMin / 60;

          secondAngle = (smoothSec / 60) * 360 - 90;
          minuteAngle = (smoothMin / 60) * 360 - 90;
          hourAngle = ((smoothHr % 12) / 12) * 360 - 90;
        }

        const getPoint = (angle: number, length: number) => {
          const rad = (angle * Math.PI) / 180;
          return {
            x: cx + length * Math.cos(rad),
            y: cy + length * Math.sin(rad),
          };
        };

        const hrLength = size * 0.19;
        const minLength = size * 0.27;
        const secLength = size * 0.31;

        const hourHand = getPoint(hourAngle, hrLength);
        const minuteHand = getPoint(minuteAngle, minLength);
        const secondHand = getPoint(secondAngle, secLength);

        // Draw Clock Hands with glowing shadow drops
        ctx.shadowBlur = 8 * scale;
        ctx.lineCap = 'round';

        // Hour Hand
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(hourHand.x, hourHand.y);
        ctx.strokeStyle = currentTheme === 'purple' ? '#a23df5' : '#00b2ff';
        ctx.lineWidth = 3.5 * scale;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.globalAlpha = 0.95;
        ctx.stroke();

        // Minute Hand
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(minuteHand.x, minuteHand.y);
        ctx.strokeStyle = currentTheme === 'purple' ? '#c084fc' : '#66FCF1';
        ctx.lineWidth = 2.5 * scale;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.globalAlpha = 0.95;
        ctx.stroke();

        // Second Hand Trail (draw trails if warping)
        if (clockSpeed > 1.0) {
          const trailCount = 6;
          for (let i = 1; i <= trailCount; i++) {
            const trailAngle = secondAngle - i * 3.5;
            const trailPoint = getPoint(trailAngle, secLength);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(trailPoint.x, trailPoint.y);
            ctx.strokeStyle = currentTheme === 'purple' ? 'rgba(138, 43, 226, 0.4)' : 'rgba(6, 198, 179, 0.4)';
            ctx.lineWidth = 1.2 * (1 - i / (trailCount + 1)) * scale;
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.globalAlpha = (1 - i / (trailCount + 1)) * 0.35;
            ctx.stroke();
          }
        }

        // Second Hand
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(secondHand.x, secondHand.y);
        ctx.strokeStyle = currentTheme === 'purple' ? '#66FCF1' : '#8A2BE2';
        ctx.lineWidth = 1.5 * scale;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 6 * scale;
        ctx.globalAlpha = 0.95;
        ctx.stroke();

        // Center Pin
        ctx.beginPath();
        ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2);
        ctx.fillStyle = currentTheme === 'purple' ? '#c084fc' : '#66FCF1';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 4 * scale;
        ctx.globalAlpha = 1.0;
        ctx.fill();
        
        ctx.shadowBlur = 0;
      }

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [size]);

  return (
    <canvas 
      ref={canvasRef} 
      width={size} 
      height={size} 
      className={className}
      style={{ display: 'block', pointerEvents: 'none' }}
    />
  );
}

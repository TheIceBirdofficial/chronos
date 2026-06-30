import React, { useEffect, useState } from 'react';

interface Props {
  riskBefore: number;
  riskAfter: number;
  recoveredHours?: number;
  streakCount?: number;
  confidenceBoost?: number;
  durationMinutes?: number;
  onDismiss: () => void;
}

export default function RecoveryCompletionBanner({
  riskBefore,
  riskAfter,
  recoveredHours,
  streakCount,
  confidenceBoost,
  durationMinutes = 1,
  onDismiss
}: Props) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setAnimate(true);
  }, []);

  return (
    <div className="relative flex flex-col items-center justify-center p-6 bg-[#0B0C10]/90 border border-[#66FCF1]/30 rounded-2xl shadow-[0_0_30px_rgba(102,252,225,0.15)] text-center overflow-hidden w-full min-h-[400px]">
      <style>{`
        @keyframes ring-expand {
          0% {
            transform: scale(0.4);
            opacity: 0.8;
          }
          100% {
            transform: scale(2.8);
            opacity: 0;
          }
        }
        .blue-ring {
          position: absolute;
          width: 200px;
          height: 200px;
          border: 2px solid rgba(102, 252, 241, 0.4);
          border-radius: 50%;
          box-shadow: 0 0 25px rgba(102, 252, 241, 0.2);
          pointer-events: none;
        }
        .ring-1 {
          animation: ring-expand 3s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
        }
        .ring-2 {
          animation: ring-expand 3s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
          animation-delay: 1s;
        }
        .ring-3 {
          animation: ring-expand 3s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
          animation-delay: 2s;
        }
        .glow-text {
          text-shadow: 0 0 10px rgba(102, 252, 241, 0.6);
        }
      `}</style>

      {/* Stabilization Ring Animation */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="blue-ring ring-1"></div>
        <div className="blue-ring ring-2"></div>
        <div className="blue-ring ring-3"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 space-y-6 max-w-sm">
        <div className="space-y-1">
          <span className="text-[10px] text-[#66FCF1] tracking-[0.3em] uppercase font-mono block glow-text">
            Singularity Stabilized
          </span>
          <h2 className="text-2xl font-black tracking-wider text-white uppercase">
            Recovery Complete
          </h2>
          <p className="text-[11px] text-gray-400 font-sans italic">
            The chaotic temporal energy calms.
          </p>
        </div>

        {/* Risk Transition Display */}
        <div className="bg-black/40 border border-white/5 rounded-2xl p-4 flex justify-around items-center space-x-4">
          <div className="text-center">
            <span className="text-[8px] text-gray-500 uppercase tracking-widest font-mono block">Initial Risk</span>
            <span className="text-2xl font-bold text-red-500">{riskBefore}%</span>
          </div>
          <div className="text-gray-500 text-lg font-mono">↓</div>
          <div className="text-center">
            <span className="text-[8px] text-[#66FCF1] uppercase tracking-widest font-mono block glow-text">Current Risk</span>
            <span className="text-2xl font-bold text-[#66FCF1] glow-text">{riskAfter}%</span>
          </div>
        </div>

        {/* Stabilization Duration Badge */}
        <div className="text-[10px] font-mono text-cyan-400 bg-cyan-950/20 border border-[#66FCF1]/20 py-1.5 px-3 rounded-full inline-block">
          ⚡ Stabilized in <span className="font-bold text-white">{durationMinutes}</span> {durationMinutes === 1 ? 'minute' : 'minutes'}
        </div>

        {/* Statistics Grid */}
        <div className="grid grid-cols-3 gap-2 font-mono text-[10px] uppercase text-gray-400">
          <div className="bg-white/5 border border-white/5 p-2 rounded-xl">
            <span className="block text-white font-bold text-sm">{recoveredHours != null ? `${recoveredHours}h` : '—'}</span>
            Recovered
          </div>
          <div className="bg-white/5 border border-white/5 p-2 rounded-xl">
            <span className="block text-white font-bold text-sm">{confidenceBoost != null ? `+${confidenceBoost}%` : '—'}</span>
            Confidence
          </div>
          <div className="bg-white/5 border border-white/5 p-2 rounded-xl">
            <span className="block text-[#66FCF1] font-bold text-sm glow-text">{streakCount != null ? streakCount : '—'}</span>
            Defended
          </div>
        </div>

        {/* Dismiss Button */}
        <button
          onClick={onDismiss}
          className="w-full py-3 px-6 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-[#66FCF1]/20 to-[#66FCF1]/40 border border-[#66FCF1]/40 text-[#66FCF1] hover:bg-[#66FCF1]/50 hover:text-black transition-all duration-300 shadow-[0_0_15px_rgba(102,252,241,0.2)]"
        >
          Dismiss & Sync
        </button>
      </div>
    </div>
  );
}

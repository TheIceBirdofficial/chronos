'use client';

import React, { useState, useEffect } from 'react';

const STAGES = [
  "Synchronizing telemetry",
  "Loading operator profile",
  "Evaluating schedule conflicts",
  "Running future simulations",
  "Identifying critical blockers",
  "Generating recovery strategy",
  "Optimizing execution timeline",
  "Finalizing mission briefing"
];

export default function RecoveryLoadingPipeline({ isActive }: { isActive: boolean }) {
  const [currentStage, setCurrentStage] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setCurrentStage(0);
      setProgress(0);
      return;
    }

    let stageIndex = 0;
    const totalStages = STAGES.length;
    const stageDuration = 1800;

    const advanceStage = () => {
      if (stageIndex < totalStages) {
        setCurrentStage(stageIndex);
        setProgress(Math.round(((stageIndex + 1) / totalStages) * 100));
        stageIndex++;
      }
    };

    advanceStage();
    const interval = setInterval(advanceStage, stageDuration);

    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-5">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-2 border-[#8A2BE2]/20 rounded-full" />
        <div className="absolute inset-0 border-2 border-t-[#66FCF1] border-r-transparent border-b-[#8A2BE2] border-l-transparent rounded-full animate-spin" style={{ animationDuration: '1.2s' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-mono font-bold text-[#66FCF1]">{progress}%</span>
        </div>
      </div>

      <div className="text-center space-y-1">
        <p className="text-[10px] text-[#66FCF1] font-bold uppercase tracking-widest animate-pulse">
          {STAGES[currentStage] || "Processing"}
        </p>
        <p className="text-[8px] text-gray-600 font-mono uppercase tracking-wider">
          AI Recovery Agent active
        </p>
      </div>

      <div className="w-full max-w-[220px] space-y-1.5">
        {STAGES.map((stage, idx) => {
          const isComplete = idx < currentStage;
          const isCurrent = idx === currentStage;
          return (
            <div key={idx} className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full flex items-center justify-center transition-all duration-500 ${
                isComplete ? 'bg-[#66FCF1] shadow-[0_0_6px_rgba(102,252,241,0.5)]' :
                isCurrent ? 'bg-[#8A2BE2] animate-pulse shadow-[0_0_6px_rgba(138,43,226,0.5)]' :
                'bg-gray-800'
              }`}>
                {isComplete && (
                  <svg className="w-1 h-1 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`text-[8px] font-mono transition-all duration-500 ${
                isComplete ? 'text-gray-400' :
                isCurrent ? 'text-[#66FCF1]' :
                'text-gray-600'
              }`}>
                {stage}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

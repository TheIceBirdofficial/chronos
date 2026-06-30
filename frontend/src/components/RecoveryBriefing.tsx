'use client';

import React, { useState } from 'react';

export interface Summary {
  confidence: number;
  risk: string;
  estimatedHours: number;
  objective: string;
}

export interface CriticalAction {
  priority: number;
  title: string;
  reason: string;
}

export interface TimelinePhase {
  phase: string;
  progress: number;
  status: string;
}

export interface RecoveryBriefing {
  summary: Summary;
  criticalActions: CriticalAction[];
  timeline: TimelinePhase[];
  recommendations: string[];
  riskLevel: string;
  riskExplanation: string;
}

const RISK_STYLES: Record<string, string> = {
  LOW: 'text-green-400 border-green-500/40 bg-green-950/30',
  MEDIUM: 'text-amber-400 border-amber-500/40 bg-amber-950/30',
  HIGH: 'text-orange-400 border-orange-500/40 bg-orange-950/30',
  CRITICAL: 'text-red-400 border-red-500/40 bg-red-950/30',
};

export default function RecoveryBriefing({ briefing }: { briefing: RecoveryBriefing }) {
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);

  return (
    <div className="space-y-3 animate-in fade-in duration-500">
      {/* Mission Overview */}
      <div className="bg-black/40 border border-white/5 p-4 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#66FCF1]">Mission Overview</h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${RISK_STYLES[briefing.riskLevel] || RISK_STYLES.MEDIUM}`}>
            {briefing.riskLevel}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Confidence</div>
            <div className="text-xl font-black text-white leading-tight">{briefing.summary.confidence}%</div>
          </div>
          <div>
            <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Remaining Work</div>
            <div className="text-xl font-black text-white leading-tight">{briefing.summary.estimatedHours}h</div>
          </div>
          <div>
            <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Mission Risk</div>
            <div className="text-xl font-black uppercase leading-tight">{briefing.riskLevel}</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mb-1">Primary Objective</div>
          <p className="text-[10px] text-gray-200 font-sans leading-relaxed">{briefing.summary.objective}</p>
        </div>
      </div>

      {/* Critical Actions */}
      <div className="bg-black/30 border border-white/5 p-4 rounded-2xl">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#8A2BE2] mb-3">Critical Actions</h3>
        <div className="space-y-2">
          {briefing.criticalActions.slice(0, 3).map((action) => (
            <div key={action.priority} className="bg-black/20 p-2.5 rounded-xl border border-white/5 animate-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${action.priority * 80}ms` }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[8px] font-bold text-[#66FCF1] uppercase tracking-wider">Priority {action.priority}</span>
              </div>
              <p className="text-[10px] text-white font-bold leading-relaxed">{action.title}</p>
              <p className="text-[9px] text-gray-400 font-mono mt-1">{action.reason}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-black/30 border border-white/5 p-4 rounded-2xl">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#bf5af2] mb-3">Recovery Timeline</h3>
        <div className="space-y-3">
          {briefing.timeline.map((phase, idx) => {
            const pct = Math.min(100, Math.max(0, phase.progress || 0));
            const bar = pct >= 100 ? 'bg-[#66FCF1]' : pct > 50 ? 'bg-[#8A2BE2]' : 'bg-[#bf5af2]';
            return (
              <div key={idx} className="animate-in slide-in-from-left-3 duration-400" style={{ animationDelay: `${idx * 60}ms` }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[9px] text-gray-300 font-mono">{phase.phase}</span>
                  <span className="text-[8px] text-gray-500 font-mono uppercase">{phase.status}</span>
                </div>
                <div className="w-full h-1.5 bg-gray-900 rounded-full overflow-hidden border border-gray-850">
                  <div className={`h-full ${bar} transition-all duration-700 ease-out`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Risk Assessment */}
      <div className="bg-black/30 border border-white/5 p-4 rounded-2xl">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-2">Risk Assessment</h3>
        <p className="text-[10px] text-gray-300 font-mono leading-relaxed">{briefing.riskExplanation}</p>
      </div>

      {/* Recommendations */}
      <div className="bg-black/30 border border-white/5 p-4 rounded-2xl">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#06C6B3] mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {briefing.recommendations.map((rec, idx) => (
            <li key={idx} className="flex items-start gap-2 text-[10px] text-gray-300">
              <span className="text-[#66FCF1] mt-0.5 font-bold">✓</span>
              <span className="font-sans leading-relaxed">{rec}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Collapsible Full Analysis */}
      <div className="border border-white/5 rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowFullAnalysis(!showFullAnalysis)}
          className="w-full flex items-center justify-between p-3 bg-black/20 hover:bg-black/30 transition-all cursor-pointer"
        >
          <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">View Full AI Analysis</span>
          <svg className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${showFullAnalysis ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showFullAnalysis && (
          <div className="p-4 border-t border-white/5 bg-black/40 max-h-[280px] overflow-y-auto custom-scrollbar">
            <p className="text-[10px] text-gray-400 font-mono leading-relaxed whitespace-pre-wrap">
              {briefing.summary.objective}
            </p>
            <p className="text-[10px] text-gray-500 font-mono mt-2">
              Confidence: {briefing.summary.confidence}% | Risk: {briefing.riskLevel} | Est. Work: {briefing.summary.estimatedHours}h
            </p>
            {briefing.criticalActions.map(a => (
              <p key={a.priority} className="text-[10px] text-gray-500 font-mono mt-1">
                {a.priority}. {a.title}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

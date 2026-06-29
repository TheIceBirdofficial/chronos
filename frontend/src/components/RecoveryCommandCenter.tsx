import { API_BASE } from "@/config";
import React, { useEffect, useState } from 'react';
import RecoveryChecklist from '@/components/RecoveryChecklist';
import RecoveryCompletionBanner from '@/components/RecoveryCompletionBanner';

interface StatusResponse {
  severity: string;
  severityColor: string;
  temporalDebtHours: number;
  temporalDebtDays: number;
  riskBefore: number;
  riskAfter: number;
  progress: number;
  checklist: string[];
}

interface CompletionStats {
  recoveredHours: number;
  streakCount: number;
  confidenceBoost: number;
}

export default function RecoveryCommandCenter({ taskId }: { taskId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completionStats, setCompletionStats] = useState<CompletionStats | null>(null);
  const [negotiation, setNegotiation] = useState('');
  const [progress, setProgress] = useState(0);
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(1);
  const [targetTime, setTargetTime] = useState<string>('');

  const getDefaultTargetTime = () => {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    const hr = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${hr}:${min}`;
  };

  const handleSetTargetTime = (val: string) => {
    setTargetTime(val);
    localStorage.setItem(`chronos-recovery-target-time-${taskId}`, val);
    window.dispatchEvent(new Event('storage'));
  };

  useEffect(() => {
    if (!taskId) return;
    
    // Set target time if not present
    const timeKey = `chronos-recovery-target-time-${taskId}`;
    const savedTime = localStorage.getItem(timeKey);
    if (savedTime) {
      setTargetTime(savedTime);
    } else {
      const defaultTime = getDefaultTargetTime();
      setTargetTime(defaultTime);
      localStorage.setItem(timeKey, defaultTime);
      window.dispatchEvent(new Event('storage'));
    }

    // Set start time if not already present
    const startTimeKey = `chronos-recovery-start-time-${taskId}`;
    if (!localStorage.getItem(startTimeKey)) {
      localStorage.setItem(startTimeKey, Date.now().toString());
    }
    // Load status
    fetch(`${API_BASE}/api/recovery/status?taskId=${taskId}`)
      .then(res => res.json())
      .then(data => {
        setStatus(data);
        // Initialize chat history from localStorage or default
        const chatKey = `chronos-recovery-chat-${taskId}`;
        const savedChat = localStorage.getItem(chatKey);
        if (savedChat) {
          try {
            setChatHistory(JSON.parse(savedChat));
          } catch (e) {
            initializeDefaultChat(data.checklist);
          }
        } else {
          initializeDefaultChat(data.checklist);
        }
      })
      .catch(err => console.warn('Failed to load recovery status', err));
  }, [taskId]);

  const initializeDefaultChat = (checklist: string[]) => {
    const defaultMsg = {
      role: 'assistant' as const,
      content: `Hello! I have initialized the recovery protocol. Let's work together to adjust this checklist if needed. What's a realistic goal for you?`
    };
    setChatHistory([defaultMsg]);
    localStorage.setItem(`chronos-recovery-chat-${taskId}`, JSON.stringify([defaultMsg]));
  };

  const handleCancel = () => {
    // Clear active recovery state and reload
    localStorage.removeItem('chronos-active-recovery-task-id');
    localStorage.removeItem(`chronos-recovery-chat-${taskId}`);
    localStorage.removeItem(`chronos-recovery-checklist-${taskId}`);
    localStorage.removeItem(`chronos-recovery-start-time-${taskId}`);
    window.location.reload();
  };

  const handleSubmitNegotiation = async () => {
    if (!negotiation.trim() || chatLoading || !status) return;
    const userMsg = negotiation.trim();
    setNegotiation('');
    setChatLoading(true);

    const updatedHistory = [
      ...chatHistory,
      { role: 'user' as const, content: userMsg }
    ];
    setChatHistory(updatedHistory);
    localStorage.setItem(`chronos-recovery-chat-${taskId}`, JSON.stringify(updatedHistory));

    // Get config from localStorage
    let aiConfig = { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash', apiKey: '' };
    const savedConfig = localStorage.getItem("chronos-ai-config");
    if (savedConfig) {
      try {
        aiConfig = JSON.parse(savedConfig);
      } catch (e) {}
    }

    const SYSTEM_RESCUE_PROMPT = `You are the Chronos Recovery Agent. The user is struggling with procrastination. The current plan checklist is: ${JSON.stringify(status.checklist)}.
The user wants to negotiate or refine the recovery plan checklist.
Work with them to adjust the micro-steps so they can finish within their estimated work hours and available timeframe.
Always format your responses with the modified checklist inside a JSON-like array block: [NEW_CHECKLIST: ["Step 1", "Step 2", ...]] so the system can parse it, and explain why this plan will work. Keep responses under 3 sentences.`;

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
            { role: 'system', content: SYSTEM_RESCUE_PROMPT },
            ...updatedHistory
          ]
        })
      });

      if (!res.ok) throw new Error("AI request failed");
      const data = await res.json();
      let reply = data.content || "";

      // Parse NEW_CHECKLIST tag
      const match = reply.match(/\[NEW_CHECKLIST:\s*(\[[\s\S]*?\])\]/);
      if (match) {
        try {
          const newList = JSON.parse(match[1]);
          if (Array.isArray(newList)) {
            setStatus(prev => {
              if (!prev) return null;
              return { ...prev, checklist: newList };
            });

            // Sync checklist updates back to database task
            await fetch(`${API_BASE}/api/tasks/${taskId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                rescueResources: {
                  checklist: newList
                }
              })
            });
          }
        } catch (e) {
          console.error("Failed to parse checklist JSON", e);
        }
        reply = reply.replace(/\[NEW_CHECKLIST:\s*(\[[\s\S]*?\])\]/, '').trim();
      }

      const finalHistory = [
        ...updatedHistory,
        { role: 'assistant' as const, content: reply }
      ];
      setChatHistory(finalHistory);
      localStorage.setItem(`chronos-recovery-chat-${taskId}`, JSON.stringify(finalHistory));
    } catch (err) {
      console.error("Recovery chat failed:", err);
      const finalHistory = [
        ...updatedHistory,
        { role: 'assistant' as const, content: `[Error: Connection Interrupted] I was unable to compile an update. Please check that your AI Supplier is online.` }
      ];
      setChatHistory(finalHistory);
      localStorage.setItem(`chronos-recovery-chat-${taskId}`, JSON.stringify(finalHistory));
    } finally {
      setChatLoading(false);
    }
  };

  const handleAllChecked = async () => {
    try {
      const startTimeKey = `chronos-recovery-start-time-${taskId}`;
      const startTimeStr = localStorage.getItem(startTimeKey);
      let calculatedMinutes = 1;
      if (startTimeStr) {
        const elapsedMs = Date.now() - Number(startTimeStr);
        calculatedMinutes = Math.max(1, Math.round(elapsedMs / 60000));
      }
      setDurationMinutes(calculatedMinutes);

      const res = await fetch(`${API_BASE}/api/recovery/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      if (res.ok) {
        const data = await res.json();
        setCompletionStats(data);
        setCompleted(true);
      } else {
        throw new Error();
      }
    } catch (e) {
      console.error('Failed to complete recovery on backend', e);
      setCompleted(true);
    }
  };

  if (!status) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-[#0B0C10]/60 border border-gray-800 rounded-3xl backdrop-blur-sm h-[400px]">
        <div className="w-8 h-8 border-t-2 border-b-2 border-[#66FCF1] rounded-full animate-spin" />
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-4 animate-pulse">
          Loading Command Center...
        </span>
      </div>
    );
  }

  if (completed) {
    return (
      <RecoveryCompletionBanner
        riskBefore={status.riskBefore}
        riskAfter={status.riskAfter}
        recoveredHours={completionStats?.recoveredHours || status.temporalDebtHours}
        streakCount={completionStats?.streakCount || 1}
        confidenceBoost={completionStats?.confidenceBoost || 50}
        durationMinutes={durationMinutes}
        onDismiss={() => {
          setCompleted(false);
          setStatus(null);
          localStorage.removeItem('chronos-active-recovery-task-id');
          localStorage.removeItem(`chronos-recovery-chat-${taskId}`);
          localStorage.removeItem(`chronos-recovery-checklist-${taskId}`);
          localStorage.removeItem(`chronos-recovery-start-time-${taskId}`);
          window.location.reload();
        }}
      />
    );
  }

  const daysText = status.temporalDebtDays.toFixed(1);
  const hoursText = status.temporalDebtHours.toFixed(1);

  return (
    <div className="flex flex-col w-full h-[calc(100vh-140px)] min-h-[500px] bg-[#0B0C10]/70 border border-[#66FCF1]/30 p-5 rounded-3xl backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] space-y-4 overflow-y-auto custom-scrollbar relative">
      
      {/* Header section */}
      <div className="flex justify-between items-center pb-3 border-b border-gray-900/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#66FCF1] glow-text">
            Recovery Active
          </h2>
        </div>
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="px-2.5 py-1 rounded bg-red-950/40 border border-red-500/30 text-red-400 hover:bg-red-900/40 text-[9px] font-mono uppercase tracking-wider transition-all"
        >
          Cancel
        </button>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5 flex-shrink-0">
        <div className="flex justify-between text-[9px] font-mono text-gray-500 uppercase tracking-widest">
          <span>Stabilization Progress</span>
          <span className="text-[#66FCF1] font-bold">{progress}%</span>
        </div>
        <div className="w-full bg-gray-900 h-2 rounded-full overflow-hidden border border-gray-850">
          <div
            className="bg-gradient-to-r from-cyan-500 to-[#66FCF1] h-full transition-all duration-500 shadow-[0_0_10px_rgba(102,252,241,0.5)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="flex-shrink-0 border-b border-gray-900/40 pb-3">
        <RecoveryChecklist
          taskId={taskId}
          items={status.checklist}
          onAllChecked={handleAllChecked}
          onProgressChange={setProgress}
        />
      </div>

      {/* Metrics container */}
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        <div className="bg-black/30 border border-white/5 p-3 rounded-2xl space-y-1">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Temporal Debt</div>
          <div className="text-xl font-black text-white">{hoursText}h</div>
          <div className="text-[8px] text-gray-400 font-mono tracking-tighter">≈ {daysText}d behind</div>
        </div>
        <div className="bg-black/30 border border-white/5 p-3 rounded-2xl space-y-1">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Risk Projection</div>
          <div className="text-lg font-black text-red-400">{status.riskBefore}% ↓ {status.riskAfter}%</div>
          <div className="text-[8px] text-gray-400 font-mono tracking-tighter">Stabilizing...</div>
        </div>
      </div>

      {/* Target Completion Time Setup */}
      <div className="bg-black/30 border border-[#66FCF1]/20 p-3.5 rounded-2xl flex flex-col gap-2 flex-shrink-0">
        <div className="flex justify-between items-center">
          <span className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">Target Completion Time</span>
          {targetTime && (
            <span className="text-[9px] font-mono text-[#66FCF1] font-bold uppercase tracking-wider animate-pulse">
              ⏳ Complete by {targetTime}
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="time"
            value={targetTime}
            onChange={(e) => handleSetTargetTime(e.target.value)}
            className="flex-1 rounded-lg px-3 py-1.5 text-xs bg-[#1F2833]/40 text-gray-200 border border-gray-800 focus:outline-none focus:border-[#66FCF1]/30 transition-all font-mono"
          />
          <button
            onClick={() => {
              const d = new Date();
              d.setHours(d.getHours() + 2);
              const hr = String(d.getHours()).padStart(2, '0');
              const min = String(d.getMinutes()).padStart(2, '0');
              handleSetTargetTime(`${hr}:${min}`);
            }}
            className="px-2.5 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 text-[8px] font-mono uppercase tracking-wider rounded-lg transition-all cursor-pointer"
          >
            +2 Hours
          </button>
        </div>
      </div>

      {/* Negotiation Chat Box */}
      <div className="bg-black/35 border border-white/5 rounded-2xl p-3 flex flex-col h-[200px] flex-shrink-0 font-sans">
        <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest border-b border-white/5 pb-1.5 mb-2 flex justify-between">
          <span>💬 Negotiate with Chronos</span>
          <span className={`text-[8px] uppercase tracking-wide font-extrabold ${status.severityColor}`}>
            {status.severity} Severity
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar text-[10px] mb-2 font-mono">
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`p-2 rounded-xl max-w-[90%] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#8A2BE2]/10 border border-[#8A2BE2]/20 text-purple-200 ml-auto text-right'
                : 'bg-[#1F2833]/40 border border-gray-800 text-cyan-200 mr-auto text-left'
            }`}>
              {msg.content}
            </div>
          ))}
          {chatLoading && (
            <div className="text-[#66FCF1] font-mono text-[8px] animate-pulse">Updating timeline...</div>
          )}
        </div>

        <div className="flex gap-1.5 border-t border-white/5 pt-2">
          <input
            type="text"
            placeholder="Propose a counteroffer..."
            value={negotiation}
            onChange={e => setNegotiation(e.target.value)}
            disabled={chatLoading}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmitNegotiation();
              }
            }}
            className="flex-1 rounded-lg px-2.5 py-1.5 text-[10px] bg-[#1F2833]/40 text-gray-200 border border-gray-800 focus:outline-none focus:border-[#66FCF1]/30 transition-all font-mono"
          />
          <button
            onClick={handleSubmitNegotiation}
            disabled={chatLoading || !negotiation.trim()}
            className="px-2.5 py-1 bg-gradient-to-r from-cyan-600 to-[#66FCF1] hover:opacity-90 disabled:opacity-50 text-black font-extrabold rounded-lg text-[9px] uppercase tracking-wider transition-all font-mono"
          >
            Send
          </button>
        </div>
      </div>

      {/* Cancel Confirmation Modal Overlay */}
      {showCancelConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 rounded-3xl transition-all duration-300">
          <div className="bg-black border border-red-500/40 p-5 rounded-2xl max-w-xs text-center space-y-4 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
            <h3 className="text-xs font-bold text-red-500 uppercase tracking-widest font-mono">
              ⚠️ Abort Recovery?
            </h3>
            <p className="text-[10px] text-gray-300 leading-relaxed font-sans">
              Recovery will end. Current completion: <span className="text-[#66FCF1] font-bold">{progress}%</span>. Estimated deadline risk: <span className="text-emerald-400 font-bold">{status.riskAfter}%</span> → <span className="text-red-400 font-bold">{status.riskBefore}%</span>. Continue?
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-3 py-1.5 bg-gray-800 text-gray-400 hover:text-white rounded-lg text-[9px] font-mono uppercase tracking-wider transition-all"
              >
                Keep Fighting
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 bg-red-950/40 border border-red-500/40 text-red-400 hover:bg-red-900/40 rounded-lg text-[9px] font-mono uppercase tracking-wider transition-all font-bold"
              >
                Abort Recovery
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

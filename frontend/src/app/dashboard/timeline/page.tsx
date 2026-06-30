'use client';
import { API_BASE } from "@/config";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from "sonner";
import { ParticleBackground } from "../../page";

interface Checkpoint {
  id: string;
  title: string;
  detail: string;
  status: 'completed' | 'active' | 'pending';
  scheduledTime: string;
  estimatedMinutes: number;
}

interface TimelineMilestone {
  id: string;
  title: string;
  status: 'completed' | 'active' | 'pending';
  scheduledTime: string;
  checkpoints: Checkpoint[];
  branchX: number; // horizontal offset for branching effect
}

interface Task {
  id: string;
  title: string;
  due: string;
  estimatedHours: number;
  importance: 'low' | 'medium' | 'high';
  survivalScore?: number;
  escalationLevel?: string;
  category?: string;
  timeline?: Array<{
    id: string;
    title: string;
    status: string;
    scheduledTime: string;
  }>;
}

const jsonParseSafe = (str: string) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
};

const BRANCH_OFFSETS = [-120, 0, 140, -60, 80, -100];

function TimelinePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = searchParams.get('taskId');

  const [task, setTask] = useState<Task | null>(null);
  const [milestones, setMilestones] = useState<TimelineMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [hoveredMile, setHoveredMile] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(true);

  // Timeline Personalization States
  const [personalizing, setPersonalizing] = useState(false);
  const [personalizationHistory, setPersonalizationHistory] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);
  const [personalizationInput, setPersonalizationInput] = useState("");
  const [personalizationLoading, setPersonalizationLoading] = useState(false);
  const [personalizationCompleted, setPersonalizationCompleted] = useState(false);

  useEffect(() => {
    // Route Guard: Prevent skipping onboarding
    const savedName = localStorage.getItem("chronos-username");
    const savedTwin = localStorage.getItem("chronos-performance-twin");
    if (!savedName || !savedTwin) {
      router.push('/');
      return;
    }

    setIsTransitioning(false);
    const savedConfig = localStorage.getItem('chronos-ai-config');
    if (savedConfig) setAiConfig(JSON.parse(savedConfig));
  }, []);

  useEffect(() => {
    if (!taskId) {
      setLoading(false);
      return;
    }

    // Two independent retry counters:
    //  - taskRetry: how many times we've polled while the task itself isn't found yet (max 6 × 1s = 6s)
    //  - checkpointRetry: how many times we've polled while the task exists but checkpoints aren't ready yet (max 15 × 2s = 30s)
    let taskRetry = 0;
    let checkpointRetry = 0;
    let isActive = true;

    const fetchAndExpand = async () => {
      if (!isActive) return;
      try {
        const res = await fetch(`${API_BASE}/api/tasks`);
        if (!res.ok) throw new Error('API offline');
        const tasks: Task[] = await res.json();
        const found = tasks.find(t => String(t.id) === String(taskId));

        if (!found) {
          if (taskRetry < 6) {
            taskRetry++;
            setTimeout(fetchAndExpand, 1000);
          } else {
            // Task genuinely not found — show error but do NOT navigate away
            setLoading(false);
            toast.error('Task not found in timeline database.');
          }
          return;
        }

        setTask(found);

        const rawTimeline = found.timeline || [];
        const hasCheckpoints = rawTimeline.length > 0 && rawTimeline.every((m: any) => m.checkpoints && m.checkpoints.length > 0);

        if (hasCheckpoints) {
          const expanded = await expandMilestonesWithAI(found);
          setMilestones(expanded);
          setLoading(false);
        } else if (rawTimeline.length > 0 && checkpointRetry >= 15) {
          // Timed out waiting for checkpoints — expand with AI/fallback using what we have
          const expanded = await expandMilestonesWithAI(found);
          setMilestones(expanded);
          setLoading(false);
        } else if (rawTimeline.length === 0 && checkpointRetry >= 15) {
          // No milestones at all after 30s — stop loading and show the empty state
          setLoading(false);
        } else {
          // Poll again in 2s while background charting runs
          checkpointRetry++;
          setTimeout(fetchAndExpand, 2000);
        }
      } catch (err) {
        console.error('Timeline fetch error:', err);
        setTimeout(fetchAndExpand, 3000);
      }
    };

    setLoading(true);
    fetchAndExpand();

    return () => {
      isActive = false;
    };
  }, [taskId, aiConfig]);

  const handlePersonalizationChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personalizationInput.trim()) return;
    if (personalizationLoading) return;

    const userInput = personalizationInput.trim();
    setPersonalizationInput("");
    setPersonalizationLoading(true);

    const updatedHistory = [
      ...personalizationHistory,
      { role: 'user' as const, content: userInput }
    ];
    setPersonalizationHistory(updatedHistory);

    try {
      const userMsgCount = updatedHistory.filter(m => m.role === 'user').length;
      let nextPrompt = "";
      if (userMsgCount === 1) {
        nextPrompt = `You are Chronos, a tactical AI schedule defender. The user wants to personalize their timeline.
User preference for timeline strategy: "${userInput}".
Acknowledge their choice in 1 sentence. Then, ask the second question exactly:
"What time of day is your focus peak? Are you a morning operator (06:00 - 12:00 focus peak) or night operator (18:00 - 24:00 focus peak)?"`;
      } else {
        nextPrompt = `You are Chronos, a tactical AI schedule defender. The user has finished personalization.
User focus peak: "${userInput}".
Reply in 1-2 sentences concluding that their timeline calibration is complete and they can now generate the branches. Include the phrase "Roadmap personalization complete."`;
      }

      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiConfig?.provider || 'gemini',
          apiUrl: aiConfig?.apiUrl || '',
          apiKey: aiConfig?.apiKey || '',
          model: aiConfig?.model || 'gemini-1.5-flash',
          messages: [{ role: 'user', content: nextPrompt }]
        })
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.content || "Roadmap personalization complete.";
        setPersonalizationHistory(prev => [
          ...prev,
          { role: 'assistant' as const, content: reply }
        ]);
        if (userMsgCount >= 2) {
          setPersonalizationCompleted(true);
        }
      } else {
        throw new Error();
      }
    } catch (err) {
      // Fallback answers if AI fails
      const userMsgCount = updatedHistory.filter(m => m.role === 'user').length;
      let reply = "";
      if (userMsgCount === 1) {
        reply = "Understood. Focus strategy logged. What time of day is your focus peak? Are you a morning operator (06:00 - 12:00 focus peak) or night operator (18:00 - 24:00 focus peak)?";
      } else {
        reply = "Roadmap personalization complete. Temporal parameters synchronized.";
        setPersonalizationCompleted(true);
      }
      setPersonalizationHistory(prev => [
        ...prev,
        { role: 'assistant' as const, content: reply }
      ]);
    } finally {
      setPersonalizationLoading(false);
    }
  };

  const handleUnlockTimeline = async () => {
    if (!task) return;
    setLoading(true);
    try {
      let catObj: any = {};
      if (task.category) {
        try {
          catObj = JSON.parse(task.category);
          if (!catObj || Array.isArray(catObj)) {
            catObj = { aiSummary: catObj };
          }
        } catch (e) {
          catObj = { raw: task.category };
        }
      }
      
      catObj.personalizedTimeline = true;
      catObj.personalizationLog = personalizationHistory;

      const res = await fetch(`${API_BASE}/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: JSON.stringify(catObj)
        })
      });

      if (!res.ok) throw new Error("Save failed");
      
      toast.success("Temporal Branching personalized and generated!");
      setPersonalizing(false);
      const updatedTask = await res.json();
      setTask(updatedTask);
      const expanded = await expandMilestonesWithAI(updatedTask);
      setMilestones(expanded);
    } catch (err) {
      toast.error("Failed to personalize timeline branches.");
    } finally {
      setLoading(false);
    }
  };

  const expandMilestonesWithAI = async (t: Task): Promise<TimelineMilestone[]> => {
    const savedConfig = localStorage.getItem('chronos-ai-config');
    const cfg = savedConfig ? JSON.parse(savedConfig) : null;

    const rawTimeline = t.timeline || [];
    if (rawTimeline.length === 0) return [];

    const expandedPromises = (rawTimeline as any[]).map(async (mile: any, i) => {
      let checkpoints: Checkpoint[] = [];
      
      // Re-use checkpoints if already generated passively on the backend!
      if (mile.checkpoints && mile.checkpoints.length > 0) {
        checkpoints = mile.checkpoints.map((cp: any, idx: number) => ({
          id: cp.id || `${mile.id}-cp${idx + 1}`,
          title: cp.title || `Step ${idx + 1}`,
          detail: cp.detail || '',
          status: cp.completed ? 'completed' as const : 'pending' as const,
          scheduledTime: mile.scheduledTime,
          estimatedMinutes: cp.estimatedMinutes || 30
        }));
      } else if (cfg && cfg.apiKey) {
        try {
          const score = t.survivalScore ?? 100;
          const escalation = t.escalationLevel ?? 'green';
          const urgencyMsg = 
            escalation === 'black' ? "CRITICAL DEADLINE COLLAPSED: Frame steps as post-deadline recovery, damage control and triage actions." :
            escalation === 'red' ? "CRITICAL DANGER: Frame steps as emergency speed run, core functionality only, discard all nice-to-haves." :
            escalation === 'orange' ? "HIGH RISK: Frame steps as focused, speed-optimized execution tasks." :
            "RELAXED/STANDARD: Frame steps as deliberate, quality-focused execution tasks.";

          const prompt = `You are Chronos, a tactical AI deadline defense system.
Task: "${t.title}" (estimated ${t.estimatedHours}h total, importance: ${t.importance}, survival score: ${score}%)
Milestone: "${mile.title}" (scheduled: ${mile.scheduledTime})
Urgency context: ${urgencyMsg}

Generate EXACTLY 3 to 5 highly specific, actionable checkpoint steps for this milestone.
Each checkpoint should be a concrete micro-task (not generic) and reflect the urgency context.
Respond ONLY with a raw JSON array of objects with keys:
- "title": short specific action (max 8 words)
- "detail": one-sentence description of what exactly to do
- "estimatedMinutes": estimated minutes (integer, e.g. 15, 30, 45)
No markdown, no explanation.`;

          const res = await fetch(`${API_BASE}/api/ai/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: cfg.provider,
              apiUrl: cfg.apiUrl,
              apiKey: cfg.apiKey,
              model: cfg.model,
              messages: [{ role: 'user', content: prompt }]
            })
          });

          if (res.ok) {
            const data = await res.json();
            let content = (data.content || '').trim();
            if (content.includes('```')) {
              const parts = content.split('```');
              for (const part of parts) {
                const s = part.trim().replace(/^json/, '').trim();
                if (s.startsWith('[')) { content = s; break; }
              }
            }
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              checkpoints = parsed.map((c: any, idx: number) => ({
                id: `${mile.id}-cp${idx + 1}`,
                title: c.title || `Step ${idx + 1}`,
                detail: c.detail || '',
                status: 'pending' as const,
                scheduledTime: mile.scheduledTime,
                estimatedMinutes: c.estimatedMinutes || 30
              }));
            }
          }
        } catch (err) {
          console.warn(`AI checkpoint expansion failed for milestone ${mile.id}:`, err);
        }
      }

      // Fallback checkpoints if AI fails
      if (checkpoints.length === 0) {
        const totalMins = Math.round((t.estimatedHours / rawTimeline.length) * 60);
        const cpCount = 3;
        const minsPerCp = Math.round(totalMins / cpCount);
        checkpoints = [
          { id: `${mile.id}-cp1`, title: `Initialize ${mile.title.split(':')[0] || 'phase'}`, detail: `Set up your workspace and gather all required resources for this phase.`, status: 'pending', scheduledTime: mile.scheduledTime, estimatedMinutes: minsPerCp },
          { id: `${mile.id}-cp2`, title: 'Core execution sprint', detail: `Focused work session: complete the main body of work for this milestone.`, status: 'pending', scheduledTime: mile.scheduledTime, estimatedMinutes: minsPerCp },
          { id: `${mile.id}-cp3`, title: 'Review & hand-off', detail: `Quality check: verify output is complete and ready for the next phase.`, status: 'pending', scheduledTime: mile.scheduledTime, estimatedMinutes: minsPerCp }
        ];
      }

      return {
        id: mile.id,
        title: mile.title,
        status: mile.status as any,
        scheduledTime: mile.scheduledTime,
        checkpoints,
        branchX: BRANCH_OFFSETS[i % BRANCH_OFFSETS.length]
      };
    });

    return Promise.all(expandedPromises);
  };

  const getRiskColor = (score: number | undefined) => {
    if (score === undefined) return '#8A2BE2';
    if (score >= 80) return '#66FCF1';
    if (score >= 60) return '#bf5af2';
    if (score >= 40) return '#FBBF24';
    if (score >= 20) return '#F97316';
    return '#EF4444';
  };

  const escalationColor = task?.escalationLevel === 'black' ? '#EF4444'
    : task?.escalationLevel === 'red' ? '#F97316'
    : task?.escalationLevel === 'orange' ? '#FBBF24'
    : task?.escalationLevel === 'yellow' ? '#bf5af2'
    : '#66FCF1';

  const hoursLeft = task?.due
    ? Math.max(0, Math.round((new Date(task.due).getTime() - Date.now()) / 36e5))
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <style>{`
          @keyframes scannerSweep {
            0% { left: -100%; }
            100% { left: 150%; }
          }
        `}</style>
        <ParticleBackground theme="dashboard" state="thinking" />
        
        {/* Futuristic HUD Container */}
        <div className="w-full max-w-md bg-black/60 border border-white/[0.08] rounded-3xl p-8 shadow-[0_8px_32px_rgba(0,153,255,0.25)] backdrop-blur-xl text-center space-y-6 z-10 relative animate-in zoom-in-95 duration-500">
          
          {/* Rotating Glowing Glyphs */}
          <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-[#0099FF]/20 animate-pulse" />
            <div className="absolute inset-2 rounded-full border-t-2 border-[#0099FF] animate-[spin_3s_linear_infinite]" />
            <div className="absolute inset-4 rounded-full border-b border-[#8A2BE2] animate-[spin_2s_linear_infinite_reverse]" />
            <span className="text-2xl animate-pulse">🌌</span>
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[#0099FF] flex items-center justify-center gap-1.5 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0099FF] animate-ping" />
              Adaptive Roadmap Charting
            </h2>
            <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono">
              Calibrating timeline partition matrices
            </p>
          </div>

          {/* Progress Loading Bar */}
          <div className="space-y-3">
            <div className="w-full h-1.5 bg-gray-950 rounded-full overflow-hidden relative border border-white/5">
              <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-[#0099FF] via-[#8A2BE2] to-[#66FCF1] w-2/3 rounded-full animate-[scannerSweep_2s_ease-in-out_infinite]" />
            </div>
            <div className="flex justify-between font-mono text-[8px] text-gray-500">
              <span className="animate-pulse">STATUS: CHARTING BRANCHES PASSIVELY</span>
              <span>TELEMETRY SYNCED</span>
            </div>
          </div>

          {/* Operation Status Log */}
          <div className="bg-white/5 border border-white/[0.03] rounded-2xl p-4 text-left font-mono text-[8px] text-gray-400 space-y-1.5 select-none">
            <div className="flex items-center justify-between text-emerald-400 font-semibold animate-pulse">
              <span>● ALIGNING TELEMETRY</span>
              <span>NODE: CORE_AI</span>
            </div>
            <div className="h-[1px] bg-white/5 my-2" />
            <div className="flex items-center gap-2">
              <span className="text-gray-600">[$]</span>
              <span className="animate-pulse">Mapping milestone checkpoints...</span>
            </div>
            <div className="flex items-center gap-2 text-gray-500 text-[7px]">
              <span>[!]</span>
              <span>This operates in the background. You may return to control at any time.</span>
            </div>
          </div>
          
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 font-mono text-[9px] uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow-[0_0_12px_rgba(255,255,255,0.02)]"
          >
            ← Return to control center (Run in background)
          </button>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="text-center space-y-4 z-10 relative">
          <p className="text-gray-400 font-mono text-sm">Task not found in timeline database.</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 rounded-lg border border-[#8A2BE2]/40 text-[#c084fc] text-xs font-mono uppercase tracking-wider hover:bg-[#8A2BE2]/10 transition-all cursor-pointer"
          >
            ← Return to Mission Control
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        body { background: #0B0C10; font-family: 'Inter', sans-serif; }
        .timeline-glow { filter: drop-shadow(0 0 8px var(--glow-color)); }
        .branch-line {
          background: linear-gradient(180deg, rgba(138,43,226,0.6) 0%, rgba(138,43,226,0.15) 100%);
        }
        .milestone-node {
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .milestone-node:hover {
          transform: scale(1.08);
        }
        .checkpoint-card {
          animation: slideInLeft 0.4s ease both;
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .strange-particles {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none;
          z-index: 0;
          background: 
            radial-gradient(ellipse at 20% 50%, rgba(138,43,226,0.06) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 20%, rgba(6,198,179,0.04) 0%, transparent 40%),
            radial-gradient(ellipse at 60% 80%, rgba(139,43,226,0.04) 0%, transparent 40%);
        }
        .time-vine {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 2px;
          background: linear-gradient(180deg, 
            rgba(138,43,226,0.8) 0%, 
            rgba(192,132,252,0.5) 40%, 
            rgba(6,198,179,0.3) 80%,
            transparent 100%);
        }
      `}</style>

      <div className="strange-particles" />
      <ParticleBackground theme="dashboard" state="idle" />

      {/* Header nav */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center px-8 gap-6 bg-black/40 backdrop-blur-md border-b border-white/5">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-[9px] font-mono tracking-widest uppercase text-gray-500 hover:text-gray-300 cursor-pointer transition-colors"
        >
          ← Mission Control
        </button>
        <div className="h-4 w-[1px] bg-white/10" />
        <span className="text-[9px] font-mono tracking-widest uppercase text-[#8A2BE2]">
          Temporal Branch Viewer
        </span>
        <div className="flex-1" />
        <div
          className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded border"
          style={{ color: escalationColor, borderColor: `${escalationColor}40` }}
        >
          {hoursLeft}h Remaining
        </div>
      </header>

      <main
        className={`min-h-screen pt-24 pb-32 px-4 transition-all duration-700 ${
          isTransitioning ? 'opacity-0 scale-[0.97]' : 'opacity-100 scale-100'
        }`}
      >
        {personalizing ? (
          <div className="max-w-md mx-auto z-10 relative mt-8 space-y-6">
            <div className="bg-black/60 border border-[#8A2BE2]/30 rounded-3xl p-6 shadow-[0_8px_32px_0_rgba(138,43,226,0.2)] backdrop-blur-xl space-y-6">
              <div className="text-center space-y-2 border-b border-white/5 pb-4">
                <span className="text-[9px] font-mono text-purple-400 uppercase tracking-widest font-bold">
                  🔒 Calibration Required
                </span>
                <h2 className="text-base font-extrabold uppercase tracking-wider text-gray-200">
                  Timeline Branch Personalization
                </h2>
                <p className="text-[10px] text-gray-400 font-sans leading-relaxed">
                  Before Chronos generates the active temporal milestones, you must align the AI scheduling parameters with your productivity profile.
                </p>
              </div>

              {/* Chat Dialog */}
              <div className="h-[250px] overflow-y-auto bg-black/40 rounded-2xl p-4 border border-white/5 space-y-3 custom-scrollbar flex flex-col justify-end">
                <div className="space-y-3 overflow-y-auto pr-1">
                  {personalizationHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`text-[10px] font-mono leading-relaxed p-2.5 rounded-xl border max-w-[85%] ${
                        msg.role === 'assistant'
                          ? "bg-purple-950/20 border-purple-500/20 text-purple-300 mr-auto"
                          : "bg-[#06C6B3]/10 border-[#06C6B3]/20 text-[#66FCF1] ml-auto text-right"
                      }`}
                    >
                      {msg.content}
                    </div>
                  ))}
                  {personalizationLoading && (
                    <div className="text-[#06C6B3] font-mono text-[9px] animate-pulse">
                      Chronos is calibrating profile variables...
                    </div>
                  )}
                </div>
              </div>

              {/* Input Form */}
              {!personalizationCompleted ? (
                <form onSubmit={handlePersonalizationChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    required
                    disabled={personalizationLoading}
                    placeholder="Type your strategy preference..."
                    value={personalizationInput}
                    onChange={e => setPersonalizationInput(e.target.value)}
                    className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#8A2BE2] text-gray-200"
                  />
                  <button
                    type="submit"
                    disabled={personalizationLoading}
                    className="px-4 py-2 bg-[#8A2BE2] hover:opacity-90 disabled:opacity-50 text-white font-mono text-[10px] uppercase font-bold tracking-wider rounded-xl cursor-pointer"
                  >
                    Send
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={handleUnlockTimeline}
                  className="w-full py-3 bg-gradient-to-r from-green-500 to-[#06C6B3] hover:opacity-95 text-black font-mono font-bold text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow-[0_0_20px_rgba(102,252,241,0.25)] animate-pulse text-center"
                >
                  🚀 Initialize Adaptive Roadmap
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Task Header */}
            <div className="text-center mb-16 relative z-10">
              <div className="inline-block mb-4">
                <span
                  className="text-[8px] font-mono uppercase tracking-[0.4em] px-3 py-1 rounded-full border"
                  style={{ color: escalationColor, borderColor: `${escalationColor}30`, backgroundColor: `${escalationColor}08` }}
                >
                  {task.importance.toUpperCase()} PRIORITY · {task.escalationLevel?.toUpperCase() || 'ACTIVE'}
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white mb-3">
                {task.title}
              </h1>
              <div className="flex items-center justify-center gap-6 text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                <span>Due: {new Date(task.due).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="h-1 w-1 rounded-full bg-gray-700" />
                <span>Est. Work: {task.estimatedHours}h</span>
                <span className="h-1 w-1 rounded-full bg-gray-700" />
                <span style={{ color: getRiskColor(task.survivalScore) }}>
                  Survival: {task.survivalScore ?? '--'}%
                </span>
              </div>
            </div>

            {/* Dr. Strange Timeline Canvas */}
            <div className="relative z-10 max-w-6xl mx-auto">
              {milestones.length === 0 ? (
                <div className="text-center py-24 text-gray-500 text-sm font-mono">
                  No timeline milestones found for this task. Add a task with a deadline to generate a timeline.
                </div>
              ) : (
                <div className="relative">
                  {/* Central vertical vine */}
                  <div
                    className="time-vine"
                    style={{ height: `${milestones.length * 320 + 80}px`, top: 0 }}
                  />

                  {/* Milestones */}
                  <div className="relative space-y-0">
                    {milestones.map((mile, mIdx) => {
                      const isLeft = mile.branchX < 0;
                      const isHovered = hoveredMile === mile.id;
                      const nodeTop = mIdx * 320 + 60;

                      return (
                        <div
                          key={mile.id}
                          className="relative"
                          style={{ height: '320px' }}
                          onMouseEnter={() => setHoveredMile(mile.id)}
                          onMouseLeave={() => setHoveredMile(null)}
                        >
                          {/* Horizontal branch line from vine to node */}
                          <div
                            className="absolute top-[60px]"
                            style={{
                              left: isLeft ? `calc(50% + ${mile.branchX + (isLeft ? -8 : 0)}px)` : `50%`,
                              width: Math.abs(mile.branchX) + 'px',
                              height: '2px',
                              background: `linear-gradient(${isLeft ? '270deg' : '90deg'}, rgba(138,43,226,0.7), rgba(138,43,226,0.1))`,
                              transformOrigin: isLeft ? 'right center' : 'left center'
                            }}
                          />

                          {/* Milestone node circle */}
                          <div
                            className="milestone-node absolute top-[44px] z-20 cursor-pointer"
                            style={{
                              left: `calc(50% + ${mile.branchX}px)`,
                              transform: 'translateX(-50%)',
                            }}
                          >
                            {/* Glow ring */}
                            <div
                              className="absolute inset-0 rounded-full animate-ping opacity-30"
                              style={{
                                width: '48px', height: '48px',
                                border: `2px solid ${escalationColor}`,
                                animation: isHovered ? 'ping 1s infinite' : 'none'
                              }}
                            />
                            {/* Main node */}
                            <div
                              className="relative w-12 h-12 rounded-full border-2 flex items-center justify-center font-black text-sm select-none"
                              style={{
                                background: `radial-gradient(circle at 40% 35%, ${escalationColor}30, #0B0C10)`,
                                borderColor: isHovered ? escalationColor : `${escalationColor}60`,
                                boxShadow: isHovered ? `0 0 25px ${escalationColor}50` : `0 0 10px ${escalationColor}20`,
                                color: escalationColor,
                                transition: 'all 0.3s ease'
                              }}
                            >
                              {mIdx + 1}
                            </div>
                          </div>

                          {/* Milestone label */}
                          <div
                            className="absolute top-[24px] z-10"
                            style={{
                              left: isLeft
                                ? `calc(50% + ${mile.branchX - 28}px)`
                                : `calc(50% + ${mile.branchX + 62}px)`,
                              maxWidth: '220px',
                              transform: isLeft ? 'translateX(-100%)' : 'none',
                              textAlign: isLeft ? 'right' : 'left',
                            }}
                          >
                            <div className="text-[8px] font-mono uppercase tracking-widest text-gray-500 mb-0.5">
                              {mile.scheduledTime}
                            </div>
                            <div
                              className="text-xs font-bold leading-tight"
                              style={{ color: isHovered ? 'white' : '#d1d5db', transition: 'color 0.3s' }}
                            >
                              {mile.title.replace(/^(Phase \d+:|Milestone \d+:)/i, '').trim()}
                            </div>
                          </div>

                          {/* Checkpoint cards — fan out below the node */}
                          <div
                            className="absolute top-[110px] z-10 flex flex-col gap-2"
                            style={{
                              left: isLeft
                                ? `calc(50% + ${mile.branchX - 260}px)`
                                : `calc(50% + ${mile.branchX + 28}px)`,
                              width: '240px'
                            }}
                          >
                            {mile.checkpoints.map((cp, cpIdx) => (
                              <div
                                key={cp.id}
                                className="checkpoint-card bg-black/60 border border-white/[0.06] rounded-xl p-3 backdrop-blur-sm hover:border-[#8A2BE2]/30 hover:bg-[#8A2BE2]/5 transition-all duration-300"
                                style={{
                                  animationDelay: `${cpIdx * 80}ms`,
                                  opacity: isHovered ? 1 : 0.6,
                                  transform: isHovered ? 'translateY(0)' : 'translateY(4px)',
                                  transition: `all 0.3s ease ${cpIdx * 50}ms`
                                }}
                              >
                                <div className="flex items-start gap-2">
                                  <div
                                    className="w-4 h-4 rounded-full border flex-shrink-0 mt-0.5 flex items-center justify-center cursor-pointer hover:border-purple-400"
                                    style={{
                                      borderColor: cp.status === 'completed' ? '#66FCF1' : `${escalationColor}50`,
                                      backgroundColor: cp.status === 'completed' ? '#66FCF130' : 'transparent'
                                    }}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      // Toggle checkpoint completion directly
                                      try {
                                        let completedCheckpoints: string[] = [];
                                        let parsedCat: any = { completedCheckpoints: [] };
                                        if (task?.category) {
                                          try {
                                            parsedCat = JSON.parse(task.category);
                                          } catch (err) {}
                                          if (parsedCat && Array.isArray(parsedCat.completedCheckpoints)) {
                                            completedCheckpoints = parsedCat.completedCheckpoints;
                                          }
                                        }
                                        const isCompleted = cp.status === 'completed';
                                        if (isCompleted) {
                                          completedCheckpoints = completedCheckpoints.filter(id => id !== cp.id);
                                        } else {
                                          completedCheckpoints = [...completedCheckpoints, cp.id];
                                        }
                                        const updatedCat = JSON.stringify({
                                          ...parsedCat,
                                          completedCheckpoints
                                        });

                                        const updateRes = await fetch(`${API_BASE}/api/tasks/${task?.id}`, {
                                          method: 'PUT',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ category: updatedCat })
                                        });
                                        if (updateRes.ok) {
                                          const updatedTask = await updateRes.json();
                                          setTask(updatedTask);
                                          toast.success(isCompleted ? "Checkpoint reopened." : "Checkpoint completed!");
                                          // Re-expand milestones to reflect new status
                                          const expanded = await expandMilestonesWithAI(updatedTask);
                                          setMilestones(expanded);
                                        }
                                      } catch (err) {
                                        toast.error("Failed to update checkpoint status.");
                                      }
                                    }}
                                  >
                                    {cp.status === 'completed' && (
                                      <span className="text-[6px]" style={{ color: '#66FCF1' }}>✓</span>
                                    )}
                                  </div>
                                  <div 
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() => {
                                      if (!task?.id) return;
                                      router.push(`/dashboard/sprint?taskId=${task.id}&checkpointId=${cp.id}&title=${encodeURIComponent(cp.title)}&detail=${encodeURIComponent(cp.detail)}&duration=${cp.estimatedMinutes}`);
                                    }}
                                  >
                                    <div className="text-[9px] font-bold text-gray-200 leading-tight truncate hover:text-purple-300">
                                      {cp.title}
                                    </div>
                                    <div className="text-[8px] text-gray-500 leading-snug mt-0.5 line-clamp-2">
                                      {cp.detail}
                                    </div>
                                    <div
                                      className="text-[7px] font-mono uppercase tracking-wider mt-1"
                                      style={{ color: `${escalationColor}80` }}
                                    >
                                      ~{cp.estimatedMinutes}min | Launch Timer ⏱️
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}

                            {/* Branch connector line from node to first checkpoint */}
                            <div
                              className="absolute"
                              style={{
                                top: '-32px',
                                left: isLeft ? '240px' : '-12px',
                                width: '12px',
                                height: '32px',
                                borderLeft: isLeft ? 'none' : `1px dashed ${escalationColor}30`,
                                borderRight: isLeft ? `1px dashed ${escalationColor}30` : 'none',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Terminal convergence node */}
                  <div className="relative flex justify-center mt-8" style={{ zIndex: 10 }}>
                    <div className="flex flex-col items-center gap-2">
                      <div
                        className="w-16 h-16 rounded-full border-2 flex items-center justify-center"
                        style={{
                          borderColor: escalationColor,
                          background: `radial-gradient(circle at 40% 35%, ${escalationColor}20, #0B0C10)`,
                          boxShadow: `0 0 30px ${escalationColor}40`,
                        }}
                      >
                        <span className="text-xl">🎯</span>
                      </div>
                      <div className="text-center">
                        <div className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Deadline</div>
                        <div className="text-xs font-bold" style={{ color: escalationColor }}>
                          {new Date(task.due).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}

export default function TimelinePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-t-transparent border-[#8A2BE2] rounded-full animate-spin" />
      </div>
    }>
      <TimelinePageContent />
    </Suspense>
  );
}


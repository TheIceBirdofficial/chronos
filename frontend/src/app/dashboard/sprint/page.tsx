'use client';
import { API_BASE } from "@/config";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Task {
  id: string;
  title: string;
  due: string;
  estimatedHours: number;
  importance: "low" | "medium" | "high";
  completed: boolean;
  category?: string;
  timeline?: Array<{
    id: string;
    title: string;
    status: string;
    scheduledTime: string;
  }>;
}

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
    
    // Single-asterisk lines → field labels (not bullets)
    if (cleaned.startsWith('*') && !cleaned.startsWith('**') && cleaned.length > 1) {
      cleaned = cleaned.replace(/^\*\s*/, '');
      const parts = cleaned.split('**');
      const contentElements = parts.map((part, idx) => {
        if (idx % 2 === 1) {
          return <strong key={idx} className="font-extrabold text-[#66FCF1]">{part}</strong>;
        }
        return part;
      });
      return (
        <div key={i} className="text-[11px] font-bold text-purple-300 uppercase tracking-wider mt-3 mb-0.5">
          {contentElements}
        </div>
      );
    }
    
    // Dash bullets and literal bullet characters
    let isBullet = false;
    const bulletChar = cleaned.match(/^[•\-]\s*/)?.[0] || '';
    if (bulletChar) {
      cleaned = cleaned.replace(/^[•\-]\s*/, '');
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
      if (!cleaned) {
        return <div key={i} className="h-1.5" />;
      }
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

function SprintPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = searchParams.get('taskId');
  const checkpointId = searchParams.get('checkpointId');

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkpointTitle, setCheckpointTitle] = useState("");
  const [checkpointDetail, setCheckpointDetail] = useState("");

  const [sprintActive, setSprintActive] = useState(false);
  const [sprintPaused, setSprintPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [initialSeconds, setInitialSeconds] = useState(0);

  const [isFinishing, setIsFinishing] = useState(false);
  const [learningResult, setLearningResult] = useState<any>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Mouse coordinate tracking for spotlight overlay
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setMousePos({
        x: (e.clientX / window.innerWidth) - 0.5,
        y: (e.clientY / window.innerHeight) - 0.5
      });
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  // Extract searchParams values to avoid re-fetch on every render
  const titleParam = searchParams.get('title');
  const detailParam = searchParams.get('detail');
  const durParam = searchParams.get('duration');

  // Load Task details
  useEffect(() => {
    // Route Guard: Prevent skipping onboarding
    const savedName = localStorage.getItem("chronos-username");
    const savedTwin = localStorage.getItem("chronos-performance-twin");
    if (!savedName || !savedTwin) {
      router.push('/');
      return;
    }

    if (!taskId) {
      toast.error("Invalid task ID.");
      router.push('/dashboard');
      return;
    }

    const fetchTask = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tasks`);
        if (!res.ok) throw new Error("Failed to load tasks");
        const list: Task[] = await res.json();
        const found = list.find(t => String(t.id) === String(taskId));
        
        if (!found) {
          toast.error("Task not found.");
          router.push('/dashboard');
          return;
        }

        setTask(found);

        // Calculate initial sprint duration
        let durationMinutes = found.estimatedHours * 60;

        if (checkpointId) {
          if (durParam) {
            durationMinutes = parseInt(durParam);
          } else {
            durationMinutes = 30; // default duration in minutes
          }
          setCheckpointTitle(titleParam || "Checkpoint: Step execution");
          setCheckpointDetail(detailParam || "Execute this sub goal milestone step.");
        }

        const totalSecs = Math.round(durationMinutes * 60);
        setSecondsLeft(totalSecs);
        setInitialSeconds(totalSecs);
      } catch (err) {
        toast.error("Failed to load sprint task context.");
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [taskId, checkpointId, titleParam, detailParam, durParam]);

  // Timer logic
  useEffect(() => {
    if (sprintActive && !sprintPaused) {
      timerRef.current = setInterval(() => {
        setSecondsLeft(prev => prev - 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [sprintActive, sprintPaused]);

  const syncSprintStatus = async (activeOverride?: boolean, pausedOverride?: boolean, secondsLeftOverride?: number) => {
    try {
      const activeVal = activeOverride !== undefined ? activeOverride : sprintActive;
      const pausedVal = pausedOverride !== undefined ? pausedOverride : sprintPaused;
      const secondsLeftVal = secondsLeftOverride !== undefined ? secondsLeftOverride : secondsLeft;
      await fetch(`${API_BASE}/api/sprint/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          checkpointId: checkpointId || undefined,
          active: activeVal,
          paused: pausedVal,
          duration: initialSeconds,
          secondsLeft: secondsLeftVal
        })
      });
    } catch (e) {
      console.warn("Failed to sync sprint status to backend:", e);
    }
  };

  // Periodic status sync while active
  useEffect(() => {
    if (!sprintActive) return;
    const interval = setInterval(() => {
      syncSprintStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [sprintActive, sprintPaused, secondsLeft, initialSeconds]);

  const handleStartSprint = () => {
    setSprintActive(true);
    setSprintPaused(false);
    toast.success("Executive Focus Sprint commenced. Chronos time locks activated.");
    syncSprintStatus(true, false);
  };

  const handleFinishSprint = async () => {
    if (!task) return;
    setIsFinishing(true);
    setSprintActive(false);
    syncSprintStatus(false, false);

    const elapsedSeconds = initialSeconds - secondsLeft;
    const actualHours = Math.max(0.01, elapsedSeconds / 3600.0);
    const estHours = initialSeconds / 3600.0;

    const savedConfig = localStorage.getItem('chronos-ai-config');
    const aiConfig = savedConfig ? JSON.parse(savedConfig) : null;

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/complete_sprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualHours,
          estimatedHours: estHours,
          checkpointId: checkpointId || undefined,
          aiConfig
        })
      });

      if (!res.ok) throw new Error("Sprint submission failed");
      const data = await res.json();
      
      // Update local storage so twin matches backend learning immediately
      if (data.newTwin) {
        localStorage.setItem("chronos-performance-twin", data.newTwin);
      }

      setLearningResult(data);
      toast.success("Focus Sprint finalized. Behavioral data compiled.");
    } catch (err) {
      toast.error("Failed to compile sprint performance metrics.");
      setIsFinishing(false);
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const isNegative = totalSeconds < 0;
    const absoluteSeconds = Math.abs(totalSeconds);
    const h = Math.floor(absoluteSeconds / 3600);
    const m = Math.floor((absoluteSeconds % 3600) / 60);
    const s = absoluteSeconds % 60;

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${isNegative ? '-' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] text-[#66FCF1] flex flex-col items-center justify-center font-sans">
        <div className="w-10 h-10 border-4 border-[#8A2BE2] border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-xs font-mono uppercase tracking-widest text-purple-300">Synchronizing Spacetime sprint...</p>
      </div>
    );
  }

  if (!task) return null;

  const isOvertime = secondsLeft < 0;

  return (
    <div className="min-h-screen bg-[#0B0C10] text-gray-100 flex flex-col justify-center items-center p-4 relative font-sans overflow-hidden select-none">
      <style>{`
        @keyframes radar-sweep {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @keyframes grid-pulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.4; }
        }
      `}</style>
      
      {/* Abstract background grid */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(138,43,226,0.15),rgba(0,0,0,0))]" />
      
      {/* Interactive radar sweep / space-time grid */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute inset-0"
          style={{
            background: `
              linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
            `,
            backgroundSize: '32px 32px',
            animation: `grid-pulse ${sprintActive ? '2.0s' : '4.5s'} infinite ease-in-out`
          }}
        />
        {/* Radar sweep line */}
        <div 
          className="absolute top-1/2 left-1/2 w-[220%] h-[220%] origin-center opacity-[0.04]"
          style={{
            background: `conic-gradient(from 0deg, ${sprintActive ? '#06C6B3' : '#8A2BE2'} 0deg, transparent 90deg, transparent 360deg)`,
            animation: 'radar-sweep 12s infinite linear'
          }}
        />
      </div>

      {/* Reactive cursor spotlight following overlay */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-30 transition-transform duration-300 ease-out"
        style={{
          background: `radial-gradient(500px circle at ${((mousePos.x + 0.5) * 100)}% ${((mousePos.y + 0.5) * 100)}%, ${
            sprintActive ? 'rgba(6,198,179,0.16)' : 'rgba(138,43,226,0.12)'
          }, transparent 70%)`
        }}
      />

      <div className="max-w-xl w-full z-10 space-y-6">
        {/* Back navigation */}
        <button
          onClick={() => router.push(checkpointId ? `/dashboard/timeline?taskId=${task.id}` : '/dashboard')}
          className="text-xs font-mono uppercase text-gray-400 hover:text-[#66FCF1] transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <span>◀</span> Return to {checkpointId ? "Milestone Branch" : "Chronos Grid"}
        </button>

        {/* Task Focus Info Card - scales and changes color when active */}
        <Card 
          className={`border rounded-3xl p-6 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all duration-700 ease-in-out ${
            sprintActive 
              ? 'scale-[1.04] border-[#06C6B3]/60 shadow-[0_0_40px_rgba(6,198,179,0.25)] bg-[#0C1520]/80' 
              : 'border-white/[0.08] bg-black/60 shadow-[0_8px_32px_rgba(0,0,0,0.37)]'
          }`}
        >
          <CardHeader className="p-0 border-b border-white/5 pb-4">
            <div className="flex justify-between items-center">
              <Badge className={`font-mono text-[9px] uppercase tracking-wider transition-colors duration-500 ${
                sprintActive ? 'bg-[#06C6B3]/10 border border-[#06C6B3]/40 text-[#06C6B3]' : 'bg-[#8A2BE2]/10 border border-[#8A2BE2]/40 text-[#c084fc]'
              }`}>
                {sprintActive ? '⚡ SPRINT ACTIVE' : '⚡ EXECUTIVE FOCUS MODE'}
              </Badge>
              <Badge className={`font-mono text-[9px] uppercase tracking-wider ${
                task.importance === 'high' ? 'bg-red-950/40 text-red-400 border border-red-500/30' :
                task.importance === 'medium' ? 'bg-amber-950/40 text-amber-400 border border-amber-500/30' :
                'bg-green-950/40 text-green-400 border border-green-500/30'
              }`}>
                {task.importance} priority
              </Badge>
            </div>
            
            <CardTitle className="text-lg font-bold text-gray-200 mt-2">
              {task.title}
            </CardTitle>

            {/* Mention the sub goal description if present */}
            {checkpointId && (
              <div className="mt-3 p-3 rounded-2xl bg-purple-950/15 border border-purple-500/10 space-y-1">
                <span className="text-[9px] font-mono text-purple-400 uppercase tracking-widest block font-bold">
                  🏃 ACTIVE SUB GOAL:
                </span>
                <p className="text-xs font-semibold text-gray-200">
                  {checkpointTitle}
                </p>
                {checkpointDetail && (
                  <p className="text-[10px] text-gray-400 font-sans leading-relaxed">
                    {checkpointDetail}
                  </p>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0 pt-6 flex flex-col items-center justify-center space-y-8">
            
            {/* Massive Digital Timer */}
            <div className="flex flex-col items-center justify-center">
              <div 
                className={`font-mono text-5xl md:text-6xl font-extrabold tracking-widest transition-all duration-300 ${
                  isOvertime 
                    ? 'text-red-500 animate-pulse drop-shadow-[0_0_20px_rgba(239,68,68,0.6)]' 
                    : sprintActive
                      ? 'text-[#06C6B3] drop-shadow-[0_0_25px_rgba(6,198,179,0.5)]'
                      : 'text-[#66FCF1] drop-shadow-[0_0_20px_rgba(102,252,241,0.4)]'
                }`}
              >
                {formatTimer(secondsLeft)}
              </div>
              <span className={`text-[9px] font-mono uppercase tracking-widest mt-2 ${
                isOvertime ? 'text-red-400 font-bold' : 'text-gray-500'
              }`}>
                {isOvertime ? '⚠️ Deadline buffer exceeded (counting overtime)' : 'Core execution timer'}
              </span>

              {/* Action buttons */}
              <div className="w-full flex flex-col gap-3">
                {!sprintActive && !isFinishing && secondsLeft === initialSeconds && (
                  <button
                    onClick={handleStartSprint}
                    className="w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-[#8A2BE2] to-[#c084fc] text-white hover:opacity-95 transition-all cursor-pointer shadow-[0_0_20px_rgba(138,43,226,0.3)] text-center font-mono"
                  >
                    🚀 Commence Focus Sprint
                  </button>
                )}

                {(sprintActive || (secondsLeft !== initialSeconds && !learningResult)) && (
                  <div className="space-y-2.5 w-full">
                    <button
                      onClick={handleFinishSprint}
                      className="w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-wider bg-[#06C6B3] hover:opacity-95 text-black transition-all cursor-pointer shadow-[0_0_20px_rgba(6,198,179,0.3)] text-center font-mono"
                    >
                      ✓ Secure Sub Goal (Finish Sprint)
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setSprintPaused(prev => {
                            const newVal = !prev;
                            if (newVal) {
                              toast.info("Focus session paused.");
                            } else {
                              toast.success("Focus session resumed.");
                            }
                            syncSprintStatus(sprintActive, newVal);
                            return newVal;
                          });
                        }}
                        className={`py-3 rounded-2xl font-bold text-[10px] font-mono uppercase tracking-wider border cursor-pointer transition-all text-center ${
                          sprintPaused
                            ? "bg-green-950/20 border-green-500 text-green-400 hover:bg-green-900/30"
                            : "bg-amber-950/20 border-amber-500 text-amber-400 hover:bg-amber-900/30"
                        }`}
                      >
                        {sprintPaused ? "▶️ Resume Focus" : "⏸️ Pause Focus"}
                      </button>
                      <button
                        onClick={() => {
                          setSprintActive(false);
                          setSprintPaused(false);
                          setSecondsLeft(initialSeconds);
                          toast.error("Focus session aborted. Timer reset.");
                          syncSprintStatus(false, false, initialSeconds);
                        }}
                        className="py-3 rounded-2xl font-bold text-[10px] font-mono uppercase tracking-wider border border-red-500/30 text-red-400 bg-red-950/20 hover:bg-red-900/30 cursor-pointer transition-all text-center"
                      >
                        🛑 Abort Session
                      </button>
                    </div>
                  </div>
                )}

                {isFinishing && !learningResult && (
                  <div className="w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-widest bg-gray-800 text-purple-300 border border-gray-700 animate-pulse text-center">
                    🧠 AI calibrating performance twin...
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Cognitive Learning Overlay Modal */}
      {learningResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="max-w-lg w-full bg-[#0B0C10] border border-[#8A2BE2]/50 rounded-3xl p-6 space-y-6 shadow-[0_0_50px_rgba(138,43,226,0.4)] relative">
            <div className="text-center space-y-2 border-b border-white/5 pb-4">
              <span className="text-[10px] font-mono text-purple-400 uppercase tracking-widest">
                ⚙️ CALIBRATION COMPLETE
              </span>
              <h2 className="text-xl font-black uppercase tracking-wider bg-gradient-to-r from-[#66FCF1] to-[#8A2BE2] bg-clip-text text-transparent">
                AI Twin Brain Synced
              </h2>
              <p className="text-xs text-gray-400">
                Chronos has processed this focus sprint and adapted your cognitive behavioral profile.
              </p>
            </div>

            {/* Side by side comparison cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/50 border border-white/5 rounded-2xl p-4 space-y-2">
                <span className="text-[8px] font-mono text-gray-500 uppercase tracking-wider block">
                  Procrastination Factor
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-red-400">{learningResult.previousRating?.toFixed(1) || '8.0'}</span>
                  <span className="text-xs text-gray-500">→</span>
                  <span className="text-2xl font-extrabold text-green-400">{learningResult.newRating?.toFixed(1) || '7.5'}</span>
                </div>
                <p className="text-[8px] text-gray-400 leading-snug">
                  Lower rating represents increased focus velocity and faster task initiation.
                </p>
              </div>

              <div className="bg-black/50 border border-white/5 rounded-2xl p-4 space-y-2 flex flex-col justify-between">
                <div>
                  <span className="text-[8px] font-mono text-gray-500 uppercase tracking-wider block">
                    Execution Efficiency
                  </span>
                  <div className="text-lg font-black text-purple-300 mt-1">
                    {secondsLeft >= 0 ? "🏆 HIGH VELOCITY" : "⚠️ OVERTIME DEFICIT"}
                  </div>
                </div>
                <p className="text-[8px] text-gray-400 leading-snug">
                  {secondsLeft >= 0 
                    ? `Completed task ${formatTimer(secondsLeft)} ahead of estimated time.`
                    : `Completed task ${formatTimer(secondsLeft)} past estimated time.`
                  }
                </p>
              </div>
            </div>

            {/* Profile changes info */}
            <div className="bg-purple-950/10 border border-[#8A2BE2]/20 rounded-2xl p-4 space-y-2">
              <span className="text-[9px] font-mono text-purple-300 uppercase tracking-widest block font-bold">
                🧠 Dynamic Twin Profile Adaptations
              </span>
              <div className="text-xs text-gray-300 font-mono leading-relaxed whitespace-pre-wrap max-h-[150px] overflow-y-auto custom-scrollbar">
                <div className="space-y-1">{renderFormattedText(learningResult.newTwin || "No twin profile updates detected.")}</div>
              </div>
            </div>

            <button
              onClick={() => router.push('/dashboard')}
              className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-[#66FCF1] hover:opacity-95 text-black cursor-pointer text-center"
            >
              Secure & Return to Chronos Grid
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SprintPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-t-transparent border-[#8A2BE2] rounded-full animate-spin" />
      </div>
    }>
      <SprintPageContent />
    </Suspense>
  );
}

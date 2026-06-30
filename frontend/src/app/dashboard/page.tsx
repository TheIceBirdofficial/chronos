'use client';

import { useState, useEffect, useRef } from "react";
import { useRouter } from 'next/navigation';
import { ParticleBackground } from "../page";
import RecoveryCommandCenter from '@/components/RecoveryCommandCenter';
import RecoveryLoadingPipeline from '@/components/RecoveryLoadingPipeline';
import RecoveryBriefing, { RecoveryBriefing as RecoveryBriefingType } from '@/components/RecoveryBriefing';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import ChronosCanvas from "@/components/ChronosCanvas";
import SettingsGear from '@/components/SettingsGear';
import { API_BASE, getUserId, fetchWithTimeout, isPlaceholderTwin, isRealUsername } from "@/config";

interface Task {
  id: string;
  title: string;
  due: string;
  estimatedHours: number;
  importance: "low" | "medium" | "high";
  completed: boolean;
  delayCount?: number;
  survivalScore?: number;
  survivalScoreBeforeRecovery?: number;
  scoreHistory?: number[];
  recoveryForecast?: number;
  rescueResources?: any;
  escalationLevel?: 'green' | 'yellow' | 'orange' | 'red' | 'black';
  deadlineCollapse?: boolean;
  pointOfNoReturn?: string;
  newPointOfNoReturn?: string;
  category?: string;
  riskAnalysis?: {
    workRemaining: number;
    timeRemaining: number;
    twinProcrastinationFactor: number;
    historyPenalty: number;
    failureRisk?: number;
    failurePrediction?: string;
    cognitiveObservationsList?: string[];
  };
  events?: Array<{
    timestamp: string;
    agent: string;
    message: string;
    type?: string;
    reason?: string;
    confidence?: number;
    expectedImprovement?: number;
    actionsTaken?: string[];
  }>;
  timeline?: Array<{
    id: string;
    title: string;
    status: string;
    scheduledTime: string;
    checkpoints?: any[];
  }>;
}

const renderFormattedText = (text: string) => {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    let cleaned = line.trim();
    if (!cleaned) return <div key={i} className="h-2" />;
    
    // Divider lines → styled <hr>
    if (/^[━─]{3,}$/.test(cleaned)) {
      return <hr key={i} className="my-3 border-0 border-t border-white/10" />;
    }
    
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

export default function Dashboard() {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksLoadingSlow, setTasksLoadingSlow] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const getDynamicFailureCauses = (task: Task) => {
    const causes: string[] = [];
    const timeRemaining = task.riskAnalysis?.timeRemaining ?? 0;
    const workRemaining = task.estimatedHours;
    
    if (workRemaining > timeRemaining) {
      causes.push(`Estimated workload (${workRemaining}h) exceeds remaining productive hours (${timeRemaining}h).`);
    } else {
      causes.push(`Time margin buffer is compressing rapidly before deadline.`);
    }
    
    if (task.delayCount && task.delayCount > 0) {
      causes.push(`Operator has delayed this timeline ${task.delayCount} times, compounding risk.`);
    } else {
      causes.push(`Operator procrastination factor (Rating: ${task.riskAnalysis?.twinProcrastinationFactor ?? 'medium'}) is active.`);
    }
    
    // Check sleep overlaps
    const timeline = task.timeline || [];
    let sleepOverlaps = 0;
    let totalCps = 0;
    timeline.forEach(m => {
      const cps = m.checkpoints || [];
      cps.forEach((cp: any) => {
        totalCps++;
        const sched = cp.scheduledTime;
        if (sched) {
          try {
            const hr = new Date(sched).getHours();
            const sleepHoursList: number[] = [];
            let curr = sleepStart;
            while (curr !== sleepEnd) {
              sleepHoursList.push(curr);
              curr = (curr + 1) % 24;
            }
            if (sleepHoursList.includes(hr)) {
              sleepOverlaps++;
            }
          } catch (e) {}
        }
      });
    });
    
    if (sleepOverlaps > 0) {
      const pct = totalCps > 0 ? Math.round((sleepOverlaps / totalCps) * 100) : 38;
      causes.push(`Sleep window overlaps ${pct}% of planned execution checkpoints.`);
    } else {
      causes.push(`Circadian rest cycle compromises remaining productive work margins.`);
    }
    
    // Check missed checkpoints
    let missedCount = 0;
    timeline.forEach(m => {
      const cps = m.checkpoints || [];
      cps.forEach((cp: any) => {
        if (cp.status === 'active' && !cp.completed) {
          missedCount++;
        }
      });
    });
    if (missedCount > 0) {
      causes.push(`User has skipped or delayed ${missedCount} scheduled checkpoints.`);
    } else {
      causes.push(`Operator has active milestones requiring critical focus.`);
    }
    
    return causes.map((c, i) => <li key={i}>{c}</li>);
  };
  const [performanceTwin, setPerformanceTwin] = useState<string>("");
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [username, setUsername] = useState<string>("user");
  const [currentView, setCurrentView] = useState<'mission-control' | 'calendar-debrief'>('mission-control');
  const [activeCalMonth, setActiveCalMonth] = useState<number>(new Date().getMonth());
  const [activeCalYear, setActiveCalYear] = useState<number>(new Date().getFullYear());
  const [calendarAnalysis, setCalendarAnalysis] = useState<string>("");
  const [calendarAnalysisLoading, setCalendarAnalysisLoading] = useState<boolean>(false);
  const [terminalHistory, setTerminalHistory] = useState<Array<{ sender: 'user' | 'chronos', text: string }>>([
    { sender: 'chronos', text: "Tactical deadline defense system online. Operator link established." }
  ]);
  const [terminalInput, setTerminalInput] = useState<string>("");
  const [terminalLoading, setTerminalLoading] = useState<boolean>(false);

  // Task creation states
  const [openAdd, setOpenAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newHours, setNewHours] = useState(2);
  const [newImportance, setNewImportance] = useState<"low" | "medium" | "high">("medium");

  // Recovery Protocol Modal States
  const [rescuingTaskId, setRescuingTaskId] = useState<string | null>(null);
  const [rescueLoading, setRescueLoading] = useState(false);
  const [rescueData, setRescueData] = useState<Task | null>(null);
  const [rescueBriefing, setRescueBriefing] = useState<RecoveryBriefingType | null>(null);
  const [rescueError, setRescueError] = useState<string | null>(null);
  const [recoveryChatHistory, setRecoveryChatHistory] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);
  const [recoveryChatInput, setRecoveryChatInput] = useState("");
  const [recoveryChatLoading, setRecoveryChatLoading] = useState(false);
  const [activeRecoveryTaskId, setActiveRecoveryTaskId] = useState<string | null>(null);

  // AI Task Estimation States
  const [showEstimationAssistant, setShowEstimationAssistant] = useState(false);
  const [estChatHistory, setEstChatHistory] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);
  const [estChatInput, setEstChatInput] = useState("");
  const [estChatLoading, setEstChatLoading] = useState(false);
  const [suggestedEstimate, setSuggestedEstimate] = useState<number | null>(null);
  const [hasCompletedAiEstimation, setHasCompletedAiEstimation] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const estSessionIdRef = useRef(0);

  // Explainability Panel (Why am I seeing this?)
  const [explainTaskId, setExplainTaskId] = useState<string | null>(null);

  // Developer Control Panel State
  const [showDevPanel, setShowDevPanel] = useState(false);

  // Phone Link Modal States and Helpers
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneTestSuccess, setPhoneTestSuccess] = useState<boolean | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(false);

  const handleOpenPhoneModal = () => {
    setOpenSettings(false);
    let currentTopic = ntfyTopic;
    if (!currentTopic || currentTopic === 'chronos-alerts-user' || currentTopic.startsWith('chronos-alerts-')) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let rand = '';
      for (let i = 0; i < 6; i++) {
        rand += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      currentTopic = `chronos_alerts_${rand}`;
      setNtfyTopic(currentTopic);
      localStorage.setItem("chronos-ntfy-topic", currentTopic);
      // Save to backend settings immediately
      fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ntfyTopic: currentTopic })
      }).catch(() => {});
    }
    setShowPhoneModal(true);
  };

  const handleSavePhoneTopic = async () => {
    if (!ntfyTopic.trim()) {
      toast.error("Topic name cannot be empty.");
      return;
    }
    setPhoneLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ntfyTopic: ntfyTopic })
      });
      if (res.ok) {
        localStorage.setItem("chronos-ntfy-topic", ntfyTopic);
        toast.success("Phone link topic saved and synchronized.");
      } else {
        throw new Error();
      }
    } catch (err) {
      localStorage.setItem("chronos-ntfy-topic", ntfyTopic);
      toast.info("Saved locally (offline mode).");
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleTestPhoneTopic = async () => {
    if (!ntfyTopic.trim()) {
      toast.error("Set a topic name first.");
      return;
    }
    setPhoneLoading(true);
    setPhoneTestSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/phone/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ntfyTopic: ntfyTopic })
      });
      if (res.ok) {
        setPhoneTestSuccess(true);
        toast.success("Verification notification dispatched successfully!");
      } else {
        setPhoneTestSuccess(false);
        toast.error("Failed to reach notification broker.");
      }
    } catch (err) {
      setPhoneTestSuccess(false);
      toast.error("Network error. Verify internet connectivity.");
    } finally {
      setPhoneLoading(false);
    }
  };
  const [devOverrideState, setDevOverrideState] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'warning' | 'offline' | null>(null);
  
  const [recoveryCountdown, setRecoveryCountdown] = useState<string>("");

  // Real stats calculation for debrief view
  const activeTasks = tasks.filter(t => !t.completed);
  const totalActiveHours = activeTasks.reduce((sum, t) => sum + t.estimatedHours, 0);
  const overdueTasks = activeTasks.filter(t => t.due && new Date(t.due).getTime() < Date.now());
  const overdueHours = overdueTasks.reduce((sum, t) => sum + t.estimatedHours, 0);

  const avgSurvival = activeTasks.length > 0 ? Math.round(activeTasks.reduce((sum, t) => sum + (t.survivalScore ?? 80), 0) / activeTasks.length) : 90;
  const burnoutRisk = Math.max(10, Math.min(95, 100 - avgSurvival));

  const completedTasksCount = tasks.filter(t => t.completed).length;
  const totalTasksCount = tasks.length;
  const completionIndex = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 100;
  
  useEffect(() => {
    if (!activeRecoveryTaskId) {
      setRecoveryCountdown("");
      return;
    }
    
    const updateCountdown = () => {
      const targetTimeVal = localStorage.getItem(`chronos-recovery-target-time-${activeRecoveryTaskId}`);
      if (!targetTimeVal) {
        setRecoveryCountdown("");
        return;
      }
      
      const [hrs, mins] = targetTimeVal.split(':').map(Number);
      const target = new Date();
      target.setHours(hrs, mins, 0, 0);
      
      // If the target time is already in the past for today, assume it is for tomorrow
      if (target.getTime() < Date.now()) {
        target.setDate(target.getDate() + 1);
      }
      
      const diffMs = target.getTime() - Date.now();
      if (diffMs <= 0) {
        setRecoveryCountdown("00:00:00 - TIME EXPIRED");
        return;
      }
      
      const totalSecs = Math.floor(diffMs / 1000);
      const h = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
      const s = String(totalSecs % 60).padStart(2, '0');
      setRecoveryCountdown(`${h}:${m}:${s} remaining`);
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    window.addEventListener('storage', updateCountdown);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', updateCountdown);
    };
  }, [activeRecoveryTaskId]);
  const devOverrideStateRef = useRef(devOverrideState);
  useEffect(() => {
    devOverrideStateRef.current = devOverrideState;
  }, [devOverrideState]);

  const terminalScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [terminalHistory]);

  // Tabbed Settings & Custom Calendar picker states
  const [settingsTab, setSettingsTab] = useState<'ai' | 'tools' | 'twin' | 'dev'>('ai');
  const [sleepStart, setSleepStart] = useState<number>(23);
  const [sleepEnd, setSleepEnd] = useState<number>(7);
  const [ntfyTopic, setNtfyTopic] = useState<string>("chronos-alerts-user");

  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [pickerHour, setPickerHour] = useState("12");
  const [pickerMinute, setPickerMinute] = useState("00");
  const [pickerAmPm, setPickerAmPm] = useState("PM");
  const [pickerDate, setPickerDate] = useState<Date | null>(null);
  const calendarPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCalendarPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (calendarPickerRef.current && !calendarPickerRef.current.contains(e.target as Node)) {
        setShowCalendarPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCalendarPicker]);

  const updateNewDue = (date: Date | null, hr: string, min: string, ampm: string) => {
    if (!date) return;
    const finalDate = new Date(date);
    let h = parseInt(hr);
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    finalDate.setHours(h);
    finalDate.setMinutes(parseInt(min));
    finalDate.setSeconds(0);
    finalDate.setMilliseconds(0);
    setNewDue(finalDate.toISOString());
  };

  const checkSleepOverlap = () => {
    let h = parseInt(pickerHour);
    if (pickerAmPm === "PM" && h < 12) h += 12;
    if (pickerAmPm === "AM" && h === 12) h = 0;
    
    const sleepHoursList: number[] = [];
    let curr = sleepStart;
    while (curr !== sleepEnd) {
      sleepHoursList.push(curr);
      curr = (curr + 1) % 24;
    }
    return sleepHoursList.includes(h);
  };

  const renderCalendarGrid = () => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const today = new Date();
    
    const days = [];
    // Padding for first day of month
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(<div key={`empty-${i}`} className="p-1" />);
    }
    
    for (let d = 1; d <= daysInMonth; d++) {
      const dayDate = new Date(calendarYear, calendarMonth, d);
      const checkDate = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
      const checkToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const isPast = checkDate < checkToday;
      const isToday = checkDate.getTime() === checkToday.getTime();
      const isSelected = pickerDate ? (pickerDate.getFullYear() === calendarYear && pickerDate.getMonth() === calendarMonth && pickerDate.getDate() === d) : false;
      
      days.push(
        <button
          key={`day-${d}`}
          type="button"
          disabled={isPast}
          onClick={() => {
            const selected = new Date(calendarYear, calendarMonth, d);
            setPickerDate(selected);
            updateNewDue(selected, pickerHour, pickerMinute, pickerAmPm);
          }}
          className={`p-1 text-[9px] font-mono rounded-md transition-all text-center focus:outline-none cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed ${
            isSelected
              ? 'bg-[#8A2BE2] text-white font-bold shadow-[0_0_8px_rgba(138,43,226,0.4)] border border-[#8A2BE2]'
              : isToday
                ? 'border border-amber-500/50 text-amber-400 bg-amber-500/10'
                : 'hover:bg-white/5 text-gray-300'
          }`}
        >
          {d}
        </button>
      );
    }
    
    return days;
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('settings') === 'true') {
        setOpenSettings(true);
      }
    }
  }, []);

  const handleSetDevOverride = (state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'warning' | 'offline' | null) => {
    setDevOverrideState(state);
    if (state !== null) {
      setOrbState(state);
      if (state === 'offline') {
        setOrbText("Chronos Voice Link: Daemon Offline (Dev Override).");
      } else if (state === 'idle') {
        setOrbText("Chronos Voice Link: Sync Active (Dev Override).");
      } else if (state === 'listening') {
        setOrbText("Chronos: Listening... Speak your command (Dev Override).");
      } else if (state === 'thinking') {
        setOrbText("Chronos: Thinking... (Dev Override)");
      } else if (state === 'speaking') {
        setOrbText("Chronos: \"Mock text speaking...\" (Dev Override)");
      } else if (state === 'warning') {
        setOrbText("Chronos: Critical Warning active (Dev Override).");
      }
    } else {
      // Trigger instant status check
      fetch(`${API_BASE}/api/voice/status`)
        .then(res => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then(data => {
          if (data.voice_link === 'offline') {
            setOrbState('offline');
            setOrbText("Chronos Voice Link: Daemon Offline.");
          } else {
            setOrbState('idle');
            setOrbText("Chronos Voice Link: Sync Active.");
          }
        })
        .catch(() => {
          setOrbState('offline');
          setOrbText("Chronos Voice Link: System Offline.");
        });
    }
  };

  // Speech helper state to prevent multiple triggers
  const spokenTasksRef = useRef<Record<string, string>>({});
  
  // Collapse task state
  const [deadTask, setDeadTask] = useState<Task | null>(null);
  
  useEffect(() => {
    const now = new Date();
    // Look for any active task that has passed its due date
    const pastDueTask = tasks.find(t => !t.completed && t.due && new Date(t.due) <= now);
    if (pastDueTask && (!deadTask || deadTask.id !== pastDueTask.id)) {
      setDeadTask(pastDueTask);
    }
  }, [tasks, deadTask]);

  // Settings Modal States
  const [openSettings, setOpenSettings] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState('gemini');
  const [settingsApiUrl, setSettingsApiUrl] = useState('https://generativelanguage.googleapis.com/v1beta');
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [settingsModel, setSettingsModel] = useState('gemini-1.5-flash');
  const [settingsAvailableModels, setSettingsAvailableModels] = useState<string[]>([]);
  const [settingsLoadingModels, setSettingsLoadingModels] = useState(false);
  const [settingsConnectionStatus, setSettingsConnectionStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [settingsConnectionError, setSettingsConnectionError] = useState<string>("");
  const [settingsRecheckTrigger, setSettingsRecheckTrigger] = useState(0);
  const [reverifyingTwin, setReverifyingTwin] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [calendarSyncState, setCalendarSyncState] = useState<'idle' | 'syncing' | 'authorizing'>('idle');
  
  const [aiConnectionStatus, setAiConnectionStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  // Lock body scroll when settings modal is open
  useEffect(() => {
    if (openSettings) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [openSettings]);

// Twin Profile Modal states
   const [openTwinModal, setOpenTwinModal] = useState(false);
   const [twinTab, setTwinTab] = useState<'profile' | 'telemetry'>('profile');
   const [procrastinationRating, setProcrastinationRating] = useState<number | null>(null);
   const [attentionCycle, setAttentionCycle] = useState<string | null>(null);
   const [stressResponse, setStressResponse] = useState<string | null>(null);
   const [executionCount, setExecutionCount] = useState<number | null>(null);
   const [failureCount, setFailureCount] = useState<number | null>(null);
   const [streakCount, setStreakCount] = useState<number | null>(null);
   const [totalRecoveredHours, setTotalRecoveredHours] = useState<number | null>(null);
  
  const [isTrainingBrain, setIsTrainingBrain] = useState(false);
  const [trainingHistory, setTrainingHistory] = useState<any[]>([]);
  const [trainingInput, setTrainingInput] = useState("");
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [briefingTaskId, setBriefingTaskId] = useState<string | null>(null);

  const recoveryChatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    recoveryChatEndRef.current?.scrollTo({ top: recoveryChatEndRef.current.scrollHeight, behavior: 'smooth' });
  }, [recoveryChatHistory, recoveryChatLoading]);

  const estChatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    estChatEndRef.current?.scrollTo({ top: estChatEndRef.current.scrollHeight, behavior: 'smooth' });
  }, [estChatHistory]);

  const trainingChatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    trainingChatEndRef.current?.scrollTo({ top: trainingChatEndRef.current.scrollHeight, behavior: 'smooth' });
  }, [trainingHistory, trainingLoading]);

  // Voice Assistant Orb states
  const [orbState, setOrbState] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'warning' | 'offline'>('idle');
  const [orbText, setOrbText] = useState<string>("Chronos Voice Link: Idle. Click to establish link.");
  
  const [voiceTelemetry, setVoiceTelemetry] = useState<{
    status: 'online' | 'offline';
    lastSeenSeconds: number;
    latency: number | null;
  }>({
    status: 'offline',
    lastSeenSeconds: -1,
    latency: null
  });

  // Periodic Voice Daemon Status Check
  useEffect(() => {
    const checkVoiceStatus = async () => {
      if (devOverrideStateRef.current !== null) return;
      const start = performance.now();
      try {
        const res = await fetch(`${API_BASE}/api/voice/status`);
        const duration = Math.round(performance.now() - start);
        if (!res.ok) throw new Error("Offline");
        const data = await res.json();
        
        const isOnline = data.voice_link === 'online';
        setVoiceTelemetry({
          status: isOnline ? 'online' : 'offline',
          lastSeenSeconds: data.last_seen_seconds !== undefined ? data.last_seen_seconds : -1,
          latency: duration
        });

        if (!isOnline) {
          setOrbState(prev => {
            if (prev !== 'offline') {
              setOrbText("Chronos Voice Link: Daemon Offline.");
              return 'offline';
            }
            return prev;
          });
        } else {
          setOrbState(prev => {
            if (prev === 'offline') {
              setOrbText("Chronos Voice Link: Sync Active.");
              return 'idle';
            }
            return prev;
          });
        }
      } catch (err) {
        setVoiceTelemetry({
          status: 'offline',
          lastSeenSeconds: -1,
          latency: null
        });
        setOrbState(prev => {
          if (prev !== 'offline') {
            setOrbText("Chronos Voice Link: System Offline.");
            return 'offline';
          }
          return prev;
        });
      }
    };

    checkVoiceStatus();
    const interval = setInterval(checkVoiceStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const userId = getUserId();
    const tabId = Math.random().toString(36).substring(2);

    const sendHeartbeat = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        await fetch(`http://127.0.0.1:43210/heartbeat?tabId=${tabId}`, { mode: 'cors', signal: controller.signal });
        clearTimeout(timeout);
      } catch (e) {
        // Daemon not running — ok
      }
    };

    const registerDaemon = async () => {
      try {
        await fetch('http://127.0.0.1:43210/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, tabId })
        });
      } catch (e) {
        // Daemon not running — ok
      }
    };

    const handleUnload = () => {
      navigator.sendBeacon(`http://127.0.0.1:43210/disconnect?tabId=${tabId}`);
    };

    registerDaemon();
    sendHeartbeat();
    interval = setInterval(sendHeartbeat, 5000);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);
  // Server-Sent Events listener for voice assistant commands and wakeup
  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/api/voice/events`);

    eventSource.onmessage = (event) => {
      if (devOverrideStateRef.current !== null) return;
      try {
        const data = JSON.parse(event.data);
        console.log("[Voice Link Event]", data);
        
        if (data.status === 'listening') {
          setOrbState('listening');
          setOrbText("Chronos: Listening... Speak your command.");
        } else if (data.status === 'transcribing' || data.status === 'thinking') {
          setOrbState('thinking');
          setOrbText("Chronos: Thinking...");
        } else if (data.status === 'user_speech') {
          setOrbText(`You: "${data.text}"`);
        } else if (data.status === 'speaking') {
          setOrbState('speaking');
          setOrbText(`Chronos: "${data.text}"`);
          // Note: browser TTS is disabled, backend performs synthesis
        } else if (data.status === 'idle') {
          setOrbState('idle');
          setOrbText(data.text || "Chronos Voice Link: Sync Active.");
        } else if (data.status === 'reload_tasks') {
          fetchTasks();
        } else if (data.status === 'redirect') {
          if (data.target) {
            router.push(data.target);
          }
        }
      } catch (err) {
        console.error("Failed to parse voice event:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("Voice SSE error, will reconnect...", err);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    setIsTransitioning(false);
  }, []);

  const navigateTo = (path: string) => {
    setIsTransitioning(true);
    setTimeout(() => {
      router.push(path);
    }, 450);
  };

  const getTaskCacheKey = () => `chronos-task-cache-${getUserId()}`;

  const cacheTasks = (nextTasks: Task[]) => {
    try {
      localStorage.setItem(getTaskCacheKey(), JSON.stringify(nextTasks));
    } catch (err) {
      console.warn("Could not cache tasks locally.", err);
    }
  };

  const readCachedTasks = (): Task[] => {
    try {
      const raw = localStorage.getItem(getTaskCacheKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const replaceTasks = (nextTasks: Task[]) => {
    setTasks(nextTasks);
    cacheTasks(nextTasks);
  };

  const fetchTasks = async () => {
    setTasksLoading(true);
    setTasksLoadingSlow(false);
    setTasksError(null);
    const slowTimer = setTimeout(() => setTasksLoadingSlow(true), 300);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/tasks`, {}, 15000);
      clearTimeout(slowTimer);
      if (!res.ok) throw new Error("API core offline");
      const data = await res.json();
      const cached = readCachedTasks();
      if (Array.isArray(data) && data.length === 0 && cached.length > 0) {
        replaceTasks(cached);
        cached.forEach(task => {
          fetch(`${API_BASE}/api/tasks/${task.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(task)
          }).catch(err => console.warn("Failed to rehydrate cached task", err));
        });
        checkAndSpeakInterventions(cached);
      } else {
        const nextTasks = Array.isArray(data) ? data : [];
        replaceTasks(nextTasks);
        checkAndSpeakInterventions(nextTasks);
      }
    } catch (err) {
      clearTimeout(slowTimer);
      console.warn("Could not fetch tasks from backend.", err);
      const cached = readCachedTasks();
      if (cached.length > 0) {
        replaceTasks(cached);
      }
      const message = err instanceof Error && err.name === 'AbortError'
        ? "Mission data request timed out."
        : "Could not load mission data. Check backend connection.";
      setTasksError(message);
    } finally {
      setTasksLoading(false);
      setTasksLoadingSlow(false);
    }
  };

  const runAgentPulse = async (twinProf = performanceTwin) => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks/pulse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twinProfile: twinProf })
      });
      if (!res.ok) throw new Error("Pulse error");
      const data = await res.json();
      // Only update tasks if pulse returned actual data — prevents disappearance bug
      if (Array.isArray(data) && data.length > 0) {
        replaceTasks(data);
        checkAndSpeakInterventions(data);
      }
    } catch (err) {
      console.warn("Pulse failed, preserving current task state:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const initDashboard = async () => {
      const savedName = localStorage.getItem("chronos-username");
      const savedTwin = localStorage.getItem("chronos-performance-twin");
      const localTwinValid = !!savedTwin && !isPlaceholderTwin(savedTwin);

      if (!localTwinValid) {
        if (!cancelled) router.push('/');
        return;
      }

      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/settings`, {}, 10000);
        if (res.ok) {
          const data = await res.json();
          const backendTwinValid = data.twinProfile && !isPlaceholderTwin(data.twinProfile);
          const onboardingDone = data.onboarding_completed === 1 || data.onboarding_completed === true;

          if (!onboardingDone && !localTwinValid && !backendTwinValid) {
            if (!cancelled) router.push('/');
            return;
          }

          if (!onboardingDone && localTwinValid) {
            await fetch(`${API_BASE}/api/settings`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: isRealUsername(savedName) ? savedName : (isRealUsername(data.username) ? data.username : savedName),
                twinProfile: savedTwin,
                sleepStart: data.sleepStart ?? Number(localStorage.getItem('chronos-sleep-start') ?? 23),
                sleepEnd: data.sleepEnd ?? Number(localStorage.getItem('chronos-sleep-end') ?? 7),
                onboardingComplete: true,
              }),
            });
          }
        }
      } catch {
        if (!localTwinValid) {
          if (!cancelled) router.push('/');
          return;
        }
      }

      if (cancelled) return;

      const nameVal = isRealUsername(savedName) ? savedName! : "user";
      setUsername(nameVal);
      setPerformanceTwin(savedTwin!);

      const savedConfig = localStorage.getItem("chronos-ai-config");
      const configVal = savedConfig ? JSON.parse(savedConfig) : {
        provider: 'gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: '',
        model: 'gemini-1.5-flash',
        maxQuestions: 7
      };
      setAiConfig(configVal);

      const savedActiveRecovery = localStorage.getItem("chronos-active-recovery-task-id");
      if (savedActiveRecovery) {
        setActiveRecoveryTaskId(savedActiveRecovery);
      }

      const fetchBackendSettings = async () => {
        try {
          const res = await fetchWithTimeout(`${API_BASE}/api/settings`, {}, 10000);
          if (res.ok) {
            const data = await res.json();
            const localName = localStorage.getItem("chronos-username");
            if (isRealUsername(data.username)) {
              setUsername(data.username);
              localStorage.setItem("chronos-username", data.username);
            } else if (isRealUsername(localName)) {
              setUsername(localName!);
            }
            if (data.sleepStart !== undefined) {
              setSleepStart(Number(data.sleepStart));
              localStorage.setItem('chronos-sleep-start', String(data.sleepStart));
            }
            if (data.sleepEnd !== undefined) {
              setSleepEnd(Number(data.sleepEnd));
              localStorage.setItem('chronos-sleep-end', String(data.sleepEnd));
            }
            if (data.ntfyTopic !== undefined) setNtfyTopic(data.ntfyTopic);
            if (data.twinProfile && !isPlaceholderTwin(data.twinProfile)) {
              setPerformanceTwin(data.twinProfile);
              localStorage.setItem("chronos-performance-twin", data.twinProfile);
            }
            if (data.procrastinationRating !== undefined) setProcrastinationRating(Number(data.procrastinationRating));
            if (data.attentionCycle !== undefined) setAttentionCycle(data.attentionCycle);
            if (data.stressResponse !== undefined) setStressResponse(data.stressResponse);
            if (data.executionCount !== undefined) setExecutionCount(Number(data.executionCount));
            if (data.failureCount !== undefined) setFailureCount(Number(data.failureCount));
            if (data.streakCount !== undefined) setStreakCount(Number(data.streakCount));
            if (data.totalRecoveredHours !== undefined) setTotalRecoveredHours(Number(data.totalRecoveredHours));
            if (data.aiProvider) {
              const configObj = {
                provider: data.aiProvider,
                apiUrl: data.aiApiUrl || '',
                apiKey: data.aiApiKey || '',
                model: data.aiModel || 'gemini-1.5-flash',
                maxQuestions: 7
              };
              setAiConfig(configObj);
              localStorage.setItem("chronos-ai-config", JSON.stringify(configObj));
            }
          }
        } catch (err) {
          console.warn("Failed to fetch settings from backend on dashboard mount", err);
        }
      };

      await fetchBackendSettings();
      await fetchTasks();
      await runAgentPulse(savedTwin!);

      try {
        fetch(`${API_BASE}/api/voice/briefing`, { method: "POST" });
      } catch (e) {}
    };

    initDashboard();

    const interval = setInterval(() => {
      const twin = localStorage.getItem("chronos-performance-twin");
      if (twin && !isPlaceholderTwin(twin)) runAgentPulse(twin);
    }, 12000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);


  // Initialize Settings States when opened (only on open transition)
  const settingsInitRef = useRef(false);
  useEffect(() => {
    if (openSettings && !settingsInitRef.current) {
      settingsInitRef.current = true;
      if (aiConfig) {
        setSettingsProvider(aiConfig.provider || 'gemini');
        setSettingsApiUrl(aiConfig.apiUrl || 'https://generativelanguage.googleapis.com/v1beta');
        setSettingsApiKey(aiConfig.apiKey || '');
        setSettingsModel(aiConfig.model || 'gemini-1.5-flash');
      }
      
      // Fetch backend settings (username, sleep hours)
      fetch(`${API_BASE}/api/settings`)
        .then(res => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then(data => {
          const localName = localStorage.getItem('chronos-username');
          if (localName && (!data.username || data.username === 'user')) {
            setUsername(localName);
          } else if (data.username) {
            setUsername(data.username);
          }
          if (data.sleepStart !== undefined) setSleepStart(data.sleepStart);
          if (data.sleepEnd !== undefined) setSleepEnd(data.sleepEnd);
          if (data.ntfyTopic !== undefined) setNtfyTopic(data.ntfyTopic);
          if (data.procrastinationRating !== undefined) setProcrastinationRating(Number(data.procrastinationRating));
          if (data.attentionCycle !== undefined) setAttentionCycle(data.attentionCycle);
          if (data.stressResponse !== undefined) setStressResponse(data.stressResponse);
          if (data.executionCount !== undefined) setExecutionCount(Number(data.executionCount));
          if (data.failureCount !== undefined) setFailureCount(Number(data.failureCount));
          if (data.streakCount !== undefined) setStreakCount(Number(data.streakCount));
          if (data.totalRecoveredHours !== undefined) setTotalRecoveredHours(Number(data.totalRecoveredHours));
        })
        .catch(err => console.warn("Failed to fetch settings from backend", err));
    } else if (!openSettings) {
      settingsInitRef.current = false;
    }
  }, [openSettings]);

  // Dynamic Model Fetching & Connectivity Validation in Settings
  useEffect(() => {
    const provider = openSettings ? settingsProvider : (aiConfig?.provider || 'gemini');
    const defaultApiUrl = provider === 'gemini' 
      ? 'https://generativelanguage.googleapis.com/v1beta' 
      : (provider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' : 'http://localhost:11434');
    const apiUrl = openSettings 
      ? (settingsProvider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : settingsApiUrl) 
      : (aiConfig?.apiUrl || defaultApiUrl);
    const apiKey = openSettings ? settingsApiKey : (aiConfig?.apiKey || '');

    let active = true;
    const fetchModelsAndValidate = async () => {
      // Don't validate if key is incomplete/empty
      if (provider !== 'custom' && (!apiKey || apiKey.trim().length <= 5)) {
        if (openSettings) {
          setSettingsConnectionStatus('offline');
          setSettingsConnectionError('API Key is incomplete.');
        } else {
          setAiConnectionStatus('offline');
        }
        return;
      }

      if (openSettings) {
        setSettingsLoadingModels(true);
        setSettingsConnectionStatus('checking');
        setSettingsConnectionError('');
        setSettingsAvailableModels([]);
      } else {
        setAiConnectionStatus('checking');
      }
      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/ai/models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: provider,
            apiUrl: apiUrl,
            apiKey: apiKey || '',
          }),
        }, 8000);
        if (!res.ok) throw new Error("Verification request failed");
        const data = await res.json();
        
        if (active) {
          if (data.offline) {
            if (openSettings) {
              setSettingsConnectionStatus('offline');
              setSettingsConnectionError(
                settingsProvider === 'gemini'
                  ? "GEMINI OFFLINE: Unreachable or API Key is invalid. Please verify your Google Gemini API Key."
                  : settingsProvider === 'nvidia'
                    ? "NVIDIA NIM OFFLINE: Unreachable or API Key is invalid. Please verify your NVIDIA API Key (nvapi-...) has active credits."
                    : "CUSTOM CORE OFFLINE: Unreachable or verification failed. Please check your Base URL and settings."
              );
            } else {
              setAiConnectionStatus('offline');
            }
          } else {
            if (openSettings) {
              setSettingsConnectionStatus('online');
              if (data.models) {
                setSettingsAvailableModels(data.models);
                if (!data.models.includes(settingsModel)) {
                  setSettingsModel(data.models[0] || '');
                }
              }
            } else {
              setAiConnectionStatus('online');
            }
          }
        }
      } catch (err) {
        if (active) {
          if (openSettings) {
            setSettingsConnectionStatus('offline');
            setSettingsConnectionError(
              settingsProvider === 'gemini'
                ? "CONNECTION ERROR: Could not reach the Google Gemini API. Verify your API Key and internet connection."
                : settingsProvider === 'nvidia'
                  ? "CONNECTION ERROR: Could not reach the NVIDIA NIM API. Verify your API Key and internet connection."
                  : "CONNECTION ERROR: Could not reach your Custom API endpoint. Verify your Base URL and internet connection."
            );
          } else {
            setAiConnectionStatus('offline');
          }
        }
      } finally {
        if (active && openSettings) {
          setSettingsLoadingModels(false);
        }
      }
    };

    const delayDebounce = setTimeout(fetchModelsAndValidate, 1500);

    return () => {
      active = false;
      clearTimeout(delayDebounce);
    };
  }, [settingsProvider, settingsApiUrl, settingsApiKey, openSettings, settingsRecheckTrigger, aiConfig?.provider, aiConfig?.apiUrl, aiConfig?.apiKey]);

  const handleSaveSettings = async () => {
    if (isSavingSettings) return;
    if (settingsProvider !== 'custom' && !settingsApiKey.trim()) {
      toast.error("API Key is mandatory for this supplier.");
      return;
    }
    if (!settingsModel.trim()) {
      toast.error("AI Model name is mandatory.");
      return;
    }

    setIsSavingSettings(true);
    const toastId = toast.loading("Saving settings...");

    const newConfig = {
      provider: settingsProvider,
      apiUrl: settingsProvider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : settingsApiUrl,
      apiKey: settingsApiKey,
      model: settingsModel,
      maxQuestions: aiConfig?.maxQuestions || 7
    };
    localStorage.setItem('chronos-ai-config', JSON.stringify(newConfig));
    localStorage.setItem('chronos-username', username);
    localStorage.setItem('chronos-sleep-start', String(sleepStart));
    localStorage.setItem('chronos-sleep-end', String(sleepEnd));
    setAiConfig(newConfig);
    
    try {
      await fetchWithTimeout(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          twinProfile: performanceTwin,
          sleepStart: Number(sleepStart),
          sleepEnd: Number(sleepEnd),
          ntfyTopic: ntfyTopic,
procrastinationRating: procrastinationRating !== null ? Number(procrastinationRating) : undefined,
           attentionCycle: attentionCycle !== null ? attentionCycle : undefined,
           stressResponse: stressResponse !== null ? stressResponse : undefined,
          aiProvider: settingsProvider,
          aiApiUrl: settingsProvider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : settingsApiUrl,
          aiApiKey: settingsApiKey,
          aiModel: settingsModel
        })
      }, 15000);
      fetch(`${API_BASE}/api/tasks/pulse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twinProfile: performanceTwin })
      })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) replaceTasks(data); })
      .catch(err => console.warn("Pulse update failed:", err));
      toast.dismiss(toastId);
      toast.success("Settings saved successfully.");
      setOpenSettings(false);
    } catch (err) {
      toast.dismiss(toastId);
      console.warn("Failed to save settings to backend", err);
      toast.error("Failed to save settings. Changes kept locally.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleReverifyTwin = async () => {
    setReverifyingTwin(true);
    const toastId = toast.loading("Re-verifying digital twin behavioral patterns...");
    try {
      await runAgentPulse(performanceTwin);
      toast.dismiss(toastId);
      toast.success("Twin behavioral patterns verified and synchronized successfully!");
    } catch (err) {
      toast.dismiss(toastId);
      toast.error("Twin re-verification failed. Check AI Core settings.");
    } finally {
      setReverifyingTwin(false);
    }
  };

  const handleDeleteTwin = () => {
    if (confirm("⚠️ WARNING: This will permanently delete your Digital Twin behavioral scan data and reset Chronos. Are you sure you want to proceed?")) {
      localStorage.clear();
      toast.info("Twin memory wiped. Re-routing to initialization gateway...");
      navigateTo('/');
    }
  };

  // Parse twin profile to extract brief summary for the dashboard personality card
  const getPersonalityBrief = (twinText: string) => {
    if (!twinText || isPlaceholderTwin(twinText)) return ["Complete the identity scan to initialize your twin profile."];
    
    // Strip markdown title lines
    let clean = twinText
      .replace(/###\s*PERFORMANCE\s*TWIN\s*PROFILE.*/gi, "")
      .replace(/###.*/gi, "")
      .trim();
    
    if (!clean) return ["Analyzing focus windows and behavioral tendencies..."];
    
    // Clean up lines and bullets
    const lines = clean.split('\n')
      .map(l => l.replace(/^\s*-\s*(\*\*)?/, '').replace(/(\*\*)?\s*$/, '').replace(/\*\*/g, '').trim())
      .filter(Boolean);
      
    if (lines.length > 0) {
      return lines.slice(0, 3); // return up to 3 clean bullet lines
    }
    return [clean];
  };

  const renderPersonalityBrief = (twinText: string) => {
    if (!twinText || isPlaceholderTwin(twinText)) {
      return <p className="text-[10px] text-gray-500 font-mono">Complete the identity scan to initialize your twin profile.</p>;
    }
    
    const lines = getPersonalityBrief(twinText);
    return (
      <div className="w-full space-y-2 text-left font-sans">
        {lines.map((line, idx) => {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0 && colonIndex < line.length - 1) {
            const key = line.substring(0, colonIndex).trim();
            const val = line.substring(colonIndex + 1).trim();
            
            let icon = "•";
            if (key.toLowerCase().includes('risk')) icon = "⚠️";
            else if (key.toLowerCase().includes('peak') || key.toLowerCase().includes('hour') || key.toLowerCase().includes('window')) icon = "🕒";
            else if (key.toLowerCase().includes('strategy') || key.toLowerCase().includes('method') || key.toLowerCase().includes('motivation')) icon = "🎯";
            else if (key.toLowerCase().includes('source') || key.toLowerCase().includes('delay') || key.toLowerCase().includes('distraction')) icon = "💡";
            
            return (
              <div key={idx} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-xl flex items-start gap-2.5 hover:bg-white/[0.04] hover:border-[#8A2BE2]/20 transition-all">
                <span className="text-xs select-none mt-0.5">{icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-[8px] font-mono tracking-wider uppercase text-gray-500 block mb-0.5">{key}</span>
                  <span className="text-xs text-gray-300 leading-relaxed font-light block">{val}</span>
                </div>
              </div>
            );
          }
          
          return (
            <div key={idx} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-xl flex items-start gap-2.5 hover:bg-white/[0.04] hover:border-[#8A2BE2]/20 transition-all">
              <span className="text-xs select-none mt-0.5">🧠</span>
              <span className="text-xs text-gray-300 leading-relaxed font-light flex-1">{line}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const handleOrbClick = async () => {
    if (orbState === 'idle') {
      speakVoice("Chronos voice link established. I am observing your focus patterns and defending your active deadlines.");
    } else {
      try {
        await fetch(`${API_BASE}/api/voice/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "idle", text: "Chronos Voice Link: Sync Active." })
        });
      } catch (err) {
        console.warn("Failed to call stop voice endpoint:", err);
      }
    }
  };

  const handleStartTraining = async () => {
    setIsTrainingBrain(true);
    setTrainingLoading(true);
    setTrainingHistory([]);
    setTrainingInput("");

    const config = aiConfig || { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' };

    const initialPrompt = `You are Chronos, the AI onboarding guide. The user is training their Performance Twin Profile.
Here is their current profile summary:
${performanceTwin}

Please ask a new, highly specific diagnostic question to explore their daily life, routines, procrastination habits, distractions, or schedules deeper to improve your understanding of them.
Ask exactly one question. Keep it extremely short (max 15-20 words). Do not write intro filler or headings. Ask the question directly.`;

    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: config.provider,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey || "",
          model: config.model,
          messages: [
            { role: 'system', content: initialPrompt },
            { role: 'user', content: 'Begin profile refinement. Ask the first deeper question.' }
          ]
        })
      });

      if (!res.ok) throw new Error("AI core offline");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setTrainingHistory([{ role: 'assistant', content: data.content }]);
    } catch (err) {
      toast.error("Could not connect to AI core. Proceeding in offline mode.");
      setTrainingHistory([{ role: 'assistant', content: "[Offline Mode] Tell me more about your peak focus hours or typical daily distractions." }]);
    } finally {
      setTrainingLoading(false);
    }
  };

  const handleSendTrainingAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trainingInput.trim() || trainingLoading) return;

    const userInput = trainingInput.trim();
    setTrainingInput("");
    setTrainingLoading(true);

    const updatedHistory = [
      ...trainingHistory,
      { role: 'user', content: userInput }
    ];
    setTrainingHistory(updatedHistory);

    const config = aiConfig || { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' };

    const nextPrompt = `You are Chronos, the AI onboarding guide. The user is answering diagnostic questions to train their behavioral twin.
Here are the scan logs so far:
${JSON.stringify(updatedHistory)}

Please ask a follow-up diagnostic question to probe deeper.
Ask exactly one question. Keep it extremely short (max 15 words). Do not write filler. Ask the question directly.`;

    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: config.provider,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey || "",
          model: config.model,
          messages: [
            { role: 'system', content: nextPrompt },
            { role: 'user', content: 'Ask next follow-up question.' }
          ]
        })
      });

      if (!res.ok) throw new Error("AI core offline");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setTrainingHistory([
        ...updatedHistory,
        { role: 'assistant', content: data.content }
      ]);
    } catch (err) {
      toast.error("AI core offline. Training aborted.");
      setIsTrainingBrain(false);
    } finally {
      setTrainingLoading(false);
    }
  };

  const handleCompileTraining = async () => {
    setTrainingLoading(true);
    const config = aiConfig || { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' };

    const compilePrompt = `You are Chronos, the AI onboarding guide.
The user has completed their twin profile refinement scanning session.
Here is the previous twin profile summary:
${performanceTwin}

Here are the scan logs of questions and answers:
${JSON.stringify(trainingHistory)}

Based on these answers, compile a new, updated Performance Twin Profile. Mention their name: ${username}.
Format it with clear key-value structures where appropriate:
- **Procrastination Risk Level**: [High/Medium/Low] followed by a short explanation of what indicates this susceptibility.
- **Typical Productivity Peak Hours**: [Explanation of peak hours based on answers]
- **Tailored Motivation Strategy**: [Specifically tailored suggestions for them]
- **Behavioral Insights**: [Add any other observations from their replies]

Keep the tone clinical, diagnostic, and highly personalized. Start immediately with a markdown title "### PERFORMANCE TWIN PROFILE". Do not include greetings.`;

    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: config.provider,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey || "",
          model: config.model,
          messages: [
            { role: 'system', content: compilePrompt },
            { role: 'user', content: 'Compile final twin profile.' }
          ]
        })
      });

      if (!res.ok) throw new Error("AI core offline");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      localStorage.setItem("chronos-performance-twin", data.content);
      setPerformanceTwin(data.content);
      
      // Update backend
      await runAgentPulse(data.content);

      toast.success("Twin brain calibrated and trained successfully!");
      setIsTrainingBrain(false);
      setTrainingHistory([]);
      setTrainingInput("");
    } catch (err) {
      toast.error("Failed to compile final profile.");
    } finally {
      setTrainingLoading(false);
    }
  };

  const renderFormattedProfile = (text: string) => {
    if (!text) return <p className="text-gray-400 text-xs">No profile scan loaded.</p>;
    
    const lines = text.split('\n');
    const items: { label: string; value: string; isHeader: boolean; isParagraph: boolean }[] = [];
    
    lines.forEach((line) => {
      let clean = line.trim();
      if (!clean) return;
      
      if (clean.startsWith('###')) {
        items.push({
          label: clean.replace(/###/g, '').trim(),
          value: '',
          isHeader: true,
          isParagraph: false
        });
        return;
      }
      
      // Remove list markers
      clean = clean.replace(/^-\s*/, '');
      
      // Check for key-value pair separated by colon
      const colonIndex = clean.indexOf(':');
      if (colonIndex > 1 && colonIndex < clean.length - 1 && !clean.includes('http://') && !clean.includes('https://')) {
        let key = clean.substring(0, colonIndex).replace(/\*\*/g, '').trim();
        let val = clean.substring(colonIndex + 1).replace(/\*\*/g, '').trim();
        items.push({
          label: key,
          value: val,
          isHeader: false,
          isParagraph: false
        });
      } else {
        items.push({
          label: '',
          value: clean.replace(/\*\*/g, '').trim(),
          isHeader: false,
          isParagraph: true
        });
      }
    });
    
    return (
      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar">
        {items.map((item, idx) => {
          if (item.isHeader) {
            return (
              <div key={idx} className="border-b border-white/5 pb-1 mb-2">
                <h4 className="text-[11px] font-mono tracking-widest uppercase text-[#8A2BE2] font-bold">
                  {item.label}
                </h4>
              </div>
            );
          }
          if (item.isParagraph) {
            return (
              <div key={idx} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-xl text-center">
                <p className="text-xs text-gray-300 leading-relaxed font-sans font-light">
                  {item.value}
                </p>
              </div>
            );
          }
          
          const isRisk = item.label.toLowerCase().includes('risk');
          const isPeak = item.label.toLowerCase().includes('peak') || item.label.toLowerCase().includes('hour');
          
          let valueColor = "text-white";
          let badgeBg = "bg-white/[0.02] border-white/[0.05]";
          
          if (isRisk) {
            if (item.value.toLowerCase().includes('high')) {
              valueColor = "text-red-400 font-semibold";
              badgeBg = "bg-red-950/20 border-red-500/30";
            } else if (item.value.toLowerCase().includes('medium')) {
              valueColor = "text-amber-400 font-semibold";
              badgeBg = "bg-amber-950/20 border-amber-500/30";
            } else {
              valueColor = "text-green-400 font-semibold";
              badgeBg = "bg-green-950/20 border-green-500/30";
            }
          } else if (isPeak) {
            valueColor = "text-[#66FCF1] font-semibold";
            badgeBg = "bg-cyan-950/20 border-[#66FCF1]/20";
          }
          
          return (
            <div key={idx} className={`flex flex-col md:flex-row md:items-center justify-between p-3 rounded-xl border ${badgeBg} gap-2`}>
              <span className="text-[9px] font-mono tracking-wider uppercase text-gray-400">
                {item.label}
              </span>
              <span className={`text-xs font-sans text-right ${valueColor}`}>
                {item.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const handleGenerateCalendarAnalysis = async () => {
    setCalendarAnalysisLoading(true);
    try {
      const scheduleContext = tasks
        .filter(t => !t.completed)
        .map(t => `- "${t.title}": Est effort ${t.estimatedHours}h, due ${new Date(t.due).toLocaleString('en-GB')}, Risk/Survival score: ${t.survivalScore}%`)
        .join("\n");
        
      const systemPrompt = `You are Chronos, a tactical AI deadline defense system. 
You MUST analyze the operator's actual schedule, task deadlines, sleep schedule, and procrastination risks.
Generate a Calendar Debrief structured EXACTLY like the following template. Fill in the bracketed placeholders using the operator's actual real data (e.g. operator name, current date, task names, actual sleep schedule, estimated hours, and risk score/survival score):

CRITICAL RULE: Only report a "sleep overlap" or "scheduling conflict" if a deadline or required work block actually falls WITHIN the operator's sleep window (${sleepStart}:00 to ${sleepEnd}:00). If a deadline occurs during awake hours, explicitly state there is NO sleep conflict for that deadline. Never frame an awake-hour deadline as a sleep scheduling conflict.

# Chronos Calendar Debrief

* **Operator**: [Operator Name]
* **Date**: [Current Date]
* **Priority**: High - Significant risk of burnout and potential project delays exist.
* **Analysis**:
  * **Sleep Hour Overlaps**: [Detail sleep overlaps with the actual deadlines based on sleep schedule]
  * **Risk Mitigation**: Implement a strict "No-Work" period from [Sleep Start] to [Sleep End]. All activity, including device access, is restricted during this time.
  * **Burnout Spikes**: [Explain which actual task has high estimated effort and risk score, and how it impacts the operator]
  * **Actionable Advice**: The operator should:
    * **Divide and Conquer**: Break down the task into smaller, manageable sub-tasks.
    * **Prioritize & Schedule**: Focus on high-impact tasks first using a time management technique.
    * **Take Breaks**: Implement short breaks throughout each task block to avoid mental fatigue.
* **Timeline Visualization**: [Provide a detailed text or ascii-art timeline matrix showing the active task deadlines relative to work and sleep hours]
* **Recommendations**:
  * **Communication & Coordination**: [Provide details based on the task topic]
  * **Performance Monitoring**: Continuously monitor the operator's performance.
  * **Emergency Plan**: Develop a plan if the deadline is at risk of being missed due to burnout.
* **Disclaimer**: This analysis provides strategic insight based on the provided information. Chronos' recommendations are designed to mitigate risks and promote optimal performance.
* **Note**: Further analysis can be conducted with more data points, including:
  * Previous project experiences.
  * Task difficulty and dependencies.
  * Individual work style tendencies.
* **Next Steps**: Implement these recommendations to ensure the operator's well-being and project success.`;

      const userMessage = `Operator Name: ${username}
Current Date: ${new Date().toLocaleDateString('en-GB')}
Current sleep schedule: ${sleepStart}:00 to ${sleepEnd}:00.
Active tasks to defend:
${scheduleContext || "No active tasks in database."}

Generate the tactical calendar debrief now.`;

      const apiPayload = {
        provider: aiConfig?.provider || 'gemini',
        apiUrl: aiConfig?.apiUrl || 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: aiConfig?.apiKey || '',
        model: aiConfig?.model || 'gemini-1.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      };

      const res = await fetchWithTimeout(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload)
      }, 60000);

      if (!res.ok) throw new Error("AI Chat API failed");
      const resData = await res.json();
      setCalendarAnalysis(resData.content || "Failed to compile calendar data.");
    } catch (err) {
      console.error("Failed to generate calendar debrief", err);
      // Construct a beautiful high-fidelity local fallback using real data
      const activeTaskList = tasks.filter(t => !t.completed);
      const totalActiveEffort = activeTaskList.reduce((sum, t) => sum + t.estimatedHours, 0);
      const topTask = activeTaskList.length > 0 ? activeTaskList[0] : null;
      const topTaskTitle = topTask ? topTask.title : "No active tasks";
      const formattedDate = new Date().toLocaleDateString('en-GB');

      const sleepHoursList: number[] = [];
      let curr = sleepStart;
      while (curr !== sleepEnd) {
        sleepHoursList.push(curr);
        curr = (curr + 1) % 24;
      }

      const tasksWithSleepOverlap = activeTaskList.filter(t => {
        if (!t.due) return false;
        const dueHour = new Date(t.due).getHours();
        return sleepHoursList.includes(dueHour);
      });

      const sleepOverlapText = tasksWithSleepOverlap.length > 0
        ? `${tasksWithSleepOverlap.length} active deadline${tasksWithSleepOverlap.length > 1 ? 's' : ''} fall inside the sleep window (${sleepStart}:00–${sleepEnd}:00).`
        : `No active deadlines fall inside the sleep window (${sleepStart}:00–${sleepEnd}:00).`;

      const fallbackText = `# Chronos Calendar Debrief (Local Fallback)

* **Operator**: ${username}
* **Date**: ${formattedDate}
* **Priority**: ${activeTaskList.length === 0 ? 'Low - No active missions' : totalActiveEffort > 20 ? 'High - Heavy workload detected' : 'Moderate - Active missions in progress'}
* **Analysis**:
  * **Active Missions**: ${activeTaskList.length} task${activeTaskList.length !== 1 ? 's' : ''} in progress, ${totalActiveEffort.toFixed(1)}h total estimated effort.
  * **Sleep Hour Overlaps**: ${sleepOverlapText}
  * **Top Priority**: "${topTaskTitle}"${topTask ? ` due ${new Date(topTask.due).toLocaleDateString('en-GB')}` : ''}.
* **Actionable Advice**:
  * Review the task list above and confirm deadlines are realistic given the sleep schedule.
  * If any deadline falls in the sleep window, consider shifting it to an earlier awake hour.
  * Use the AI Debrief for a full tactical analysis when the AI Core is online.
* **Disclaimer**: This is a simplified local analysis. For full AI-generated tactical advice, ensure the AI Core is online and retry.`;

      setCalendarAnalysis(fallbackText);
    } finally {
      setCalendarAnalysisLoading(false);
    }
  };

  useEffect(() => {
    if (currentView === 'calendar-debrief' && !calendarAnalysisLoading && aiConfig) {
      setCalendarAnalysis("");
      handleGenerateCalendarAnalysis();
    }
  }, [currentView, aiConfig, sleepStart, sleepEnd, username, tasks]);

  const handleSendTerminalMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = terminalInput.trim();
    if (!query) return;

    setTerminalInput("");
    setTerminalHistory(prev => [...prev, { sender: 'user', text: query }]);
    setTerminalLoading(true);
    setOrbState('thinking');
    setOrbText("Chronos: Thinking...");

    const queryLower = query.toLowerCase();

    // 1. Quick command matches (local execution)
    if (queryLower.includes("simulate time") || queryLower.includes("time passage") || queryLower.includes("advance time")) {
      setTerminalHistory(prev => [...prev, { sender: 'chronos', text: "Executing Developer Command: Advancing time by 1 hour." }]);
      await handleSimulateTime();
      setTerminalLoading(false);
      setOrbState('idle');
      return;
    }

    if (queryLower.includes("simulate collapse") || queryLower.includes("deadlines collapse") || queryLower.includes("emergency mode")) {
      setTerminalHistory(prev => [...prev, { sender: 'chronos', text: "Executing Developer Command: Triggering deadline collapse simulation." }]);
      await handleSimulateCollapse();
      setTerminalLoading(false);
      setOrbState('idle');
      return;
    }

    if (queryLower.includes("pulse") || queryLower.includes("evaluate tasks") || queryLower.includes("check risk")) {
      setTerminalHistory(prev => [...prev, { sender: 'chronos', text: "Executing System Calibration: Recalculating threat metrics." }]);
      await fetchTasks();
      toast.success("Risk calibration complete.");
      setTerminalLoading(false);
      setOrbState('idle');
      return;
    }

    if (queryLower.includes("rescue") || queryLower.includes("recovery") || queryLower.includes("activate recovery") || queryLower.includes("help me recover")) {
      const target = tasks.find(t => ['red', 'orange', 'yellow', 'black'].includes(t.escalationLevel || '')) || tasks[0];
      if (target) {
        setTerminalHistory(prev => [...prev, { sender: 'chronos', text: `Executing Intervention: Applying Recovery Protocol to "${target.title}".` }]);
        try {
          const res = await fetch(`${API_BASE}/api/tasks/${target.id}/rescue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ twinProfile: performanceTwin })
          });
          if (res.ok) {
            await fetchTasks();
            toast.success(`Rescue protocol applied: "${target.title}"`);
          }
        } catch (err) {
          console.error("Rescue failed:", err);
        }
      } else {
        setTerminalHistory(prev => [...prev, { sender: 'chronos', text: "System State: No active tasks found to apply recovery protocol." }]);
      }
      setTerminalLoading(false);
      setOrbState('idle');
      return;
    }

    // 2. Query AI core directly
    try {
      const activeTasksStr = tasks
        .filter(t => !t.completed)
        .map(t => `'${t.title}' (Score: ${t.survivalScore}%, due in ${t.riskAnalysis?.timeRemaining}h, est: ${t.riskAnalysis?.workRemaining}h)`)
        .join(", ");
      const tasksInfo = activeTasksStr ? ` Active tasks: ${activeTasksStr}.` : "";
      
      const systemPrompt = `You are Chronos, a tactical AI deadline defense system. The operator's name is ${username}.
The current system date and time is ${new Date().toLocaleString('en-GB')}.
Keep your response strictly to 1 or 2 short sentences. Your tone is highly professional, focused, and slightly urgent (like mission control).
You support task creation and simulation commands via special tags. If the user wants to add/create a task, estimate its duration (default 2.0 hours) and importance (default 'medium'), compute the deadline relative to the current time, and format: [CREATE_TASK: {"title": "Task Title", "due": "YYYY-MM-DDTHH:MM:SS", "estimatedHours": X.Y, "importance": "low|medium|high"}]
Consider the operator's digital twin profile: ${performanceTwin}.${tasksInfo}`;

      const apiPayload = {
        provider: aiConfig?.provider || 'gemini',
        apiUrl: aiConfig?.apiUrl || 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: aiConfig?.apiKey || '',
        model: aiConfig?.model || 'gemini-1.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ]
      };

      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload)
      });

      if (!res.ok) throw new Error("AI core returned failure");
      const resData = await res.json();
      let replyText = resData.content || "";

      // Parse and execute task creation tags
      const createTaskMatch = replyText.match(/\[CREATE_TASK:\s*(\{.*?\})\]/i);
      if (createTaskMatch && createTaskMatch[1]) {
        try {
          const taskData = JSON.parse(createTaskMatch[1]);
          let dueVal = taskData.due;
          if (!dueVal || dueVal.includes('YYYY') || isNaN(Date.parse(dueVal))) {
            const fallback = new Date();
            fallback.setHours(fallback.getHours() + 4);
            dueVal = fallback.toISOString();
          }
          await fetch(`${API_BASE}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: taskData.title,
              due: dueVal,
              estimatedHours: taskData.estimatedHours || 2.0,
              importance: taskData.importance || 'medium'
            })
          });
          await fetchTasks();
          toast.success(`Task Created via AI: "${taskData.title}"`);
        } catch (e) {
          console.error("Failed to execute AI task creation:", e);
        }
        replyText = replyText.replace(/\[CREATE_TASK:\s*(\{.*?\})\]/i, '').trim();
      }

      setTerminalHistory(prev => [...prev, { sender: 'chronos', text: replyText }]);
      setOrbState('speaking');
      setOrbText(`Chronos: "${replyText}"`);
      await speakVoice(replyText);
      
      setTimeout(() => {
        setOrbState('idle');
        setOrbText("Chronos Voice Link: Sync Active.");
      }, 5000);

    } catch (err) {
      console.error("Terminal AI error:", err);
      setTerminalHistory(prev => [...prev, { sender: 'chronos', text: "Error: AI Core connection failure. Check settings." }]);
      setOrbState('idle');
    } finally {
      setTerminalLoading(false);
    }
  };

  const handleSimulateTime = async () => {
    const toastId = toast.loading("Simulating time passage (+1 hour)...");
    try {
      const res = await fetch(`${API_BASE}/api/tasks/simulate/time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twinProfile: performanceTwin })
      });
      if (!res.ok) throw new Error("Simulation error");
      const data = await res.json();
      replaceTasks(data);
      toast.dismiss(toastId);
      toast.info("Clock advanced by 1 hour. Survival Probabilities recalculated.");
      checkAndSpeakInterventions(data);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error("Time simulation failed.");
    }
  };

  const handleSimulateCollapse = async () => {
    const toastId = toast.loading("Triggering forced Deadline Collapse...");
    try {
      const res = await fetch(`${API_BASE}/api/tasks/simulate/collapse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twinProfile: performanceTwin })
      });
      if (!res.ok) throw new Error("Collapse error");
      const data = await res.json();
      replaceTasks(data);
      toast.dismiss(toastId);
      toast.error("⚠ DEADLINE COLLAPSE DETECTED. Emergency Protocol Activated.");
      checkAndSpeakInterventions(data);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error("Collapse simulation failed.");
    }
  };

  const handleLoadPresets = async () => {
    const toastId = toast.loading("Loading Hackathon Demo Presets...");
    try {
      const res = await fetch(`${API_BASE}/api/tasks/presets/load`, {
        method: "POST"
      });
      if (!res.ok) throw new Error();
      toast.dismiss(toastId);
      toast.success("Hackathon Preset Missions loaded successfully!");
      fetchTasks();
    } catch (e) {
      toast.dismiss(toastId);
      toast.error("Failed to load presets.");
    }
  };

  const handleSyncGoogleCalendarDirect = async () => {
    if (calendarSyncState === 'syncing') return;
    setCalendarSyncState('syncing');
    const toastId = toast.loading("Syncing Google Calendar events...");
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/calendar/sync`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontend_origin: window.location.origin })
      }, 20000);
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.dismiss(toastId);
      localStorage.setItem('chronos-calendar-connected', 'true');
      if (data.count > 0) {
        toast.success(`Synced Google Calendar: Imported ${data.count} Locked Tasks.`);
      } else {
        toast.info("Google Calendar is up to date.");
      }
      fetchTasks();
    } catch (e) {
      toast.dismiss(toastId);
      toast.error("Google Calendar sync failed or timed out.");
    } finally {
      setCalendarSyncState('idle');
    }
  };

  const handleChangeGoogleAccount = async () => {
    const toastId = toast.loading("Resetting calendar link...");
    try {
      const res = await fetch(`${API_BASE}/api/calendar/logout`, {
        method: "POST"
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

  const handleSyncGoogleCalendar = async () => {
    if (calendarSyncState !== 'idle') return;
    setCalendarSyncState('authorizing');
    const toastId = toast.loading("Syncing Google Calendar events...");
    const authTimeout = setTimeout(() => {
      setCalendarSyncState('idle');
      toast.dismiss(toastId);
      toast.error("Calendar authorization timed out. Please try again.");
    }, 15000);

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/calendar/sync`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontend_origin: window.location.origin })
      }, 20000);
      if (!res.ok) throw new Error();
      const data = await res.json();
      
      if (data.status === 'auth_required') {
        toast.dismiss(toastId);
        toast.info("Complete Google authorization in the popup window...");
        window.open(data.url, 'ChronosGoogleAuth', 'width=600,height=700');
        
        const handleAuthMessage = async (e: MessageEvent) => {
          if (e.data && e.data.type === 'CHRONOS_GCAL_AUTH_SUCCESS') {
            window.removeEventListener('message', handleAuthMessage);
            clearTimeout(authTimeout);
            setCalendarSyncState('syncing');
            toast.success("Google Calendar authenticated! Fetching events...");
            await handleSyncGoogleCalendarDirect();
          }
        };
        window.addEventListener('message', handleAuthMessage);
      } else {
        clearTimeout(authTimeout);
        toast.dismiss(toastId);
        localStorage.setItem('chronos-calendar-connected', 'true');
        if (data.count > 0) {
          toast.success(`Synced Google Calendar: Imported ${data.count} Locked Tasks.`);
        } else {
          toast.info("Google Calendar is up to date.");
        }
        fetchTasks();
        setCalendarSyncState('idle');
      }
    } catch (e) {
      clearTimeout(authTimeout);
      toast.dismiss(toastId);
      toast.error("Google Calendar sync failed or timed out.");
      setCalendarSyncState('idle');
    }
  };

  const browserSpeak = (text: string) => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const targetVoice = voices.find(v => v.name.includes("Google US English") || v.name.includes("Bella") || v.lang.startsWith("en"));
      if (targetVoice) utterance.voice = targetVoice;
      window.speechSynthesis.speak(utterance);
    }
  };

  const [isBrowserListening, setIsBrowserListening] = useState(false);

  const startBrowserRecognition = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech Recognition is not supported in this browser.");
      return;
    }
    
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch(e){}
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    setOrbState('listening');
    setOrbText("Chronos: Listening (Browser Fallback)...");
    setIsBrowserListening(true);
    
    recognition.onresult = async (event: any) => {
      const speechToText = event.results[0][0].transcript;
      setOrbState('thinking');
      setOrbText(`Chronos: Transcribed "${speechToText}"`);
      
      try {
        const response = await fetch(`${API_BASE}/api/ai/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: aiConfig?.provider || 'gemini',
            apiUrl: aiConfig?.apiUrl || '',
            apiKey: aiConfig?.apiKey || '',
            model: aiConfig?.model || 'gemini-1.5-flash',
            messages: [{ role: 'user', content: speechToText }]
          })
        });
        
        if (response.ok) {
          const resData = await response.json();
          let replyText = resData.content || "";
          
          let cmd_tag = null;
          let create_task_tags: string[] = [];
          
          const cmd_match = replyText.match(/\[CMD:\s*(\w+)\]/);
          if (cmd_match) {
            cmd_tag = cmd_match[1];
            replyText = replyText.replace(/\[CMD:\s*\w+\]/g, '').trim();
          }
          
          const task_matches = replyText.matchAll(/\[CREATE_TASK:\s*(\{[\s\S]*?\})\]/g);
          for (const m of task_matches) {
            create_task_tags.push(m[1]);
          }
          replyText = replyText.replace(/\[CREATE_TASK:\s*\{[\s\S]*?\}\]/g, '').trim();
          
          if (cmd_tag) {
            if (cmd_tag === "SIMULATE_TIME") handleSimulateTime();
            else if (cmd_tag === "SIMULATE_COLLAPSE") handleSimulateCollapse();
            else if (cmd_tag === "RUN_PULSE") runAgentPulse(performanceTwin);
            else if (cmd_tag === "RESCUE") {
              const target_task = tasks.find(t => ['red', 'black', 'orange'].includes(t.escalationLevel || ''));
              if (target_task) triggerAiRescue(target_task);
            }
          }
          
          for (const tag of create_task_tags) {
            try {
              const task_data = JSON.parse(tag);
              const createRes = await fetch(`${API_BASE}/api/tasks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: task_data.title,
                  due: task_data.due,
                  estimatedHours: task_data.estimatedHours,
                  importance: task_data.importance,
                  twinProfile: performanceTwin
                })
              });
              if (createRes.ok) {
                toast.success(`Created Voice Task: ${task_data.title}`);
              }
            } catch (e) {}
          }
          
          fetchTasks();
          setOrbState('speaking');
          setOrbText(`Chronos: "${replyText}"`);
          browserSpeak(replyText);
          
          setTimeout(() => {
            setOrbState('idle');
            setOrbText("Chronos Voice Link: Sync Active (Browser Fallback).");
          }, 6000);
        }
      } catch (err) {
        toast.error("AI chat failed in browser speech fallback.");
        setOrbState('idle');
        setOrbText("Chronos Voice Link: Fallback error.");
      }
    };
    
    recognition.onspeechend = () => {
      recognition.stop();
      setIsBrowserListening(false);
    };

    recognition.onend = () => {
      setIsBrowserListening(false);
      setOrbState(prev => prev === 'listening' ? 'idle' : prev);
      setOrbText(prev => prev.includes("Listening") ? "Chronos Voice Link: Sync Active." : prev);
    };
    
    recognition.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      if (event.error === 'not-allowed') {
        toast.error("Microphone access denied. Please click the microphone icon in the browser address bar and select 'Allow' to use voice features.");
      } else if (event.error !== 'no-speech') {
        toast.error(`Speech recognition failed: ${event.error}`);
      }
      setOrbState('idle');
      setOrbText("Chronos Voice Link: Sync Active.");
      setIsBrowserListening(false);
    };
    
    recognition.start();
  };

  const checkAndSpeakInterventions = (tasksList: Task[]) => {
    // Handled by push-based backend coordinator to prevent duplication
  };

  const speakVoice = async (text: string) => {
    try {
      await fetch(`${API_BASE}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
    } catch (err) {
      console.warn("Failed to reach backend voice speak service:", err);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDue) {
      toast.error("Please fill in all required fields.");
      return;
    }
    if (isAddingTask) return; // prevent double-click
    setIsAddingTask(true);

    try {
      if (briefingTaskId) {
        // Unlock existing Google Calendar task
        const res = await fetch(`${API_BASE}/api/tasks/${briefingTaskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: JSON.stringify({ locked_intake: false, aiSummary: estChatHistory, completedCheckpoints: [] }),
            estimatedHours: Number(newHours),
            importance: newImportance,
            due: new Date(newDue).toISOString()
          })
        });
        if (!res.ok) throw new Error("Unlock failed");
        
        toast.success("Calendar mission target successfully unlocked and scheduled!");
        setBriefingTaskId(null);
      } else {
        // Create new task
        const res = await fetch(`${API_BASE}/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newTitle,
            due: new Date(newDue).toISOString(),
            estimatedHours: Number(newHours),
            importance: newImportance,
            twinProfile: performanceTwin,
            aiConfig: aiConfig,
            aiSummary: JSON.stringify(estChatHistory)
          })
        });
        if (!res.ok) throw new Error("Add task failed");
        toast.success("New task committed to Mission Timeline defense.");
      }

      fetchTasks();
      setNewTitle("");
      setNewDue("");
      setNewHours(2);
      setNewImportance("medium");
      setOpenAdd(false);
      setShowEstimationAssistant(false);
      setEstChatHistory([]);
      setSuggestedEstimate(null);
      setHasCompletedAiEstimation(false);
    } catch (err) {
      toast.error("Failed to commit task operations.");
    } finally {
      setIsAddingTask(false);
    }
  };

  const handlePrevMonth = () => {
    setActiveCalMonth(prev => {
      if (prev === 0) {
        setActiveCalYear(y => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setActiveCalMonth(prev => {
      if (prev === 11) {
        setActiveCalYear(y => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const handleOpenAddTaskWithDate = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    setNewDue(`${yyyy}-${mm}-${dd}T14:00`);
    setOpenAdd(true);
  };

  const deleteTask = async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/tasks/${id}`, {
        method: "DELETE"
      });
      const filtered = tasks.filter(t => t.id !== id);
      replaceTasks(filtered);
      toast.info("Task threat dismissed.");
    } catch (err) {
      toast.error("Failed to delete task.");
    }
  };

  const handleToggleComplete = async (task: Task) => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !task.completed, twinProfile: performanceTwin })
      });
      if (!res.ok) throw new Error("Update complete status failed");
      const updated = await res.json();
      setTasks(prev => {
        const next = prev.map(t => t.id === task.id ? updated : t);
        cacheTasks(next);
        return next;
      });
      toast.success(updated.completed ? "Deadline defended! Task secured." : "Task reopened for monitoring.");
    } catch (err) {
      toast.error("Failed to update status.");
    }
  };

  const triggerAiRescue = async (task: Task) => {
    if (rescueLoading) return;
    setRescuingTaskId(task.id);
    setRescueLoading(true);
    setRescueData(task);
    setRescueBriefing(null);
    setRescueError(null);
    setRecoveryChatHistory([]);

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/tasks/${task.id}/rescue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twinProfile: performanceTwin, aiConfig: aiConfig })
      }, 60000);

      if (!res.ok) throw new Error(`Rescue failed with status ${res.status}`);
      const updatedTask = await res.json();

      // Update local state
      setTasks(prev => {
        const next = prev.map(t => t.id === task.id ? updatedTask : t);
        cacheTasks(next);
        return next;
      });
      setRescueData(updatedTask);

      const resources = updatedTask.rescueResources;
      setRecoveryChatHistory([
        { role: 'assistant', content: `Hello, ${username}! I have initialized the temporal recovery protocol for "${task.title}". The success forecast is ${resources.recoveryProbability}%. Let's review the checklist. How should we optimize it?` }
      ]);

      const briefing = updatedTask.recoveryBriefing;
      if (briefing) {
        setRescueBriefing(briefing);
      }

      speakVoice(`Recovery protocol applied. Success forecast is now ${resources.recoveryProbability} percent. New point of no return is ${updatedTask.newPointOfNoReturn}.`);
    } catch (err: any) {
      console.warn("Rescue failed:", err);
      setRescueError(err?.message || "Failed to generate recovery protocol. The AI Core may be offline or the request timed out.");
    } finally {
      setRescueLoading(false);
    }
  };

  const handleSendRecoveryChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryChatInput.trim() || recoveryChatLoading || !rescueData) return;

    const userMsg = recoveryChatInput.trim();
    setRecoveryChatInput("");
    setRecoveryChatLoading(true);

    const updatedHistory = [
      ...recoveryChatHistory,
      { role: 'user' as const, content: userMsg }
    ];
    setRecoveryChatHistory(updatedHistory);

    const SYSTEM_RESCUE_PROMPT = `You are the Chronos Recovery Agent. The user is struggling with procrastination for task "${rescueData.title}". The current plan checklist is: ${JSON.stringify(rescueData.rescueResources?.checklist || [])}.
The user wants to negotiate or refine the recovery plan checklist.
Work with them to adjust the micro-steps so they can finish within their estimated work hours and available timeframe.
Always format your responses with the modified checklist inside a JSON-like array block: [NEW_CHECKLIST: ["Step 1", "Step 2", ...]] so the system can parse it, and explain why this plan will work. Keep responses under 3 sentences.`;

    const provider = aiConfig?.provider || 'gemini';
    const useStreaming = provider === 'nvidia';

    try {
      let reply = '';

      if (useStreaming) {
        // Add empty assistant message that will be filled progressively
        setRecoveryChatHistory(prev => [...prev, { role: 'assistant' as const, content: '' }]);

        const abortController = new AbortController();
        const res = await fetch(`${API_BASE}/api/ai/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiUrl: aiConfig?.apiUrl,
            apiKey: aiConfig?.apiKey,
            model: aiConfig?.model,
            messages: [
              { role: 'system', content: SYSTEM_RESCUE_PROMPT },
              ...updatedHistory
            ]
          }),
          signal: abortController.signal
        });

        if (!res.ok) throw new Error("Stream request failed");
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const chunk = parsed.choices?.[0]?.delta?.content || '';
                if (chunk) {
                  reply += chunk;
                  // Update the last assistant message in-place
                  setRecoveryChatHistory(prev => {
                    const copy = [...prev];
                    copy[copy.length - 1] = { role: 'assistant', content: reply };
                    return copy;
                  });
                }
              } catch { /* skip malformed */ }
            }
          }
        }
      } else {
        const res = await fetch(`${API_BASE}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            apiUrl: aiConfig?.apiUrl,
            apiKey: aiConfig?.apiKey,
            model: aiConfig?.model,
            messages: [
              { role: 'system', content: SYSTEM_RESCUE_PROMPT },
              ...updatedHistory
            ]
          })
        });

        if (!res.ok) throw new Error("AI request failed");
        const data = await res.json();
        reply = data.content || "";

        setRecoveryChatHistory(prev => [
          ...prev,
          { role: 'assistant', content: reply }
        ]);
      }

      // Parse NEW_CHECKLIST tag from final reply
      const match = reply.match(/\[NEW_CHECKLIST:\s*(\[[\s\S]*?\])\]/);
      if (match) {
        try {
          const newList = JSON.parse(match[1]);
          if (Array.isArray(newList)) {
            setRescueData(prev => {
              if (!prev) return null;
              const updated = {
                ...prev,
                rescueResources: {
                  ...prev.rescueResources,
                  checklist: newList
                }
              };
              fetch(`${API_BASE}/api/tasks/${prev.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rescueResources: updated.rescueResources })
              }).catch(err => console.warn("Failed to save updated checklist to db", err));
              return updated;
            });
            
            setTasks(prevTasks => {
              const next = prevTasks.map(t => t.id === rescueData.id ? {
                ...t,
                rescueResources: {
                  ...t.rescueResources,
                  checklist: newList
                }
              } : t);
              cacheTasks(next);
              return next;
            });
          }
        } catch (e) {
          console.error("Failed to parse checklist JSON", e);
        }
        // Clean up the reply display
        const cleanedReply = reply.replace(/\[NEW_CHECKLIST:\s*(\[[\s\S]*?\])\]/, '').trim();
        setRecoveryChatHistory(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last.role === 'assistant') {
            copy[copy.length - 1] = { role: 'assistant', content: cleanedReply };
          }
          return copy;
        });
      }
    } catch (err: any) {
      console.error("Recovery chat failed:", err);
      if (!useStreaming || !err.message?.includes('aborted')) {
        setRecoveryChatHistory(prev => [
          ...prev,
          { role: 'assistant', content: `[Error: Connection Interrupted] I was unable to compile an update. Please check that your AI Supplier is online.` }
        ]);
      }
    } finally {
      setRecoveryChatLoading(false);
    }
  };

  const handleOpenEstimationAssistant = async () => {
    setEstChatHistory([]);
    setSuggestedEstimate(null);
    setHasCompletedAiEstimation(false);
    setEstChatLoading(true);
    const sessionId = ++estSessionIdRef.current;

    try {
      const taskTitle = newTitle.trim() || "Untitled Task";

      // Calculate precise net productive hours available for the user
      let netProductiveHoursText = "unknown/not specified";
      if (newDue) {
        const now = new Date();
        const due = new Date(newDue);
        const diffMs = due.getTime() - now.getTime();
        if (diffMs > 0) {
          const totalHours = diffMs / (1000 * 60 * 60);
          
          let sleepHours = 0;
          const temp = new Date(now);
          const sleepStartHour = sleepStart !== undefined ? Number(sleepStart) : 23;
          const sleepEndHour = sleepEnd !== undefined ? Number(sleepEnd) : 7;
          const sleepSet = new Set<number>();
          let h = sleepStartHour;
          while (h !== sleepEndHour) {
            sleepSet.add(h);
            h = (h + 1) % 24;
          }
          
          while (temp < due) {
            if (sleepSet.has(temp.getHours())) {
              sleepHours += 0.5;
            }
            temp.setMinutes(temp.getMinutes() + 30);
          }
          
          const eatingOverhead = 2.0 * (totalHours / 24.0);
          const miscOverhead = 1.5 * (totalHours / 24.0);
          const netHours = Math.max(0.1, totalHours - sleepHours - eatingOverhead - miscOverhead);
          
          netProductiveHoursText = `${netHours.toFixed(1)} productive hours (Total calendar time left: ${totalHours.toFixed(1)}h, Sleep: ${sleepHours.toFixed(1)}h, Eating: ${eatingOverhead.toFixed(1)}h, Misc: ${miscOverhead.toFixed(1)}h)`;
        }
      }

      const systemPrompt = `You are the Chronos Task Intake Assistant.
The user is planning a task titled "${taskTitle}".
Current local time is: ${new Date().toLocaleString('en-GB')}.
Task Deadline (due): ${newDue ? new Date(newDue).toLocaleString('en-GB') : 'not specified'}.
Calculated Net Productive Work Hours remaining before deadline: ${netProductiveHoursText}.

Your goal is to help them accurately estimate the work hours required.
In your very first message:
1. Ask the user to give a brief about the task for better understanding.
2. Ask a targeted diagnostic question about the task's complexity, scope, or blockers.
Keep your response short, engaging, and under 2-3 sentences.`;

      const res = await fetchWithTimeout(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiConfig?.provider || 'gemini',
          apiUrl: aiConfig?.apiUrl,
          apiKey: aiConfig?.apiKey,
          model: aiConfig?.model,
          messages: [
            { role: 'system', content: systemPrompt }
          ]
        })
      }, 60000);

      if (estSessionIdRef.current !== sessionId) return;
      if (!res.ok) throw new Error("AI request failed");
      const data = await res.json();
      if (estSessionIdRef.current !== sessionId) return;
      setEstChatHistory([
        { role: 'assistant', content: data.content || `I see you are working on "${taskTitle}". Could you give me a brief about this task and what complexity you expect?` }
      ]);
      setShowEstimationAssistant(true);
    } catch (err) {
      if (estSessionIdRef.current !== sessionId) return;
      setEstChatHistory([
        { role: 'assistant', content: `I see you are working on "${newTitle || "Untitled Task"}". Could you give me a brief about this task and what complexity you expect?` }
      ]);
      setShowEstimationAssistant(true);
    } finally {
      if (estSessionIdRef.current === sessionId) {
        setEstChatLoading(false);
      }
    }
  };

  const analyzeBehaviorAndUpdateTwin = async (chatLog: Array<{role: 'user' | 'assistant', content: string}>) => {
    try {
      const analysisPrompt = `You are a cognitive behavioral analysis engine.
You are given a chat history between the user and the Chronos Task Intake Assistant.
The current digital twin profile of the user is:
"${performanceTwin}"

Read the user's responses in this chat log:
${JSON.stringify(chatLog.filter(m => m.role === 'user').map(m => m.content))}

Determine if there are minor general behavioral patterns, working styles, or productivity insights that can be deciphered.
Merge these into the existing twin profile ONLY if they represent general tendencies.
DO NOT change the core personality of the digital twin or rewrite it completely based on this single task. Preserve the original general twin profile structure, only refining or adding minor details.
Provide the refined digital twin profile. Keep the format concise, using bullet points. Do NOT include any introductory or concluding text, only return the updated twin profile text itself.`;

      const analysisRes = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiConfig?.provider || 'gemini',
          apiUrl: aiConfig?.apiUrl,
          apiKey: aiConfig?.apiKey,
          model: aiConfig?.model,
          messages: [
            { role: 'system', content: analysisPrompt }
          ]
        })
      });
      if (analysisRes.ok) {
        const analysisData = await analysisRes.json();
        const updatedProfile = analysisData.content || "";
        if (updatedProfile.trim().length > 10) {
          setPerformanceTwin(updatedProfile);
          localStorage.setItem('chronos-performance-twin', updatedProfile);
          
          // Sync to backend Settings
          await fetch(`${API_BASE}/api/settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username,
              twinProfile: updatedProfile,
              sleepStart: Number(sleepStart),
              sleepEnd: Number(sleepEnd),
              ntfyTopic,
              procrastinationRating: Number(procrastinationRating),
              attentionCycle,
              stressResponse
            })
          });
        }
      }
    } catch (err) {
      console.warn("Failed to update digital twin profile from estimation chat", err);
    }
  };

  const handleSendEstChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!estChatInput.trim() || estChatLoading) return;

    const userMsg = estChatInput.trim();
    setEstChatInput("");
    setEstChatLoading(true);

    const updatedHistory = [
      ...estChatHistory,
      { role: 'user' as const, content: userMsg }
    ];
    setEstChatHistory(updatedHistory);

    // Calculate precise net productive hours available for the user
    let netProductiveHoursText = "unknown/not specified";
    if (newDue) {
      const now = new Date();
      const due = new Date(newDue);
      const diffMs = due.getTime() - now.getTime();
      if (diffMs > 0) {
        const totalHours = diffMs / (1000 * 60 * 60);
        
        let sleepHours = 0;
        const temp = new Date(now);
        const sleepStartHour = sleepStart !== undefined ? Number(sleepStart) : 23;
        const sleepEndHour = sleepEnd !== undefined ? Number(sleepEnd) : 7;
        const sleepSet = new Set<number>();
        let h = sleepStartHour;
        while (h !== sleepEndHour) {
          sleepSet.add(h);
          h = (h + 1) % 24;
        }
        
        while (temp < due) {
          if (sleepSet.has(temp.getHours())) {
            sleepHours += 0.5;
          }
          temp.setMinutes(temp.getMinutes() + 30);
        }
        
        const eatingOverhead = 2.0 * (totalHours / 24.0);
        const miscOverhead = 1.5 * (totalHours / 24.0);
        const netHours = Math.max(0.1, totalHours - sleepHours - eatingOverhead - miscOverhead);
        
        netProductiveHoursText = `${netHours.toFixed(1)} hours (Total: ${totalHours.toFixed(1)}h, Sleep: ${sleepHours.toFixed(1)}h, Eating: ${eatingOverhead.toFixed(1)}h, Misc: ${miscOverhead.toFixed(1)}h)`;
      }
    }

    const SYSTEM_ESTIMATE_PROMPT = `You are the Chronos Task Intake Assistant. Your goal is to conduct a thorough intake interview to understand the task scope and estimate effort.
The user is estimating effort for task: "${newTitle.trim()}".
Current local time: ${new Date().toLocaleString('en-GB')}.
Deadline: ${newDue ? new Date(newDue).toLocaleString('en-GB') : 'not specified'}.
Calculated Net Productive Work Hours remaining: ${netProductiveHoursText}.

INTAKE PROCESS PROTOCOL:
1. You MUST ask exactly 3 relevant questions (one at a time) to understand the task details, complexity, tools/stack, and operator familiarity.
2. Under no circumstances should you suggest an estimate or output the [ESTIMATE: number] tag before you have asked these 3 questions and received answers.
3. Keep your questions brief and professional (maximum 2 sentences).
4. On the final turn (after receiving the 3rd answer), analyze the inputs, warn the user if it violates the remaining productive hours, suggest a minimal scope (MVP) if needed, and output:
   - Your final suggested time tag: [ESTIMATE: number] (e.g., [ESTIMATE: 5.5])
   - The brief complete signal: [BRIEF_COMPLETE: true]`;

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiConfig?.provider || 'gemini',
          apiUrl: aiConfig?.apiUrl,
          apiKey: aiConfig?.apiKey,
          model: aiConfig?.model,
          messages: [
            { role: 'system', content: SYSTEM_ESTIMATE_PROMPT },
            ...updatedHistory
          ]
        })
      }, 60000);

      if (!res.ok) throw new Error("AI request failed");
      const data = await res.json();
      let reply = data.content || "";

      // Extract user's estimate if mentioned
      let calculatedHoursVal = 28.0;
      for (const m of updatedHistory) {
        if (m.role === 'user') {
          const rangeMatch = m.content.match(/(\d+)\s*[-–]\s*(\d+)\s*hour/i);
          if (rangeMatch) {
            const minH = parseFloat(rangeMatch[1]);
            const maxH = parseFloat(rangeMatch[2]);
            calculatedHoursVal = Math.round((minH + maxH) / 2);
            break;
          }
          const singleMatch = m.content.match(/(\d+(\.\d+)?)\s*hour/i);
          if (singleMatch) {
            calculatedHoursVal = parseFloat(singleMatch[1]);
            break;
          }
        }
      }

      const userMsgCount = updatedHistory.filter(m => m.role === 'user').length;
      
      // Parse ESTIMATE tag
      const match = reply.match(/\[ESTIMATE:\s*(\d+(\.\d+)?)\]/);
      let estVal = null;
      if (match) {
        const parsedVal = parseFloat(match[1]);
        if (!isNaN(parsedVal)) {
          estVal = parsedVal;
          setSuggestedEstimate(estVal);
        }
        reply = reply.replace(/\[ESTIMATE:\s*(\d+(\.\d+)?)\]/, '').trim();
      }

      // Parse BRIEF_COMPLETE tag
      if (reply.includes('[BRIEF_COMPLETE: true]')) {
        setHasCompletedAiEstimation(true);
        reply = reply.replace('[BRIEF_COMPLETE: true]', '').trim();
      }

      if (userMsgCount >= 3) {
        setHasCompletedAiEstimation(true);
        const finalEst = estVal !== null ? estVal : calculatedHoursVal;
        setSuggestedEstimate(finalEst);
        setNewHours(finalEst);

        const rangeMin = Math.max(1, Math.round(finalEst * 0.85));
        const rangeMax = Math.round(finalEst * 1.15);

        const t1 = (finalEst * 0.2).toFixed(1);
        const t2 = (finalEst * 0.2).toFixed(1);
        const t3 = (finalEst * 0.25).toFixed(1);
        const t4 = (finalEst * 0.35).toFixed(1);

        const taskTitleLower = (newTitle || "").toLowerCase();
        const criticalPathItems = taskTitleLower.includes("gemini")
          ? ["Gemini AI Refinement", "Voice Companion", "Google Cloud Deployment", "End-to-End Testing"]
          : [`Core ${newTitle || "task"} execution`, "Testing & validation", "Review and polish", "Final submission"];

        reply = `━━━━━━━━━━━━━━━━━━━━━━━━━━
### MISSION ANALYSIS COMPLETE

**Estimated Remaining Work**
# ${rangeMin}–${rangeMax} Hours

**Confidence**
AI Analysis Unavailable

**Complexity**
N/A

**Reasoning**
* AI Core is offline. No risk analysis generated.
* Estimate is based on user-provided scope only.

**Critical Path**
* ${criticalPathItems[0]}
* ${criticalPathItems[1]}
* ${criticalPathItems[2]}
* ${criticalPathItems[3]}

**Recommended Allocation**
* **${criticalPathItems[0]}**: ${t1}h
* **${criticalPathItems[1]}**: ${t2}h
* **${criticalPathItems[2]}**: ${t3}h
* **${criticalPathItems[3]}**: ${t4}h

Your current plan is achievable based on the estimated hours alone. Re-run the AI Summarizer when the AI Core is online for confidence and risk analysis.
━━━━━━━━━━━━━━━━━━━━━━━━━━
[Briefing completed. Add Task button is now unlocked and suggestion applied.]`;
      }

      const newHistory = [
        ...updatedHistory,
        { role: 'assistant' as const, content: reply }
      ];
      setEstChatHistory(newHistory);

      // Decipher behavior and update twin asynchronously
      analyzeBehaviorAndUpdateTwin(newHistory);
    } catch (err: any) {
      console.warn("Estimation assistant API failed, using rule-based fallback:", err);
      toast.error("AI Core offline. Running in local fallback mode.");
      
      let reply = "";
      const userMessageCount = updatedHistory.filter(m => m.role === 'user').length;
      
      if (userMessageCount === 1) {
        reply = "Understood. What is the primary programming language or tool stack you will be utilizing for this task?";
      } else if (userMessageCount === 2) {
        reply = "Got it. Have you implemented similar architectures in the past, or is this your first time?";
      } else {
        reply = "Analyzing timeline metrics...";
      }

      if (userMessageCount >= 3) {
        setHasCompletedAiEstimation(true);
        
        // Find user hour value from history
        let calculatedHoursVal = 28.0;
        for (const m of updatedHistory) {
          if (m.role === 'user') {
            const rangeMatch = m.content.match(/(\d+)\s*[-–]\s*(\d+)\s*hour/i);
            if (rangeMatch) {
              calculatedHoursVal = Math.round((parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2);
              break;
            }
            const singleMatch = m.content.match(/(\d+(\.\d+)?)\s*hour/i);
            if (singleMatch) {
              calculatedHoursVal = parseFloat(singleMatch[1]);
              break;
            }
          }
        }
        
        const finalEst = calculatedHoursVal;
        setSuggestedEstimate(finalEst);
        setNewHours(finalEst);

        const rangeMin = Math.max(1, Math.round(finalEst * 0.85));
        const rangeMax = Math.round(finalEst * 1.15);

        const t1 = (finalEst * 0.2).toFixed(1);
        const t2 = (finalEst * 0.2).toFixed(1);
        const t3 = (finalEst * 0.25).toFixed(1);
        const t4 = (finalEst * 0.35).toFixed(1);

        const taskTitleLower = (newTitle || "").toLowerCase();
        const criticalPathItems = taskTitleLower.includes("gemini")
          ? ["Gemini AI Refinement", "Voice Companion", "Google Cloud Deployment", "End-to-End Testing"]
          : [`Core ${newTitle || "task"} execution`, "Testing & validation", "Review and polish", "Final submission"];

        reply = `━━━━━━━━━━━━━━━━━━━━━━━━━━
### MISSION ANALYSIS COMPLETE

**Estimated Remaining Work**
# ${rangeMin}–${rangeMax} Hours

**Confidence**
AI Analysis Unavailable

**Complexity**
N/A

**Reasoning**
* AI Core is offline. No risk analysis generated.
* Estimate is based on user-provided scope only.

**Critical Path**
* ${criticalPathItems[0]}
* ${criticalPathItems[1]}
* ${criticalPathItems[2]}
* ${criticalPathItems[3]}

**Recommended Allocation**
* **${criticalPathItems[0]}**: ${t1}h
* **${criticalPathItems[1]}**: ${t2}h
* **${criticalPathItems[2]}**: ${t3}h
* **${criticalPathItems[3]}**: ${t4}h

Your current plan is achievable based on the estimated hours alone. Re-run the AI Summarizer when the AI Core is online for confidence and risk analysis.
━━━━━━━━━━━━━━━━━━━━━━━━━━
[Briefing completed. Add Task button is now unlocked and suggestion applied.]`;
      }

      const newHistory = [
        ...updatedHistory,
        { role: 'assistant' as const, content: reply }
      ];
      setEstChatHistory(newHistory);
    } finally {
      setEstChatLoading(false);
    }
  };

  // SVG Sparkline Trend Graph Renderer
  const renderSparkline = (history: number[] | undefined, level: string) => {
    if (!history || history.length < 2) return null;
    const width = 80;
    const height = 24;
    const points = history.map((score, idx) => {
      const x = (idx / (history.length - 1)) * width;
      const y = height - (score / 100) * height;
      return `${x},${y}`;
    }).join(' ');

    const strokeColor = level === 'black' ? "#EF4444" : level === 'red' ? "#F97316" : level === 'orange' ? "#FBBF24" : "#bf5af2";

    return (
      <div className="flex items-center gap-1.5 ml-2 border-l border-white/5 pl-2">
        <span className="text-[7px] text-gray-500 font-mono tracking-tighter block leading-none uppercase">Trend</span>
        <svg width={width} height={height} className="overflow-visible inline-block">
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
          <circle
            cx={width}
            cy={height - (history[history.length - 1] / 100) * height}
            r="3.5"
            fill={strokeColor}
            className="animate-ping"
          />
        </svg>
      </div>
    );
  };

  const getRiskColor = (score: number) => {
    if (score >= 80) return "text-[#66FCF1]";
    if (score >= 60) return "text-[#bf5af2]";
    if (score >= 40) return "text-amber-400";
    if (score >= 20) return "text-orange-500";
    return "text-[#EF4444]";
  };

  const getEscalationBorder = (level: string | undefined) => {
    switch (level) {
      case 'green': return "border-[#66FCF1]/20";
      case 'yellow': return "border-[#bf5af2]/20";
      case 'orange': return "border-amber-400/20";
      case 'red': return "border-orange-500/20";
      case 'black': return "border-[#EF4444]/60 shadow-[0_0_20px_rgba(239,68,68,0.15)] animate-pulse";
      default: return "border-white/[0.08]";
    }
  };

  const getEscalationLabel = (level: string | undefined) => {
    switch (level) {
      case 'green': return "🟢 Stable";
      case 'yellow': return "🟣 Warning";
      case 'orange': return "🟡 Alert";
      case 'red': return "🟠 Critical Alarm";
      case 'black': return "🔴 Deadline Collapse";
      default: return "Synced";
    }
  };

  const getOrbSize = (state: string) => {
    switch (state) {
      case 'offline': return 430;
      case 'idle': return 470;
      case 'listening': return 510;
      case 'speaking': return 550;
      case 'thinking': return 600;
      case 'warning': return 530;
      default: return 470;
    }
  };

  const THEME_MAP: Record<string, {
    primary: string;
    secondary: string;
    glow: string;
    rgb: string;
  }> = {
    offline: { primary: '#EF4444', secondary: '#7F1D1D', glow: 'rgba(239,68,68,0.5)', rgb: '239,68,68' },
    idle: { primary: '#06C6B3', secondary: '#115E59', glow: 'rgba(6,198,179,0.5)', rgb: '6,198,179' },
    listening: { primary: '#0099FF', secondary: '#004F80', glow: 'rgba(0,153,255,0.6)', rgb: '0,153,255' },
    thinking: { primary: '#10B981', secondary: '#064E3B', glow: 'rgba(16,185,129,0.5)', rgb: '16,185,129' },
    speaking: { primary: '#2563EB', secondary: '#1E3A8A', glow: 'rgba(37,99,235,0.7)', rgb: '37,99,235' },
    warning: { primary: '#F59E0B', secondary: '#78350F', glow: 'rgba(245,158,11,0.5)', rgb: '245,158,11' },
  };

  const resolvedState = aiConnectionStatus === 'offline'
    ? 'offline'
    : (orbState === 'offline' ? 'idle' : orbState);

  const currentTheme = THEME_MAP[resolvedState] || { primary: '#8A2BE2', secondary: '#c084fc', glow: 'rgba(138,43,226,0.5)', rgb: '138,43,226' };

  return (
    <>
      {/* Dynamic theme style overrides */}
      <style>{`
        .text-\\[\\#8A2BE2\\] {
          color: ${currentTheme.primary} !important;
        }
        .border-\\[\\#8A2BE2\\]\\/30 {
          border-color: rgba(${currentTheme.rgb}, 0.3) !important;
        }
        .border-\\[\\#8A2BE2\\]\\/40 {
          border-color: rgba(${currentTheme.rgb}, 0.4) !important;
        }
        .border-\\[\\#8A2BE2\\] {
          border-color: ${currentTheme.primary} !important;
        }
        .bg-\\[\\#8A2BE2\\] {
          background-color: ${currentTheme.primary} !important;
        }
        .bg-\\[\\#8A2BE2\\]\\/10 {
          background-color: rgba(${currentTheme.rgb}, 0.1) !important;
        }
        .bg-\\[\\#8A2BE2\\]\\/20 {
          background-color: rgba(${currentTheme.rgb}, 0.2) !important;
        }
        .accent-\\[\\#8A2BE2\\] {
          accent-color: ${currentTheme.primary} !important;
        }
        .shadow-\\[0_0_15px_rgba\\(138\\,43\\,226\\,0\\.35\\)\\] {
          box-shadow: 0 0 15px rgba(${currentTheme.rgb}, 0.35) !important;
        }
        .shadow-\\[0_0_20px_rgba\\(138\\,43\\,226\\,0\\.5\\)\\] {
          box-shadow: 0 0 20px rgba(${currentTheme.rgb}, 0.5) !important;
        }
        .shadow-\\[0_0_25px_rgba\\(138\\,43\\,226\\,0\\.2\\)\\] {
          box-shadow: 0 0 25px rgba(${currentTheme.rgb}, 0.2) !important;
        }
        .shadow-\\[0_8px_32px_0_rgba\\(138\\,43\\,226\\,0\\.15\\)\\] {
          box-shadow: 0 8px 32px 0 rgba(${currentTheme.rgb}, 0.15) !important;
        }
        .from-\\[\\#8A2BE2\\] {
          --tw-gradient-from: ${currentTheme.primary} !important;
          --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgba(${currentTheme.rgb}, 0)) !important;
        }
        .to-\\[\\#c084fc\\] {
          --tw-gradient-to: ${currentTheme.secondary} !important;
        }
        .text-purple-300 {
          color: ${currentTheme.primary === '#8A2BE2' ? '#d8b4fe' : currentTheme.primary} !important;
        }
        .text-purple-200 {
          color: ${currentTheme.primary === '#8A2BE2' ? '#e9d5ff' : currentTheme.primary} !important;
        }
        .text-\\[\\#66FCF1\\] {
          color: ${resolvedState === 'offline' ? '#EF4444' : resolvedState === 'thinking' ? '#10B981' : '#66FCF1'} !important;
        }
        .shadow-\\[0_0_25px_rgba\\(138\\,43\\,226\\,0\\.15\\)\\] {
          box-shadow: 0 0 25px rgba(${currentTheme.rgb}, 0.15) !important;
        }
        .hover\\:border-\\[\\#8A2BE2\\]\\/40:hover {
          border-color: rgba(${currentTheme.rgb}, 0.4) !important;
        }
        .hover\\:border-\\[\\#8A2BE2\\]\\/20:hover {
          border-color: rgba(${currentTheme.rgb}, 0.2) !important;
        }
        .focus\\:ring-\\[\\#8A2BE2\\]:focus {
          --tw-ring-color: ${currentTheme.primary} !important;
        }
        .focus\\:border-\\[\\#8A2BE2\\]\\/40:focus {
          border-color: rgba(${currentTheme.rgb}, 0.4) !important;
        }
        .focus\\:ring-\\[\\#8A2BE2\\]\\/30:focus {
          --tw-ring-color: rgba(${currentTheme.rgb}, 0.3) !important;
        }
        .border-t-transparent {
          border-top-color: transparent !important;
        }
        .border-b-transparent {
          border-bottom-color: transparent !important;
        }
        .border-r-transparent {
          border-right-color: transparent !important;
        }
        .border-l-transparent {
          border-left-color: transparent !important;
        }
        @keyframes scannerSweep {
          0% { left: -100%; }
          100% { left: 150%; }
        }
      `}</style>
      
      {/* Floating stardust background (Fixed viewport outside transition wrapper) */}
      <ParticleBackground theme="dashboard" state={resolvedState} />

      {/* Floating Settings gear button at top-right of the dashboard page */}
      <div 
        className="fixed top-6 right-6 z-40 flex items-center gap-3 transition-all duration-500 ease-out"
      >
        <SettingsGear
          isOffline={aiConnectionStatus === 'offline'}
          onClick={() => setOpenSettings(!openSettings)}
        />
      </div>

      <div 
        className={`min-h-screen text-gray-100 relative overflow-x-hidden flex flex-col font-sans select-none transition-all duration-500 ease-in-out ${
          isTransitioning 
            ? 'opacity-0 scale-[0.98] blur-[2px]' 
            : 'opacity-100 scale-100 blur-0'
        }`}
        style={{ backgroundColor: 'transparent' }}
      >

      {/* Header bar with Centered Title */}
      <header className="grid grid-cols-3 h-20 items-center pl-6 pr-16 bg-transparent border-b border-gray-900/40 sticky top-0 z-20 backdrop-blur-md">
        {/* Left side: status / navigate & view toggle */}
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-[#8A2BE2] animate-ping" />
          <span 
            className="text-[9px] font-mono tracking-widest uppercase text-gray-500 hover:text-gray-300 cursor-pointer transition-colors" 
            onClick={() => navigateTo('/')}
          >
            ← Portal
          </span>
          
          {/* View Toggle */}
          <div className="ml-3 flex items-center bg-black/40 border border-white/10 rounded-xl p-0.5 text-[9px] font-mono tracking-wider shadow-[0_0_15px_rgba(138,43,226,0.15)] z-20">
            <button
              onClick={() => setCurrentView('mission-control')}
              className={`px-3 py-1 rounded-lg transition-all font-bold uppercase cursor-pointer select-none ${currentView === 'mission-control' ? 'bg-[#8A2BE2]/80 text-white shadow-[0_0_10px_rgba(138,43,226,0.25)]' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Control
            </button>
            <button
              onClick={() => setCurrentView('calendar-debrief')}
              className={`px-3 py-1 rounded-lg transition-all font-bold uppercase cursor-pointer select-none ${currentView === 'calendar-debrief' ? 'bg-[#8A2BE2]/80 text-white shadow-[0_0_10px_rgba(138,43,226,0.25)]' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Debrief
            </button>
          </div>
        </div>

        {/* Center: Title Centered on Top */}
        <h1 
          className="text-center text-lg md:text-xl font-black tracking-[0.25em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-[#8A2BE2] to-[#c084fc]"
          style={{ textShadow: '0 0 15px rgba(138,43,226,0.25)' }}
        >
          Chronos Mission Control
        </h1>

        {/* Right side: Add Task */}
        <div className="flex items-center justify-end gap-3">
          <button 
            onClick={() => setOpenAdd(true)} 
            className="px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider bg-[#8A2BE2] hover:opacity-90 text-white transition-all cursor-pointer shadow-[0_0_15px_rgba(138,43,226,0.35)] hover:shadow-[0_0_20px_rgba(138,43,226,0.5)]"
          >
            + Add Task
          </button>
        </div>
      </header>

      {/* Main dashboard content */}
      {currentView === 'calendar-debrief' ? (
        <main className="flex-1 p-6 relative z-10 w-full max-w-full lg:px-8 space-y-6 flex flex-col font-sans animate-in fade-in duration-300">
          {/* STATS ROW */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl p-4">
              <div className="text-gray-500 text-[8px] font-mono uppercase tracking-widest">Temporal Debt</div>
              <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-amber-500 font-mono mt-1">{totalActiveHours.toFixed(1)} Hours</div>
              <div className="text-[8px] text-gray-400 font-mono uppercase tracking-wider mt-0.5">Overdue: {overdueHours.toFixed(1)} hours</div>
            </Card>
            <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl p-4">
              <div className="text-gray-500 text-[8px] font-mono uppercase tracking-widest">Burnout Projection</div>
              <div className="text-2xl font-black text-red-500 font-mono mt-1">{burnoutRisk}% RISK</div>
              <div className="text-[8px] text-gray-400 font-mono uppercase tracking-wider mt-0.5">{activeTasks.length} active timelines under execution</div>
            </Card>
            <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl p-4">
              <div className="text-gray-500 text-[8px] font-mono uppercase tracking-widest">Discounted Sleep Hours</div>
              <div className="text-2xl font-black text-[#c084fc] font-mono mt-1">
                {Math.abs((sleepEnd - sleepStart + 24) % 24)} Hours/Day
              </div>
              <div className="text-[8px] text-gray-400 font-mono uppercase tracking-wider mt-0.5">
                Excluded: {sleepStart}:00 - {sleepEnd}:00
              </div>
            </Card>
            <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl p-4">
              <div className="text-gray-500 text-[8px] font-mono uppercase tracking-widest">Stabilized Singularity</div>
              <div className="text-2xl font-black text-[#06C6B3] font-mono mt-1">{completionIndex}% INDEX</div>
              <div className="text-[8px] text-gray-400 font-mono uppercase tracking-wider mt-0.5">{completedTasksCount} of {totalTasksCount} tasks secured</div>
            </Card>
          </div>

          {/* MAIN CALENDAR AND ADVISORY CONTENT */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
            <Card className="lg:col-span-7 bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl p-5 hover:border-white/10 transition-all duration-300">
              {(() => {
                const today = new Date();
                
                const daysInMonth = new Date(activeCalYear, activeCalMonth + 1, 0).getDate();
                const firstDayIndex = new Date(activeCalYear, activeCalMonth, 1).getDay();
                
                const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                const monthNames = [
                  "January", "February", "March", "April", "May", "June", 
                  "July", "August", "September", "October", "November", "December"
                ];
                
                const dayElements = [];
                
                for (let i = 0; i < firstDayIndex; i++) {
                  dayElements.push(<div key={`pad-${i}`} className="p-2 border border-white/[0.03] bg-black/10 rounded-xl min-h-[70px] opacity-20" />);
                }
                
                for (let d = 1; d <= daysInMonth; d++) {
                  const currentDate = new Date(activeCalYear, activeCalMonth, d, 0, 0, 0);
                  const midCurrentDate = new Date(activeCalYear, activeCalMonth, d, 23, 59, 59);
                  
                  const isToday = d === today.getDate() && activeCalMonth === today.getMonth() && activeCalYear === today.getFullYear();
                  const isPast = midCurrentDate.getTime() < today.getTime() && !isToday;
                  
                  const tasksOnDay = tasks.filter(t => {
                    const taskDate = new Date(t.due);
                    return (
                      taskDate.getDate() === d &&
                      taskDate.getMonth() === activeCalMonth &&
                      taskDate.getFullYear() === activeCalYear
                    );
                  });
                  
                  const hasSleepOverlap = tasksOnDay.some(t => {
                    if (t.completed) return false;
                    const dueHour = new Date(t.due).getHours();
                    const sleepHoursList: number[] = [];
                    let curr = sleepStart;
                    while (curr !== sleepEnd) {
                      sleepHoursList.push(curr);
                      curr = (curr + 1) % 24;
                    }
                    return sleepHoursList.includes(dueHour);
                  });
                  
                  // Check-off details
                  const isEmptyPast = isPast && tasksOnDay.length === 0;
                  const isClickablePast = isPast && tasksOnDay.length > 0;
                  
                  dayElements.push(
                    <div 
                      key={`day-${d}`} 
                      onClick={() => {
                        if (!isPast) {
                          handleOpenAddTaskWithDate(new Date(activeCalYear, activeCalMonth, d));
                        } else if (isClickablePast) {
                          setExplainTaskId(tasksOnDay[0].id);
                          toast.info(`Viewing archived details for: ${tasksOnDay[0].title}`);
                        }
                      }}
                      className={`p-2 border rounded-xl min-h-[70px] flex flex-col justify-between transition-all relative select-none ${
                        isToday 
                          ? 'border-[#8A2BE2] bg-[#8A2BE2]/5 shadow-[0_0_10px_rgba(138,43,226,0.15)] cursor-pointer' 
                          : isEmptyPast
                            ? 'border-white/[0.02] bg-black/40 opacity-20 pointer-events-none cursor-default'
                            : isClickablePast
                              ? 'border-green-500/20 bg-green-950/5 hover:border-green-500/40 cursor-pointer opacity-70'
                              : 'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] cursor-pointer hover:border-[#8A2BE2]/40'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className={`text-[10px] font-mono font-bold ${isToday ? 'text-white' : 'text-gray-500'}`}>{d}</span>
                        {hasSleepOverlap && (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse animate-duration-1000" title="Sleep hour conflict detected!" />
                        )}
                        {isEmptyPast && (
                          <span className="text-[8px] font-mono font-bold text-green-500/60" title="Date secure (no tasks)">✓</span>
                        )}
                      </div>
                      
                      <div className="space-y-1 mt-1">
                        {tasksOnDay.map((t, idx) => (
                          <div 
                            key={idx}
                            className={`text-[8px] px-1 py-0.5 rounded truncate font-sans font-semibold uppercase tracking-wider ${
                              t.completed
                                ? 'bg-green-950/30 border border-green-500/20 text-green-400 line-through'
                                : t.escalationLevel === 'red' || t.escalationLevel === 'black'
                                  ? 'bg-red-950/40 border border-red-500/30 text-red-300'
                                  : t.escalationLevel === 'orange' || t.escalationLevel === 'yellow'
                                    ? 'bg-amber-950/40 border border-amber-500/30 text-amber-300'
                                    : 'bg-green-950/40 border border-green-500/30 text-green-300'
                            }`}
                            title={`${t.title} (${t.survivalScore}% survival)`}
                          >
                            {t.completed ? '✓ ' : ''}{t.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                
                return (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handlePrevMonth}
                          className="px-2.5 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-[10px] cursor-pointer font-bold select-none text-gray-400 hover:text-white transition-all font-mono"
                        >
                          ◀
                        </button>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-[#06C6B3] font-mono mx-1.5 select-none">
                          {monthNames[activeCalMonth]} {activeCalYear}
                        </h3>
                        <button
                          type="button"
                          onClick={handleNextMonth}
                          className="px-2.5 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-[10px] cursor-pointer font-bold select-none text-gray-400 hover:text-white transition-all font-mono"
                        >
                          ▶
                        </button>
                      </div>
                      <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">
                        Temporal Mapping active
                      </span>
                    </div>
                    <div className="grid grid-cols-7 gap-1.5 text-center text-[8px] font-mono uppercase text-gray-500 font-bold mb-1">
                      {dayNames.map(name => <div key={name}>{name}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {dayElements}
                    </div>
                  </div>
                );
              })()}
            </Card>
 
            <Card className="lg:col-span-5 bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl p-5 hover:border-white/10 transition-all duration-300 flex flex-col justify-between h-full min-h-[500px]">
              <div className="space-y-4 flex-1 flex flex-col">
                <div className="pb-2 border-b border-white/5 flex justify-between items-center flex-shrink-0">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#8A2BE2] font-mono">
                    🧠 Chronos Tactical Advisory
                  </h3>
                  <span className="h-2 w-2 rounded-full bg-[#8A2BE2] animate-pulse" />
                </div>
                
                <div className="text-xs font-mono leading-relaxed text-gray-400 overflow-y-auto max-h-[550px] pr-2 space-y-3 flex-1">
                  {calendarAnalysisLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-3 text-center">
                      <span className="text-2xl animate-spin">🌀</span>
                      <p className="text-[10px] text-purple-400 uppercase tracking-widest font-bold">Chronos is calculating timeline paths...</p>
                    </div>
                  ) : calendarAnalysis ? (
                    <div className="select-text space-y-2">{renderFormattedText(calendarAnalysis)}</div>
                  ) : (
                    <div className="py-20 text-center text-gray-500 uppercase tracking-wider text-[10px]">
                      No active advisory loaded. Click the button below to generate a deep tactical analysis of your calendar schedule.
                    </div>
                  )}
                </div>
              </div>
 
              <button
                type="button"
                onClick={handleGenerateCalendarAnalysis}
                disabled={calendarAnalysisLoading}
                className="mt-4 w-full py-3 rounded-xl font-bold font-mono text-[10px] uppercase tracking-wider transition-all duration-300 bg-[#8A2BE2] text-white hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-[0_0_15px_rgba(138,43,226,0.3)]"
              >
                {calendarAnalysisLoading ? "Analyzing..." : calendarAnalysis ? "🔄 Re-run Tactical Analysis" : "⚡ Generate Debrief Analysis"}
              </button>
            </Card>
          </div>
        </main>
      ) : (
        <main className="flex-1 p-6 relative z-10 w-full max-w-full lg:px-8">
          {aiConnectionStatus === 'offline' && (
            <div className="mb-4 flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <span className="text-amber-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                ⚠ AI unavailable — Local dashboard remains operational
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Left Side: Twin Core & AI Config (Centered constants) */}
        <section className="lg:col-span-3 space-y-6 w-full flex flex-col justify-start">
          {/* AI Settings Info (Constants Container) */}
          <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl hover:border-white/15 transition-all duration-300">
            <CardHeader className="pb-3 border-b border-white/5 text-center">
              <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-[#66FCF1]">
                ⚙️ Supplier Constants
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 font-mono text-[9px] text-gray-400 space-y-4 uppercase tracking-wide flex flex-col items-center justify-center text-center">
              <div className="space-y-0.5">
                <span className="text-gray-600 block text-[8px] tracking-wider">Operator Name</span>
                <span className="text-white font-bold text-[11px] block">{username}</span>
              </div>
              <div className="space-y-0.5">
                <span className="text-gray-600 block text-[8px] tracking-wider">Core Provider</span>
                <span className="text-[#c084fc] font-bold text-[11px] block">{aiConfig?.provider || 'Gemini'}</span>
              </div>
              <div className="space-y-0.5">
                <span className="text-gray-600 block text-[8px] tracking-wider">Active Engine</span>
                <span className="text-[#8A2BE2] font-bold text-[10px] block max-w-[220px] truncate">{aiConfig?.model || 'gemini-1.5-flash'}</span>
              </div>
              <div className="space-y-0.5">
                <span className="text-gray-600 block text-[8px] tracking-wider">Endpoint Address</span>
                <span className="text-gray-500 block text-[8px] max-w-[240px] truncate">{aiConfig?.apiUrl || 'https://generativelanguage.googleapis.com/v1beta'}</span>
              </div>
              <div className="space-y-0.5">
                <span className="text-gray-600 block text-[8px] tracking-wider">System State</span>
                {aiConnectionStatus === 'online' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[8px] font-mono font-bold tracking-widest uppercase border bg-green-950/30 border-green-800/50 text-green-400 inline-block mt-1 shadow-[0_0_10px_rgba(34,197,94,0.1)]">
                    🟢 Core Synced
                  </span>
                ) : aiConnectionStatus === 'offline' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[8px] font-mono font-bold tracking-widest uppercase border bg-red-950/30 border-red-800/50 text-red-400 inline-block mt-1 shadow-[0_0_10px_rgba(239,68,68,0.15)] animate-pulse">
                    🔴 Core Offline
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[8px] font-mono font-bold tracking-widest uppercase border bg-yellow-950/30 border-yellow-800/50 text-yellow-400 inline-block mt-1 shadow-[0_0_10px_rgba(234,179,8,0.15)]">
                    🟡 Checking...
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Twin's Personality (Brief of what it knows about you) */}
          <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-2xl hover:border-white/15 transition-all duration-300">
            <CardHeader className="pb-3 border-b border-white/5 text-center">
              <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-[#8A2BE2]">
                🧠 Twin's Personality
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5 flex flex-col items-center justify-center text-center space-y-3">
              <span className="text-[8px] text-gray-600 font-mono uppercase tracking-widest block pb-1">Cognitive State Signature</span>
              {renderPersonalityBrief(performanceTwin)}
            </CardContent>
          </Card>

          {/* Clickable Twin Profile Card Button */}
          <Card 
            onClick={() => setOpenTwinModal(true)}
            className="bg-black/20 border border-white/[0.08] hover:border-[#8A2BE2]/40 text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] hover:shadow-[0_0_25px_rgba(138,43,226,0.2)] hover:scale-[1.02] cursor-pointer transition-all duration-300 backdrop-blur-xl rounded-2xl flex flex-col items-center justify-center p-6 text-center group"
          >
            <div className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-300 select-none">👤</div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#8A2BE2] group-hover:text-[#c084fc] transition-colors">
              Twin Profile
            </h3>
            <p className="text-[8px] text-gray-500 font-mono mt-1.5 uppercase tracking-widest">
              Click to open behavior summary
            </p>
          </Card>
        </section>

        {/* Middle Side: Chronos Voice Assistant Temporal Anomaly (Transparent and Centered) */}
        <section className="lg:col-span-6 flex flex-col items-center justify-center space-y-6 w-full min-h-[500px] relative">
          {activeRecoveryTaskId && recoveryCountdown && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 bg-black/60 border border-[#66FCF1]/40 rounded-full px-5 py-2 backdrop-blur-md shadow-[0_0_20px_rgba(102,252,241,0.25)]">
              <span className="text-[8px] font-mono tracking-widest uppercase text-gray-400">RECOVERY COUNTDOWN</span>
              <span className="text-xs font-black font-mono text-[#66FCF1] tracking-wider">{recoveryCountdown}</span>
            </div>
          )}
          <div 
            id="chronos-singularity-core"
            className="relative flex items-center justify-center w-full h-[580px] z-10"
          >
            <ChronosCanvas 
              state={resolvedState} 
              size={360} 
              theme="dashboard"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 mx-auto" 
            />
            {/* Interactive speech status and microphone button overlay */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
              <span className="text-[10px] font-mono tracking-wider text-gray-400 uppercase bg-black/40 px-3 py-1 rounded-full border border-white/5 backdrop-blur-md">
                {resolvedState === 'offline' ? (
                  <span className="text-red-400 font-semibold animate-pulse">● System Sync Fallback Active</span>
                ) : resolvedState === 'listening' ? (
                  <span className="text-[#0099FF] animate-pulse">● Listening... Speak Command</span>
                ) : resolvedState === 'thinking' ? (
                  <span className="text-emerald-400 animate-pulse">● Parsing Telemetry...</span>
                ) : resolvedState === 'speaking' ? (
                  <span className="text-blue-400 animate-pulse">● Speaking Response</span>
                ) : (
                  <span className="text-[#66FCF1]">● Proactive Assistant Active</span>
                )}
              </span>
              
              {/* Fallback voice recording button — only shown when AI is online */}
              {aiConnectionStatus === 'online' && resolvedState !== 'offline' && (
                <button
                  type="button"
                  onClick={startBrowserRecognition}
                  disabled={isBrowserListening}
                  className={`px-4 py-2 text-[10px] font-mono font-bold tracking-wider rounded-xl border uppercase transition-all shadow-[0_0_15px_rgba(102,252,241,0.15)] cursor-pointer ${
                    isBrowserListening
                      ? 'bg-red-500/20 border-red-500 text-red-300 animate-pulse'
                      : 'bg-black/60 border-[#66FCF1]/40 text-[#66FCF1] hover:bg-[#66FCF1]/10 hover:border-[#66FCF1] hover:shadow-[0_0_20px_rgba(102,252,241,0.35)]'
                  }`}
                >
                  {isBrowserListening ? "🔴 Recording Voice..." : "🎙️ Talk to Chronos"}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right Side: Task Survival Center or Recovery Command Center */}
        {activeRecoveryTaskId ? (
          <section className="lg:col-span-3 flex flex-col w-full h-[calc(100vh-140px)] min-h-[500px]">
            <RecoveryCommandCenter taskId={activeRecoveryTaskId} />
          </section>
        ) : (
          <section className="lg:col-span-3 flex flex-col w-full h-[calc(100vh-140px)] min-h-[500px]">
            <div className="flex items-center justify-between pb-3 border-b border-gray-900/60 mb-4 flex-shrink-0">
              <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Active Temporal Defense Targets
              </h2>
              <span className="text-[10px] font-mono text-gray-600">
                Total Defended: {tasks.length}
              </span>
            </div>

            {tasksLoading ? (
              tasksLoadingSlow ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0B0C10]/60 border border-gray-900/40 rounded-3xl backdrop-blur-sm space-y-4">
                  <div className="w-full max-w-md space-y-3 animate-pulse">
                    <div className="h-14 bg-white/5 rounded-xl" />
                    <div className="h-14 bg-white/5 rounded-xl" />
                    <div className="h-14 bg-white/5 rounded-xl w-3/4" />
                  </div>
                  <p className="text-[9px] font-mono text-gray-500 uppercase tracking-wider">
                    Loading mission data...
                  </p>
                </div>
              ) : null
            ) : tasksError ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#0B0C10]/60 border border-red-900/30 rounded-3xl backdrop-blur-sm space-y-4">
                <span className="text-2xl">⚠️</span>
                <p className="text-xs text-red-400 uppercase tracking-widest font-bold">
                  Mission Data Unavailable
                </p>
                <p className="text-[9px] font-mono text-gray-500 max-w-xs">
                  {tasksError}
                </p>
                <button
                  type="button"
                  onClick={fetchTasks}
                  className="px-4 py-2 rounded-xl bg-[#8A2BE2]/20 border border-[#8A2BE2]/40 text-purple-300 font-mono text-[9px] uppercase tracking-wider hover:bg-[#8A2BE2]/30 transition-all cursor-pointer"
                >
                  Retry Load
                </button>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#0B0C10]/60 border border-dashed border-gray-800 rounded-3xl backdrop-blur-sm space-y-3">
                <span className="text-3xl">🛡️</span>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">
                  No Active Missions
                </p>
                <p className="text-[9px] font-mono text-gray-600 max-w-xs">
                  Tasks you create will appear here. Use Chronos to plan and defend your time.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                {tasks.map(task => {
                  const score = task.survivalScore ?? 100;
                  const escalation = task.escalationLevel ?? 'green';
                  const isCritical = escalation === 'black' || escalation === 'red';
                  const hoursLeft = task.due
                    ? Math.max(0, Math.round((new Date(task.due).getTime() - Date.now()) / 3600000))
                    : 0;

                  let isLockedIntake = false;
                  if (task.category) {
                    try {
                      const cat = JSON.parse(task.category);
                      if (cat && cat.locked_intake) {
                        isLockedIntake = true;
                      }
                    } catch (e) {}
                  }

                  return (
                    <Card 
                      key={task.id} 
                      className={`bg-black/25 border ${getEscalationBorder(escalation)} text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] hover:shadow-[0_0_25px_rgba(138,43,226,0.15)] hover:border-[#8A2BE2]/30 transition-all duration-300 backdrop-blur-xl relative rounded-3xl overflow-hidden`}
                    >
                      <CardHeader className="pb-3 border-b border-white/5 flex flex-row items-center justify-between space-y-0">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2.5">
                            <CardTitle className="text-xs font-bold text-gray-200 tracking-wide">
                              {task.title}
                            </CardTitle>
                            {isLockedIntake && (
                              <Badge className="bg-red-500/20 text-red-400 border border-red-500/30 text-[8px] uppercase font-mono tracking-widest animate-pulse">
                                🔒 Locked
                              </Badge>
                            )}
                            <Badge className={`text-[8px] uppercase tracking-wider font-extrabold ${
                              escalation === 'black' ? "bg-red-950/40 text-red-400 border border-red-500/40 animate-pulse"
                              : escalation === 'red' ? "bg-orange-950/40 text-orange-400 border border-orange-500/40"
                              : escalation === 'orange' ? "bg-amber-950/40 text-amber-400 border border-amber-500/40"
                              : escalation === 'yellow' ? "bg-purple-950/40 text-purple-400 border border-purple-500/40"
                              : "bg-[#06C6B3]/10 text-[#66FCF1] border border-[#06C6B3]/30"
                            }`}>
                              {getEscalationLabel(escalation)}
                            </Badge>
                          </div>
                          <span className="text-[9px] font-mono text-gray-500 uppercase tracking-wider block ml-0">
                            Due: {new Date(task.due).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} · {hoursLeft > 0 ? `${hoursLeft}h remaining` : 'PAST DUE'}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {isLockedIntake ? (
                            <span className="px-2.5 py-1 text-[8px] font-bold uppercase tracking-wider rounded-xl bg-red-950/20 border border-red-500/20 text-red-400 font-mono">
                              🔒 Intake Required
                            </span>
                          ) : task.completed ? (
                            <button
                              onClick={() => handleToggleComplete(task)}
                              className="px-2.5 py-1 rounded-xl text-[9px] font-bold uppercase tracking-wider border cursor-pointer transition-all bg-green-950/40 border-green-500 text-green-400 hover:bg-green-900/30"
                            >
                              ✓ Secured
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleComplete(task)}
                              className="px-2.5 py-1 rounded-xl text-[9px] font-bold uppercase tracking-wider border cursor-pointer transition-all bg-green-500 hover:bg-green-600 border-green-400 text-black shadow-[0_0_12px_rgba(34,197,94,0.3)] animate-pulse"
                            >
                              Secure
                            </button>
                          )}
                          <button 
                            onClick={() => deleteTask(task.id)}
                            className="text-gray-600 hover:text-red-400 transition-colors text-xs font-semibold focus:outline-none ml-2"
                            title="Dismiss Task"
                          >
                            ✕
                          </button>
                        </div>
                      </CardHeader>
                      
                      <CardContent className="pt-4 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="flex gap-2">
                            <Badge className="bg-[#1F2833]/85 text-xs text-gray-400 border border-gray-800 tracking-wider">
                              {task.estimatedHours}h est. work hours
                            </Badge>
                            <Badge className={`text-xs uppercase tracking-wider font-bold ${
                              task.importance === "high" 
                                ? "bg-red-950/40 text-red-400 border border-red-900/40" 
                                : task.importance === "medium"
                                  ? "bg-yellow-950/40 text-yellow-400 border border-yellow-900/40"
                                  : "bg-gray-850/40 text-gray-400 border border-gray-800"
                            }`}>
                              {task.importance}
                            </Badge>
                          </div>

                          {/* Point Of No Return display */}
                          {!task.completed && (
                            <div className="text-[9px] font-mono tracking-widest uppercase flex items-center gap-1 bg-black/40 px-3 py-1 rounded-full border border-white/5">
                              <span className="text-gray-600">No Return:</span>
                              <span className={isCritical ? "text-[#EF4444] font-bold animate-pulse" : "text-[#bf5af2]"}>
                                {task.pointOfNoReturn}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Survival Score Meter */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-mono">
                            <div className="flex items-center">
                              <span className="text-gray-500 uppercase tracking-widest text-[9px]">Survival Probability:</span>
                              <span className={`font-bold ml-1.5 ${getRiskColor(score)}`}>{score}%</span>
                              {renderSparkline(task.scoreHistory, escalation)}
                            </div>
                          </div>
                          <div className="w-full bg-gray-900 h-2 rounded-full overflow-hidden border border-gray-850">
                            <div 
                              className={`h-full transition-all duration-500 ${
                                score >= 80 
                                  ? "bg-[#66FCF1]" 
                                  : score >= 60 
                                    ? "bg-[#bf5af2]" 
                                    : score >= 40
                                      ? "bg-amber-400"
                                      : score >= 20
                                        ? "bg-orange-500"
                                        : "bg-[#EF4444] animate-pulse"
                              }`}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                        </div>

                        {isLockedIntake ? (
                          <div className="bg-red-950/20 border border-red-500/20 rounded-2xl p-4 text-center space-y-3 mt-4">
                            <div className="text-xl">🔒</div>
                            <p className="text-[10px] font-mono uppercase tracking-widest text-red-400 font-bold">Locked Target (Pending Intake)</p>
                            <p className="text-[10px] text-gray-400 font-sans leading-relaxed">
                              This event was synchronized from Google Calendar. Before Chronos can defend this target, we must capture details about the milestones and priority.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setBriefingTaskId(task.id);
                                setNewTitle(task.title);
                                setNewDue(task.due ? new Date(task.due).toISOString().slice(0, 16) : "");
                                setNewHours(task.estimatedHours ?? 2);
                                setNewImportance(task.importance || "medium");
                                setShowEstimationAssistant(true);
                                setOpenAdd(true); // Open the intake briefing modal
                                setEstChatHistory([
                                  { role: 'assistant', content: `Welcome operator. I see you synced the event "${task.title}". Let's start the briefing process. What is the actual deadline target, and how many hours of focused work do you estimate?` }
                                ]);
                              }}
                              className="w-full py-2.5 bg-gradient-to-r from-red-500 to-orange-500 text-white font-bold text-[10px] font-mono uppercase tracking-wider rounded-xl hover:opacity-90 transition-all cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                            >
                              🔓 Commence AI Intake Briefing
                            </button>
                          </div>
                        ) : (
                          <>
                            {/* Deadline Collapse Warning Alert */}
                            {task.deadlineCollapse && (
                              <div className="text-[10px] text-[#EF4444] bg-[#EF4444]/5 border border-[#EF4444]/20 p-3 rounded-2xl flex items-center justify-between uppercase font-mono tracking-widest animate-pulse">
                                <div className="flex items-center gap-1.5">
                                  <span>⚠️</span>
                                  <span>DEADLINE COLLAPSE DETECTED</span>
                                </div>
                                <span className="text-[8px] bg-red-950/60 border border-red-500/30 px-2 py-0.5 rounded text-red-300">
                                  Emergency Active
                                </span>
                              </div>
                            )}

                            {/* Mission Timeline - Milestone Stages */}
                            {task.timeline && task.timeline.length > 0 && (
                              <div className="bg-black/30 border border-white/5 rounded-2xl p-4 space-y-2.5">
                                <div className="text-[9px] font-mono tracking-widest text-gray-500 uppercase pb-1 border-b border-white/5 flex items-center justify-between">
                                  <span>Timeline Milestones</span>
                                  <span className="text-[8px] text-[#bf5af2] font-semibold">Twin Peaks Synced</span>
                                </div>
                                <div className="space-y-2">
                                  {task.timeline.map((mile, mIdx) => (
                                    <div
                                      key={mile.id}
                                      className="flex items-start gap-2.5 text-xs w-full text-left rounded-xl px-1 py-0.5"
                                    >
                                      <div className="flex flex-col items-center mt-1">
                                        <div className={`h-2.5 w-2.5 rounded-full border transition-all ${
                                          mile.status === 'completed'
                                            ? 'bg-green-500 border-green-500'
                                            : 'bg-transparent border-gray-600'
                                        }`} />
                                        {mIdx < task.timeline!.length - 1 && (
                                          <div className="w-[1px] bg-gray-800 h-6 -my-0.5" />
                                        )}
                                      </div>
                                      <div className="flex-1 font-mono text-[10px]">
                                        <span className="text-gray-300 transition-colors">{mile.title}</span>
                                        <span className="text-gray-600 block text-[9px] transition-colors">{mile.scheduledTime}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="pt-2 border-t border-white/5">
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/dashboard/timeline?taskId=${task.id}`)}
                                    className="w-full py-2 bg-[#8A2BE2]/10 hover:bg-[#8A2BE2]/20 border border-[#8A2BE2]/30 hover:border-[#8A2BE2]/50 text-[#c084fc] hover:text-white rounded-xl text-[10px] font-bold font-mono uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
                                  >
                                    🗺️ View Interactive Temporal Branches
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Reasoning and Agent Activity Logs */}
                            {task.riskAnalysis && (
                              <div className="space-y-3 font-mono text-[9px] text-gray-500 bg-black/20 border border-white/5 rounded-2xl p-4">
                                <button
                                  onClick={() => setExplainTaskId(explainTaskId === task.id ? null : task.id)}
                                  className="w-full flex items-center justify-between text-left text-gray-400 hover:text-white uppercase tracking-wider font-bold focus:outline-none"
                                >
                                  <span>🤖 Cognitive Observations & logs</span>
                                  <span>{explainTaskId === task.id ? "▲ Hide" : "▼ Show"}</span>
                                </button>
                                
                                {explainTaskId === task.id && (
                                  <div className="pt-2.5 border-t border-white/5 space-y-4">
                                    {/* Chronos Predictive Failure Simulator */}
                                    <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-2xl p-4 space-y-2">
                                      <div className="flex justify-between items-center pb-1 border-b border-[#EF4444]/10">
                                        <span className="text-[9px] font-bold text-[#EF4444] uppercase tracking-widest font-mono">
                                          🔮 Chronos Predictive Failure Simulator
                                        </span>
                                        <span className="px-2 py-0.5 rounded bg-[#EF4444]/10 border border-[#EF4444]/35 text-[#EF4444] text-[8px] font-bold font-mono">
                                          {100 - (task.survivalScore ?? 80)}% FAILURE PROBABILITY
                                        </span>
                                      </div>
                                      <div className="space-y-1.5 font-mono text-[9px] text-gray-300">
                                        <div className="text-gray-500 uppercase tracking-widest text-[8px]">Primary Collapse Causes:</div>
                                        <ul className="list-disc list-inside space-y-1 pl-1 text-gray-400">
                                          {getDynamicFailureCauses(task)}
                                        </ul>
                                        {task.survivalScore && task.survivalScore < 50 ? (
                                          <div className="pt-1.5 text-amber-400 text-[8px] font-bold uppercase tracking-widest animate-pulse">
                                            ⚠️ Recommended Intervention Initiated: Chronos Autonomous Override Enabled.
                                          </div>
                                        ) : (
                                          <div className="pt-1.5 text-green-400 text-[8px] font-bold uppercase tracking-widest">
                                            ✓ Timeline Defended: No active critical intervention required.
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {task.riskAnalysis && (
                                      <div className="space-y-0.5">
                                        <span className="text-amber-400 block text-[8px] tracking-wider uppercase font-bold">Risk Reasoning Matrix</span>
                                        {task.riskAnalysis.cognitiveObservationsList && task.riskAnalysis.cognitiveObservationsList.length > 0 ? (
                                          task.riskAnalysis.cognitiveObservationsList.map((obs: string, obsIdx: number) => (
                                            <div key={obsIdx} className="text-gray-300 font-light">• {obs}</div>
                                          ))
                                        ) : (
                                          <>
                                            <div>• Effort Required: {task.riskAnalysis.workRemaining}h</div>
                                            <div>• Clock Remaining: {task.riskAnalysis.timeRemaining}h</div>
                                            <div>• Digital Twin Procrastination Penalty: -{task.riskAnalysis.twinProcrastinationFactor}%</div>
                                            {task.riskAnalysis.historyPenalty > 0 && (
                                              <div className="text-red-400">• Procrastination History Penalty: -{task.riskAnalysis.historyPenalty}%</div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}
                                    
                                    <span className="text-gray-600 block text-[8px] uppercase tracking-wider font-bold">Operational Events Log</span>
                                    {task.events?.slice().reverse().map((ev, evIdx) => {
                                      const isIntervention = ev.type === 'intervention';
                                      return (
                                        <div key={evIdx} className="space-y-1 border-l border-white/5 pl-2 my-2 py-0.5">
                                          <div className="flex justify-between items-center text-gray-500 text-[8px]">
                                            <span className="text-[#bf5af2] font-semibold">{ev.agent || 'Chronos Executive Advisor'}</span>
                                            <span>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                          </div>
                                          {isIntervention ? (
                                            <div className="bg-[#bf5af2]/5 border border-[#bf5af2]/15 rounded-xl p-3 space-y-2 mt-1 backdrop-blur-md">
                                              <div className="flex justify-between items-center text-[8px] font-mono">
                                                <span className="text-[#bf5af2] font-bold uppercase tracking-wider">Intervention Telemetry Log</span>
                                                {ev.confidence && (
                                                  <span className="text-[#66FCF1]">Confidence: {ev.confidence}%</span>
                                                )}
                                              </div>
                                              <p className="text-gray-300 text-[10px] font-sans leading-relaxed">{ev.message}</p>
                                              <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-white/5 text-[9px] font-mono">
                                                <div>
                                                  <span className="text-gray-500 block text-[7px] uppercase">Reason:</span>
                                                  <span className="text-gray-200">{ev.reason || 'Survival projection compression'}</span>
                                                </div>
                                                {ev.expectedImprovement && (
                                                  <div>
                                                    <span className="text-gray-500 block text-[7px] uppercase">Expected Imp.:</span>
                                                    <span className="text-emerald-400 font-semibold">+{ev.expectedImprovement}%</span>
                                                  </div>
                                                )}
                                              </div>
                                              {ev.actionsTaken && ev.actionsTaken.length > 0 && (
                                                <div className="text-[9px] pt-1 font-mono">
                                                  <span className="text-gray-500 block text-[7px] uppercase">Actions Taken:</span>
                                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                                    {ev.actionsTaken.map((act: string, aIdx: number) => (
                                                      <span key={aIdx} className="bg-black/35 text-[8px] border border-white/5 px-1.5 py-0.5 rounded text-gray-400 font-mono">
                                                        {act}
                                                      </span>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <p className="text-gray-300 text-[10px]">{ev.message}</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* AI Rescue & Recovery Protocol triggers */}
                            {!task.completed && (
                              <div className="pt-3 border-t border-gray-900/60 flex justify-end gap-2">
                                <button
                                  onClick={() => triggerAiRescue(task)}
                                  className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                                    task.deadlineCollapse
                                      ? "bg-red-500/20 border-red-500 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.25)] hover:bg-red-500/35"
                                      : "bg-transparent border-[#8A2BE2]/30 text-[#c084fc] hover:bg-[#8A2BE2]/10"
                                  }`}
                                >
                                  {task.deadlineCollapse ? "⚡ Trigger Recovery Protocol" : "🧠 Launch AI Rescue"}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}
          </div>{/* end grid */}
      </main>
      )}
      {rescuingTaskId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 transition-all duration-300">
          <div className="relative w-full max-w-4xl bg-[#0B0C10]/95 rounded-3xl border border-[#8A2BE2]/30 p-6 md:p-8 shadow-[0_15px_50px_rgba(138,43,226,0.3)] backdrop-blur-xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-gray-900 pb-3">
              <div>
                <h3 className="text-base font-bold uppercase tracking-widest text-[#8A2BE2]">
                  Chronos Active Intervention: Recovery Protocol
                </h3>
                <p className="text-[10px] text-gray-500 tracking-wide uppercase mt-0.5 font-mono">
                  Dynamic Schedule Reconstruct & Rescue Assets
                </p>
              </div>
              <button
                onClick={() => setRescuingTaskId(null)}
                className="text-gray-400 hover:text-gray-200 text-xs font-semibold uppercase tracking-wider focus:outline-none cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            {rescueLoading ? (
              <RecoveryLoadingPipeline isActive={rescueLoading} />
            ) : rescueError ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="w-10 h-10 rounded-full border-2 border-red-500/40 flex items-center justify-center">
                  <span className="text-red-400 text-lg">⚠</span>
                </div>
                <p className="text-xs text-red-300 font-mono text-center max-w-sm">{rescueError}</p>
                <button
                  onClick={() => rescueData && triggerAiRescue(rescueData)}
                  disabled={rescueLoading}
                  className="px-4 py-2 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 hover:bg-red-900/40 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40"
                >
                  Retry Recovery Protocol
                </button>
              </div>
            ) : rescueBriefing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch max-h-[70vh] overflow-y-auto custom-scrollbar pr-1">
                <RecoveryBriefing briefing={rescueBriefing} />

                {/* Right Column: Negotiation Chat */}
                <div className="border border-gray-800 bg-black/30 rounded-2xl p-4 flex flex-col justify-between h-[420px] font-sans">
                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest border-b border-white/5 pb-1.5 mb-2">
                    💬 Collaborate with Recovery Agent
                  </div>

                  <div ref={recoveryChatEndRef} className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin text-xs mb-2">
                    {recoveryChatHistory.map((msg, idx) => (
                      <div key={idx} className={`p-2.5 rounded-xl max-w-[85%] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#8A2BE2]/10 border border-[#8A2BE2]/20 text-purple-200 ml-auto text-right font-mono text-[11px]'
                          : 'bg-[#1F2833]/40 border border-gray-800 text-cyan-200 mr-auto text-left text-[11px]'
                      }`}>
                        {msg.content}
                      </div>
                    ))}
                    {recoveryChatLoading && (
                      <div className="text-[#06C6B3] font-mono text-[9px] animate-pulse">Agent is updating recovery timeline...</div>
                    )}
                  </div>

                  <form onSubmit={handleSendRecoveryChatMessage} className="flex gap-2 border-t border-white/5 pt-2">
                    <input
                      type="text"
                      placeholder="Ask the AI to modify or adjust the checklist steps..."
                      value={recoveryChatInput}
                      onChange={e => setRecoveryChatInput(e.target.value)}
                      disabled={recoveryChatLoading}
                      className="flex-1 rounded-xl px-3 py-2 text-xs focus:outline-none bg-[#1F2833]/30 text-gray-200 border border-gray-800"
                    />
                    <button
                      type="submit"
                      disabled={recoveryChatLoading}
                      className="px-4 py-2 bg-[#8A2BE2] hover:opacity-90 text-white rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
                    >
                      Negotiate
                    </button>
                  </form>
                </div>
              </div>
            ) : rescueData ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                <div className="space-y-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 bg-black/40 border border-white/5 p-4 rounded-2xl text-center">
                      <div className="border-r border-white/5 space-y-1">
                        <span className="text-[8px] text-red-500 uppercase tracking-widest block font-bold font-mono">Before Recovery</span>
                        <div className="text-lg font-bold text-red-400">{rescueData.survivalScoreBeforeRecovery ?? rescueData.survivalScore ?? 31}% Survival</div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[8px] text-[#66FCF1] uppercase tracking-widest block font-bold font-mono">After Recovery</span>
                        <div className="text-lg font-bold text-[#66FCF1]">{rescueData.recoveryForecast ?? rescueData.survivalScore ?? 78}% Success</div>
                      </div>
                    </div>

                    <div className="bg-[#1F2833]/30 border border-gray-800 p-5 rounded-2xl space-y-3 font-sans">
                      <h4 className="text-xs font-bold uppercase text-[#66FCF1] tracking-wider border-b border-white/5 pb-1 flex items-center gap-1.5">
                        <span>🎯</span> Active Recovery Checklist
                      </h4>
                      {rescueData.rescueResources?.checklist?.length ? (
                        <ul className="space-y-2 text-xs text-gray-300 font-mono">
                          {rescueData.rescueResources.checklist.map((item: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 bg-black/20 p-2.5 rounded-xl border border-white/5">
                              <span className="text-[#8A2BE2] font-bold">{idx + 1}.</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="space-y-2 text-xs text-gray-500 font-mono">
                          <p>Recovery checklist is still compiling.</p>
                          <button
                            type="button"
                            onClick={() => rescueData && triggerAiRescue(rescueData)}
                            disabled={!rescueData || rescueLoading}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 disabled:opacity-40"
                          >
                            {rescueLoading ? "Compiling..." : "Retry Recovery Build"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {rescueData && (
                    <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider bg-black/30 p-3 rounded-xl border border-white/5">
                      New Point Of No Return: <span className="text-[#bf5af2] font-bold">{rescueData.newPointOfNoReturn || "Extended"}</span>
                    </div>
                  )}
                </div>

                {/* Right Column: Negotiation Chat */}
                <div className="border border-gray-800 bg-black/30 rounded-2xl p-4 flex flex-col justify-between h-[360px] font-sans">
                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest border-b border-white/5 pb-1.5 mb-2">
                    💬 Collaborate with Recovery Agent
                  </div>

                  <div ref={recoveryChatEndRef} className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin text-xs mb-2">
                    {recoveryChatHistory.map((msg, idx) => (
                      <div key={idx} className={`p-2.5 rounded-xl max-w-[85%] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#8A2BE2]/10 border border-[#8A2BE2]/20 text-purple-200 ml-auto text-right font-mono text-[11px]'
                          : 'bg-[#1F2833]/40 border border-gray-800 text-cyan-200 mr-auto text-left text-[11px]'
                      }`}>
                        {msg.content}
                      </div>
                    ))}
                    {recoveryChatLoading && (
                      <div className="text-[#06C6B3] font-mono text-[9px] animate-pulse">Agent is updating recovery timeline...</div>
                    )}
                  </div>

                  <form onSubmit={handleSendRecoveryChatMessage} className="flex gap-2 border-t border-white/5 pt-2">
                    <input
                      type="text"
                      placeholder="Ask the AI to modify or adjust the checklist steps..."
                      value={recoveryChatInput}
                      onChange={e => setRecoveryChatInput(e.target.value)}
                      disabled={recoveryChatLoading}
                      className="flex-1 rounded-xl px-3 py-2 text-xs focus:outline-none bg-[#1F2833]/30 text-gray-200 border border-gray-800"
                    />
                    <button
                      type="submit"
                      disabled={recoveryChatLoading}
                      className="px-4 py-2 bg-[#8A2BE2] hover:opacity-90 text-white rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
                    >
                      Negotiate
                    </button>
                  </form>
                </div>
              </div>
            ) : null}

            {!rescueLoading && !rescueError && (
              <div className="flex justify-between items-center pt-2 border-t border-gray-900">
                <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">
                  🔒 Committing will lock the Todo checklist in the right sidebar.
                </span>
                <button
                  onClick={async () => {
                    if (rescueData) {
                      localStorage.setItem("chronos-active-recovery-task-id", rescueData.id);
                      setActiveRecoveryTaskId(rescueData.id);
                    }
                    setRescuingTaskId(null);
                    toast.success("Recovery Protocol successfully committed to active execution.");
                  }}
                  className="px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-[#8A2BE2] to-[#c084fc] text-white hover:opacity-90 transition-all cursor-pointer shadow-[0_0_15px_rgba(138,43,226,0.35)]"
                >
                  Activate Recovery Schedule
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: Add New Task Dialog */}
      {openAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 transition-all duration-200 overflow-y-auto">
          <div className="flex flex-col md:flex-row gap-4 items-stretch max-w-4xl w-full justify-center my-8">
            
            {/* Form Card */}
            <div className="relative w-full max-w-md bg-black/80 border border-white/[0.08] rounded-3xl p-6 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start pb-2 border-b border-gray-900">
                  <h2 className="text-base font-bold uppercase tracking-wider text-[#8A2BE2]">
                    {briefingTaskId ? "🔓 Sync & Brief Calendar Event" : "Commence Deadline Intake"}
                  </h2>
                  <button
                    onClick={() => {
                      setOpenAdd(false);
                      setShowEstimationAssistant(false);
                      setEstChatHistory([]);
                      setSuggestedEstimate(null);
                    }}
                    className="text-gray-400 hover:text-gray-200 text-xs focus:outline-none"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleAdd} className="space-y-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
                      Task Title
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Assemble review presentation"
                      value={newTitle}
                      onChange={e => {
                        setNewTitle(e.target.value);
                        setHasCompletedAiEstimation(false);
                      }}
                      className="w-full rounded-lg px-4 py-2.5 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none transition-colors border border-gray-700 placeholder-gray-600"
                      style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                    />
                  </div>

                  {/* Due Date & Time */}
                  <div className="relative">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
                      Due Date & Time
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCalendarPicker(!showCalendarPicker)}
                      className="w-full rounded-lg px-4 py-2.5 text-xs text-left focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none transition-colors border border-gray-700 bg-[#1F2833] text-[#c084fc] flex justify-between items-center cursor-pointer hover:border-gray-500"
                    >
                      <span className="font-mono">{newDue ? new Date(newDue).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : "Select deadline..."}</span>
                      <span className="text-[10px]">📅</span>
                    </button>

                    {showCalendarPicker && (
                      <div ref={calendarPickerRef} className="absolute top-14 left-0 z-30 w-72 bg-[#0B0C10]/95 border border-[#8A2BE2]/40 rounded-2xl p-4 shadow-[0_10px_30px_rgba(138,43,226,0.3)] backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-250 flex flex-col gap-3 font-sans">
                        {/* Month & Year header */}
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (calendarMonth === 0) {
                                setCalendarMonth(11);
                                setCalendarYear(prev => prev - 1);
                              } else {
                                setCalendarMonth(prev => prev - 1);
                              }
                            }}
                            className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 focus:outline-none text-[10px]"
                          >
                            ◀
                          </button>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-purple-300">
                            {new Date(calendarYear, calendarMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (calendarMonth === 11) {
                                setCalendarMonth(0);
                                setCalendarYear(prev => prev + 1);
                              } else {
                                setCalendarMonth(prev => prev + 1);
                              }
                            }}
                            className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 focus:outline-none text-[10px]"
                          >
                            ▶
                          </button>
                        </div>

                        {/* Calendar days grid */}
                        <div className="grid grid-cols-7 gap-1 text-center text-[8px] text-gray-500 font-mono uppercase tracking-wider">
                          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {renderCalendarGrid()}
                        </div>

                        {/* Time selector */}
                        <div className="flex items-center gap-1.5 pt-2 border-t border-white/5 justify-between">
                          <span className="text-[8px] font-mono text-gray-500 uppercase">Set Time:</span>
                          <div className="flex items-center gap-1">
                            <select
                              value={pickerHour}
                              onChange={e => {
                                setPickerHour(e.target.value);
                                updateNewDue(pickerDate || new Date(), e.target.value, pickerMinute, pickerAmPm);
                              }}
                              className="bg-[#1F2833] border border-gray-700 rounded p-1 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-[#8A2BE2]"
                            >
                              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                            <span className="text-gray-500 text-xs">:</span>
                            <select
                              value={pickerMinute}
                              onChange={e => {
                                setPickerMinute(e.target.value);
                                updateNewDue(pickerDate || new Date(), pickerHour, e.target.value, pickerAmPm);
                              }}
                              className="bg-[#1F2833] border border-gray-700 rounded p-1 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-[#8A2BE2]"
                            >
                              {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                            <select
                              value={pickerAmPm}
                              onChange={e => {
                                setPickerAmPm(e.target.value);
                                updateNewDue(pickerDate || new Date(), pickerHour, pickerMinute, e.target.value);
                              }}
                              className="bg-[#1F2833] border border-gray-700 rounded p-1 text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-[#8A2BE2]"
                            >
                              <option value="AM">AM</option>
                              <option value="PM">PM</option>
                            </select>
                          </div>
                        </div>

                        {/* Warnings / Assist Panel */}
                        <div className="text-[8px] font-mono leading-relaxed mt-1">
                          {newDue && new Date(newDue) < new Date() && (
                            <div className="text-red-400 font-bold bg-red-950/20 border border-red-500/25 px-2 py-1 rounded">
                              ⚠️ Selected deadline is in the past!
                            </div>
                          )}
                          {newDue && checkSleepOverlap() && (
                            <div className="text-amber-400 font-bold bg-amber-950/20 border border-amber-500/25 px-2 py-1 rounded">
                              ⚠️ Overlaps sleep hours ({sleepStart}:00 - {sleepEnd}:00). Chronos will discount these hours.
                            </div>
                          )}
                          {newDue && !checkSleepOverlap() && new Date(newDue) >= new Date() && (
                            <div className="text-green-400 bg-green-950/20 border border-green-500/25 px-2 py-1 rounded">
                              ✓ Deadline window secure. Core focus active.
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (!pickerDate) {
                              setPickerDate(new Date());
                              updateNewDue(new Date(), pickerHour, pickerMinute, pickerAmPm);
                            }
                            setShowCalendarPicker(false);
                          }}
                          className="w-full py-1.5 bg-[#8A2BE2] hover:opacity-90 text-white font-bold rounded-lg text-[9px] uppercase tracking-wider cursor-pointer border border-[#8A2BE2] text-center"
                        >
                          Confirm Time
                        </button>
                      </div>
                    )}
                  </div>

                  {/* AI Summarizer and Work Hours Panel */}
                  <div className="bg-purple-950/15 border border-purple-800/25 rounded-2xl p-4 space-y-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#c084fc]">
                        Work Effort Estimation
                      </label>
                      <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">
                        {hasCompletedAiEstimation ? "🔓 Unlocked" : "🔒 Locked by AI"}
                      </span>
                    </div>

                    <div className="flex gap-3 items-center">
                      <div className="flex-1">
                        <label className="block text-[8px] font-mono uppercase tracking-widest text-gray-500 mb-1">
                          Hours
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0.5}
                            step={0.5}
                            required
                            readOnly={!hasCompletedAiEstimation}
                            value={newHours}
                            onChange={e => setNewHours(Number(e.target.value))}
                            className={`w-full rounded-lg pl-8 pr-3 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none transition-all border ${
                              !hasCompletedAiEstimation 
                                ? 'bg-[#1F2833]/40 border-gray-800 text-gray-500 cursor-not-allowed select-none' 
                                : 'bg-[#1F2833] border-gray-700 text-[#c084fc] hover:border-gray-500'
                            }`}
                            title={!hasCompletedAiEstimation ? 'Run the AI Summarizer first to unlock this input' : 'Adjust the AI suggestion as needed'}
                          />
                          <span className="absolute left-2.5 top-2.5 text-[10px] text-gray-500">
                            {hasCompletedAiEstimation ? "🔓" : "🔒"}
                          </span>
                        </div>
                      </div>

                      <div className="flex-1 self-end">
                        {(function() {
                          const missing: string[] = [];
                          if (!newTitle.trim()) missing.push("task title");
                          if (!newDue) missing.push("deadline");
                          else if (new Date(newDue) <= new Date()) missing.push("valid future deadline");
                          const estDisabled = missing.length > 0;
                          const tooltip = missing.length > 0 ? `Requires: ${missing.join(", ")}` : "";
                          return (
                            <button
                              type="button"
                              disabled={estDisabled}
                              onClick={() => {
                                if (estDisabled) {
                                  toast.error(`Enter ${missing.join(" and ")} to estimate work.`);
                                  return;
                                }
                                 if (!showEstimationAssistant) {
                                   handleOpenEstimationAssistant();
                                 } else {
                                   setShowEstimationAssistant(false);
                                   setEstChatHistory([]);
                                   setSuggestedEstimate(null);
                                   setHasCompletedAiEstimation(false);
                                 }
                              }}
                              className={`w-full py-2 rounded-lg text-center text-xs font-bold uppercase focus:outline-none transition-all border ${
                                estDisabled
                                  ? 'text-gray-600 border-gray-800 bg-transparent cursor-not-allowed opacity-50'
                                  : 'text-[#06C6B3] border-[#06C6B3]/40 bg-[#06C6B3]/10 hover:bg-[#06C6B3]/20 hover:border-[#06C6B3]/60 cursor-pointer animate-pulse'
                              }`}
                              title={tooltip}
                            >
                              {showEstimationAssistant ? "✕ Close Summarizer" : "💬 AI Summarizer"}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Importance Level */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                      Importance Level
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["low", "medium", "high"] as const).map(level => {
                        const isActive = newImportance === level;
                        const activeStyles = 
                          level === 'high' ? 'bg-red-500/20 border-red-500 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.2)]' :
                          level === 'medium' ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]' :
                          'bg-green-500/20 border-green-500 text-green-300 shadow-[0_0_12px_rgba(16,185,129,0.2)]';
                        return (
                          <button
                            key={level}
                            type="button"
                            onClick={() => setNewImportance(level)}
                            className={`py-2 rounded-lg font-mono text-[10px] uppercase tracking-wider border transition-all cursor-pointer text-center ${
                              isActive 
                                ? activeStyles 
                                : 'bg-[#1F2833]/40 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                            }`}
                          >
                            {level === 'high' ? '🔴 High' : level === 'medium' ? '🟡 Medium' : '🟢 Low'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-900 space-y-2">
                    {!hasCompletedAiEstimation && (
                      <p className="text-[9px] text-amber-400/90 font-mono uppercase tracking-widest text-right animate-pulse">
                        ⚠️ Discussion with AI Estimator Core is required before saving
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAdd(false);
                          setShowEstimationAssistant(false);
                          setEstChatHistory([]);
                          setSuggestedEstimate(null);
                          setHasCompletedAiEstimation(false);
                        }}
                        className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-200 bg-[#1F2833]/40 border border-gray-800 transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit"
                        disabled={!hasCompletedAiEstimation || isAddingTask}
                        className={`px-5 py-2 font-bold rounded-lg text-xs uppercase tracking-wider transition-all ${
                          (!hasCompletedAiEstimation || isAddingTask)
                            ? 'bg-gray-800 text-gray-500 cursor-not-allowed opacity-50 border border-gray-900'
                            : 'bg-[#8A2BE2] hover:opacity-90 text-white shadow-[0_0_15px_rgba(138,43,226,0.25)] cursor-pointer'
                        }`}
                      >
                        {briefingTaskId ? (isAddingTask ? 'Unlocking...' : 'Unlock Mission Target') : (isAddingTask ? 'Adding...' : 'Add Task')}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>

            {/* AI Summarizer Core Panel on the Right */}
            {showEstimationAssistant && (
              <div className="w-full max-w-sm bg-black/80 border border-white/[0.08] rounded-3xl p-6 shadow-[0_8px_32px_0_rgba(138,43,226,0.3)] backdrop-blur-xl flex flex-col justify-between animate-in slide-in-from-left-5 duration-300 min-h-[450px] relative overflow-hidden">
                {estChatLoading ? (
                  <div className="flex flex-col h-full items-center justify-center space-y-4 animate-in fade-in duration-300">
                    <div className="w-10 h-10 border-2 border-t-transparent border-[#8A2BE2] rounded-full animate-spin" />
                    <div className="text-center">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-[#06C6B3] flex items-center gap-1.5 justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#06C6B3] animate-ping" />
                        Analyzing Mission Parameters
                      </h2>
                      <p className="text-[8px] text-gray-500 uppercase tracking-widest mt-1 font-mono">
                        Consulting AI estimation core...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full space-y-4">
                    <div className="flex justify-between items-start pb-2 border-b border-gray-900 flex-shrink-0">
                      <div>
                        <h2 className="text-sm font-bold uppercase tracking-wider text-[#06C6B3]">
                          AI Summarizer Core
                        </h2>
                        <p className="text-[8px] text-gray-500 uppercase tracking-widest mt-0.5">
                          Calibrating temporal effort requirements
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowEstimationAssistant(false)}
                        className="text-gray-400 hover:text-gray-250 text-xs focus:outline-none font-bold"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Chat Messages */}
                    <div ref={estChatEndRef} className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[200px] max-h-[300px] custom-scrollbar text-xs">
                      {estChatHistory.map((msg, idx) => (
                        <div key={idx} className={`group relative p-3 rounded-2xl border transition-all duration-300 ${
                          msg.role === 'user'
                            ? 'bg-[#8A2BE2]/10 border-[#8A2BE2]/20 text-purple-200 ml-12 text-right select-text cursor-text'
                            : 'bg-white/5 border-white/[0.04] text-gray-300 mr-12 text-left select-none'
                        }`}>
                          <span className={`block text-[8px] uppercase tracking-wider mb-1 ${
                            msg.role === 'user' ? 'text-purple-400' : 'text-[#06C6B3]'
                          }`}>
                            {msg.role === 'user' ? username : 'Estimation Core'}
                          </span>
                          <div className="space-y-1 select-text">{renderFormattedText(msg.content)}</div>
                          {msg.role === 'user' && (
                            <button
                              type="button"
                              onClick={() => setEstChatInput(msg.content)}
                              title="Copy message back to input box to edit or resend"
                              className="absolute left-2 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 border border-white/15 hover:bg-[#8A2BE2]/30 text-[7px] font-mono text-purple-300 px-1.5 py-0.5 rounded cursor-pointer uppercase tracking-widest"
                            >
                              🔄 Resend
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Actions / Suggestions */}
                    {suggestedEstimate !== null && (
                      <div className="pt-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setNewHours(suggestedEstimate);
                            setHasCompletedAiEstimation(true);
                            toast.success(`Applied estimate of ${suggestedEstimate} hours.`);
                          }}
                          className="w-full py-2.5 bg-gradient-to-r from-[#06C6B3] to-[#8A2BE2] text-white rounded-xl text-[10px] font-bold uppercase tracking-wider hover:opacity-90 cursor-pointer text-center transition-all shadow-[0_0_12px_rgba(6,198,179,0.2)]"
                        >
                          ✓ Apply Suggested Estimate of {suggestedEstimate} Hours
                        </button>
                      </div>
                    )}

                    {/* Chat Input */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendEstChatMessage(e);
                      }}
                      className="flex gap-2 pt-3 border-t border-white/5 flex-shrink-0 animate-in fade-in duration-200"
                    >
                      <input
                        type="text"
                        placeholder="Discuss scope, tech stack, or complexity..."
                        value={estChatInput}
                        onChange={e => setEstChatInput(e.target.value)}
                        disabled={estChatLoading}
                        className="flex-1 rounded-xl px-4 py-2.5 text-xs bg-white/5 border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#8A2BE2] text-gray-200 font-mono transition-all placeholder-gray-600 disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={estChatLoading || !estChatInput.trim()}
                        className="px-4 py-2.5 rounded-xl bg-[#8A2BE2] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center shadow-[0_0_15px_rgba(138,43,226,0.25)]"
                      >
                        Send
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* SYSTEM CONFIGURATION & SETTINGS MODAL */}
      {openSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 transition-all duration-200">
          <div className="relative w-full max-w-lg bg-[#0B0C10]/95 border border-white/[0.08] rounded-3xl p-6 shadow-[0_8px_32px_0_rgba(138,43,226,0.4)] backdrop-blur-xl space-y-5 animate-in fade-in zoom-in-95 duration-200 text-left">
            <div className="flex justify-between items-start pb-2 border-b border-gray-900">
              <div>
                <h2 className="text-base font-bold uppercase tracking-wider text-[#8A2BE2]">
                  Chronos System Settings
                </h2>
                <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-0.5">
                  Calibrate AI supplier engines and twin behavior databases
                </p>
              </div>
              <button
                onClick={() => setOpenSettings(false)}
                className="text-gray-400 hover:text-gray-200 text-xs focus:outline-none font-bold"
              >
                ✕
              </button>
            </div>

            {/* TAB SELECTOR */}
            <div className="flex border-b border-white/5 pb-2 gap-4">
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
                onClick={() => setSettingsTab('tools')}
                className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${
                  settingsTab === 'tools' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Tools
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
              {settingsTab === 'ai' && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#66FCF1] border-b border-white/5 pb-1">
                    Core AI Supplier Options
                  </h3>
                  
                  <div 
                    onClick={() => setSettingsRecheckTrigger(prev => prev + 1)}
                    className="flex items-center justify-between bg-black/30 px-4 py-2.5 rounded-xl border border-white/5 cursor-pointer hover:bg-black/40 transition-all select-none"
                    title="Click to verify connectivity"
                  >
                    <span className="text-[9px] font-mono tracking-wider text-gray-500 uppercase flex items-center gap-1">
                      Supplier Status: <span className="text-[8px] opacity-65">(Click to test)</span>
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-widest uppercase border ${
                      settingsConnectionStatus === 'online'
                        ? 'bg-green-950/40 border-green-800 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.15)]'
                        : settingsConnectionStatus === 'checking'
                          ? 'bg-amber-950/40 border-amber-800 text-amber-400 animate-pulse'
                          : 'bg-red-950/40 border-red-800 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                    }`}>
                      {settingsConnectionStatus === 'online' ? '🟢 Online' : settingsConnectionStatus === 'checking' ? '🟡 Checking...' : '🔴 Offline'}
                    </span>
                  </div>

                  {settingsConnectionStatus === 'offline' && settingsConnectionError && (
                    <div 
                      onClick={() => setSettingsRecheckTrigger(prev => prev + 1)}
                      className="p-3 rounded-xl bg-red-950/15 border border-red-900/30 text-[10px] text-red-400 font-mono leading-relaxed cursor-pointer hover:bg-red-950/25 transition-all text-center select-none"
                    >
                      <div>⚠️ {settingsConnectionError}</div>
                      <div className="text-[8px] text-red-500 mt-1 uppercase font-bold tracking-wider">Click to Reverify 🔄</div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      AI Supplier Engine
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsProvider('gemini');
                          setSettingsApiUrl('https://generativelanguage.googleapis.com/v1beta');
                          setSettingsModel('gemini-1.5-flash');
                          setSettingsAvailableModels([]);
                        }}
                        className={`py-2 rounded-lg font-bold text-[9px] uppercase tracking-wider border transition-all cursor-pointer ${
                          settingsProvider === 'gemini' 
                            ? 'bg-blue-500/20 border-blue-500 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.15)]' 
                            : 'bg-[#1F2833]/40 border-gray-700 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        Gemini
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsProvider('nvidia');
                          setSettingsApiUrl('https://integrate.api.nvidia.com/v1');
                          setSettingsModel('meta/llama-3.3-70b-instruct');
                          setSettingsAvailableModels([]);
                        }}
                        className={`py-2 rounded-lg font-bold text-[9px] uppercase tracking-wider border transition-all cursor-pointer ${
                          settingsProvider === 'nvidia' 
                            ? 'bg-[#8A2BE2]/20 border-[#8A2BE2] text-[#8A2BE2]' 
                            : 'bg-[#1F2833]/40 border-gray-700 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        NVIDIA NIM
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsProvider('custom');
                          setSettingsApiUrl('http://localhost:8000/v1');
                          setSettingsModel('gpt-4o');
                          setSettingsAvailableModels([]);
                        }}
                        className={`py-2 rounded-lg font-bold text-[9px] uppercase tracking-wider border transition-all cursor-pointer ${
                          settingsProvider === 'custom' 
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300' 
                            : 'bg-[#1F2833]/40 border-gray-700 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        Custom API
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {settingsProvider === 'nvidia' ? 'NVIDIA API Key' : settingsProvider === 'gemini' ? 'Google Gemini API Key' : 'API Key (Optional)'}
                    </label>
                    <input
                      type="password"
                      required={settingsProvider === 'nvidia' || settingsProvider === 'gemini'}
                      placeholder={settingsProvider === 'nvidia' ? "nvapi-..." : settingsProvider === 'gemini' ? "Google Gemini API Key..." : "API Key..."}
                      value={settingsApiKey}
                      onChange={e => setSettingsApiKey(e.target.value)}
                      className="w-full rounded-lg px-4 py-2.5 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none border border-gray-700 font-mono"
                      style={{ backgroundColor: '#1F2833', color: '#8A2BE2' }}
                    />
                  </div>

                  {settingsProvider === 'custom' && (
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        API Base URL
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. http://localhost:8000/v1"
                        value={settingsApiUrl}
                        onChange={e => setSettingsApiUrl(e.target.value)}
                        className="w-full rounded-lg px-4 py-2.5 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none border border-gray-700 font-mono"
                        style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Active AI Model
                    </label>
                    {settingsProvider === 'custom' ? (
                      <input
                        type="text"
                        required
                        placeholder="e.g. gpt-4o"
                        value={settingsModel}
                        onChange={e => setSettingsModel(e.target.value)}
                        className="w-full rounded-lg px-4 py-2.5 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none border border-gray-700 font-mono"
                        style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                      />
                    ) : settingsLoadingModels ? (
                      <div className="w-full rounded-lg px-4 py-2.5 text-[10px] border border-gray-700 text-gray-500 bg-[#1F2833] animate-pulse uppercase tracking-wider font-mono">
                        Querying supplier catalog...
                      </div>
                    ) : (
                      <select
                        value={settingsModel}
                        onChange={e => setSettingsModel(e.target.value)}
                        className="w-full rounded-lg px-4 py-2.5 text-xs focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none border border-gray-700 font-mono"
                        style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                      >
                        {settingsAvailableModels.map(m => (
                          <option key={m} value={m} style={{ backgroundColor: '#1F2833' }}>{m}</option>
                        ))}
                        {settingsAvailableModels.length === 0 && (
                          <option value={settingsModel} style={{ backgroundColor: '#1F2833' }}>{settingsModel}</option>
                        )}
                      </select>
                    )}
                  </div>

                  {/* Recommended Models */}
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-3.5 text-[10px] font-mono leading-relaxed">
                    <span className="text-[#06C6B3] font-bold uppercase block tracking-wider border-b border-white/5 pb-1">💡 Provider Model Recommendations:</span>
                    
                    <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1 scrollbar-thin">

                      {/* Gemini */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-[#8A2BE2] font-bold uppercase text-[9px]">✨ Google Gemini (Cloud)</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">gemini-1.5-flash</code> (fast response)</div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">gemini-1.5-pro</code> (high reasoning capability)</div>
                      </div>

                      {/* NVIDIA NIM */}
                      <div className="p-2 bg-black/40 border border-white/5 rounded-lg space-y-1">
                        <div className="text-[#0099FF] font-bold uppercase text-[9px]">🟢 NVIDIA NIM</div>
                        <div className="text-[8px] text-gray-400">• Min Spec: <code className="text-[#c084fc]">meta/llama-3.1-8b-instruct</code></div>
                        <div className="text-[8px] text-gray-400">• Nominal: <code className="text-[#66FCF1]">meta/llama-3.3-70b-instruct</code></div>
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
              )}

              {settingsTab === 'tools' && (
                <div className="space-y-4 text-left py-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#06C6B3] border-b border-white/5 pb-1">
                    🛠️ Tools
                  </h3>

                  {/* Google Calendar */}
                  <div className="space-y-2">
                    <span className="block text-[10px] text-[#06C6B3] uppercase font-bold">Google Calendar</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSyncGoogleCalendar}
                        disabled={calendarSyncState !== 'idle'}
                        className="flex-1 py-2.5 rounded-xl border border-[#06C6B3]/40 text-[#66FCF1] hover:bg-[#06C6B3]/10 transition-all font-mono text-[9px] uppercase tracking-widest cursor-pointer font-bold shadow-[0_0_10px_rgba(6,198,179,0.1)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {calendarSyncState === 'authorizing' ? '🔑 Authorizing…' : calendarSyncState === 'syncing' ? '📥 Syncing…' : '📅 Sync Calendar'}
                      </button>
                      <button
                        type="button"
                        onClick={handleChangeGoogleAccount}
                        className="px-3 py-2.5 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all font-mono text-[9px] uppercase tracking-widest cursor-pointer font-bold shrink-0"
                        title="Change Google Account"
                      >
                        🔄 Reset
                      </button>
                    </div>
                    <p className="text-[8px] text-gray-500 font-mono italic">
                      Sync locks your calendar events into Chronos. Reset clears OAuth tokens to change accounts.
                    </p>
                  </div>

                  {/* Phone Link */}
                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <span className="block text-[10px] text-[#0099FF] uppercase font-bold">📱 Phone Link</span>
                    <p className="text-[10px] text-gray-400 font-sans leading-relaxed">
                      Set up out-of-band notifications on your mobile device. Get real-time warnings when timelines collapse.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenPhoneModal}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-[#0099FF] hover:opacity-95 text-black font-mono font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(0,153,255,0.2)] border border-transparent"
                    >
                      🚀 Open Phone Link Setup Wizard →
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'twin' && (
                <div className="space-y-4 text-left">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#66FCF1] border-b border-white/5 pb-1">
                    Operator Digital Twin Settings
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
                      className="w-full rounded-lg px-4 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] border border-gray-700"
                      style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                    />
                  </div>

                  <div className="space-y-2">
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
                          className="w-full rounded-lg px-3 py-2 text-xs border border-gray-700 focus:ring-1 focus:ring-[#8A2BE2]"
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
                          className="w-full rounded-lg px-3 py-2 text-xs border border-gray-700 focus:ring-1 focus:ring-[#8A2BE2]"
                          style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                        />
                      </div>
                    </div>
                    <p className="text-[8px] text-gray-500 font-mono italic">Time ranges in sleep hours will be completely excluded from remaining work hours.</p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <div className="flex justify-between items-center">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Procrastination Severity Level
                      </label>
                      <span className="text-[10px] font-mono text-[#8A2BE2] font-bold">
                        {procrastinationRating !== null ? `${procrastinationRating.toFixed(1)}/10.0` : "Not calibrated"}
                      </span>
                    </div>
                    {procrastinationRating !== null && (
                      <input
                        type="range"
                        min="1.0"
                        max="10.0"
                        step="0.1"
                        value={procrastinationRating}
                        onChange={e => setProcrastinationRating(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#8A2BE2]"
                      />
                    )}
                    <p className="text-[7px] text-gray-500 font-mono italic">
                      {procrastinationRating !== null ? "Higher values reduce predicted task lead time, raising failure risk alerts." : "Complete identity scan to calibrate behavioral patterns."}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Attention Peak Cycle
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Focus cycles peak late evening"
                      value={attentionCycle ?? ""}
                      onChange={e => setAttentionCycle(e.target.value)}
                      className="w-full rounded-lg px-4 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] border border-gray-700 font-mono"
                      style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Stress Response Profile
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Postpones tasks under high workload pressure"
                      value={stressResponse ?? ""}
                      onChange={e => setStressResponse(e.target.value)}
                      className="w-full rounded-lg px-4 py-2 text-xs focus:ring-1 focus:ring-[#8A2BE2] border border-gray-700 font-mono"
                      style={{ backgroundColor: '#1F2833', color: '#c084fc' }}
                    />
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-white/5">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Behavioral Database Admin
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={handleReverifyTwin}
                        disabled={reverifyingTwin}
                        className="px-4 py-2.5 rounded-xl border border-[#8A2BE2]/40 hover:bg-[#8A2BE2]/10 text-purple-300 font-mono text-[9px] uppercase tracking-wider transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-1 min-h-[60px] disabled:opacity-50"
                      >
                        <span>👤</span>
                        <span>Reverify Twin</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteTwin}
                        className="px-4 py-2.5 rounded-xl border border-red-900/40 hover:bg-red-950/20 text-red-400 font-mono text-[9px] uppercase tracking-wider transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-1 min-h-[60px]"
                      >
                        <span>⚠️</span>
                        <span>Wipe Twin Profile & Reset Memory</span>
                      </button>
                    </div>
                  </div>


                </div>
              )}

              {settingsTab === 'dev' && (
                <div className="space-y-4 text-left font-mono">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500 border-b border-white/5 pb-1">
                    🛠️ Developer Overrides & Simulation
                  </h3>

                  <div className="space-y-2">
                    <span className="block text-[10px] text-amber-400 uppercase">Singularity Phase Override:</span>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(['offline', 'idle', 'listening', 'thinking', 'speaking'] as const).map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleSetDevOverride(p)}
                          className={`px-2.5 py-1.5 text-[9px] font-mono rounded-lg border uppercase transition-all cursor-pointer focus:outline-none ${
                            devOverrideState === p
                              ? 'bg-amber-500 border-amber-500 text-black font-bold'
                              : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    {devOverrideState !== null && (
                      <button
                        type="button"
                        onClick={() => handleSetDevOverride(null)}
                        className="px-2.5 py-1.5 text-[9px] font-mono rounded-lg border border-red-500/40 bg-red-950/20 text-red-400 hover:bg-red-950/40 uppercase transition-all cursor-pointer font-bold w-full text-center"
                      >
                        Clear Override (Sync)
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <span className="block text-[10px] text-amber-400 uppercase">Deterioration Simulations:</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSimulateTime}
                        className="flex-1 px-3 py-2.5 bg-amber-500/20 border border-amber-500 text-amber-300 font-mono text-[9px] rounded-xl hover:bg-amber-500/35 transition-all cursor-pointer"
                      >
                        ⏩ Simulate +1 Hour Passage
                      </button>
                      <button
                        type="button"
                        onClick={handleSimulateCollapse}
                        className="flex-1 px-3 py-2.5 bg-red-950/40 border border-red-500 text-red-400 font-mono text-[9px] rounded-xl hover:bg-red-950/60 transition-all cursor-pointer"
                      >
                        🚨 Force Timeline Collapse
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-900">
              <button
                type="button"
                onClick={() => setOpenSettings(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-200 bg-[#1F2833]/40 border border-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={(settingsConnectionStatus === 'offline' && settingsTab === 'ai') || isSavingSettings}
                className={`px-5 py-2 font-bold rounded-lg text-xs uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(138,43,226,0.25)] ${
                  (settingsConnectionStatus === 'offline' && settingsTab === 'ai') || isSavingSettings
                    ? 'bg-gray-850 text-gray-500 cursor-not-allowed border border-gray-800 shadow-none'
                    : 'bg-[#8A2BE2] hover:opacity-90 text-white cursor-pointer'
                }`}
              >
                {isSavingSettings ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Twin Profile Modal */}
      {openTwinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-[#0B0C10]/95 border border-[#8A2BE2]/30 text-gray-100 shadow-[0_8px_32px_0_rgba(138,43,226,0.15)] rounded-3xl w-full max-w-xl p-8 relative flex flex-col max-h-[85vh] overflow-hidden">
            
            {/* Background Glow Elements */}
            <div className="absolute top-0 left-1/4 w-40 h-40 bg-[#8A2BE2]/10 rounded-full blur-[80px] pointer-events-none" />
            <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-[#66FCF1]/5 rounded-full blur-[80px] pointer-events-none" />
            
            {!isTrainingBrain ? (
              <>
                {/* Header */}
                <div className="text-center border-b border-white/5 pb-4 mb-2 relative z-10">
                  <div className="text-4xl mb-2 animate-pulse select-none">👤</div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-[#8A2BE2] font-mono">
                    {username}'s Digital Twin Profile
                  </h2>
                  <p className="text-[8px] text-gray-500 font-mono mt-1.5 uppercase tracking-widest">
                    Active Cognitive Behavior Architecture
                  </p>
                </div>

                {/* Tab selector */}
                <div className="flex justify-center gap-6 mb-3 border-b border-white/5 pb-2 relative z-10">
                  <button
                    type="button"
                    onClick={() => setTwinTab('profile')}
                    className={`pb-1 text-[10px] font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${
                      twinTab === 'profile' ? 'text-[#8A2BE2] border-b border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Cognitive Baseline
                  </button>
                  <button
                    type="button"
                    onClick={() => setTwinTab('telemetry')}
                    className={`pb-1 text-[10px] font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${
                      twinTab === 'telemetry' ? 'text-[#8A2BE2] border-b border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Live Telemetry
                  </button>
                </div>

                {/* Profile content */}
                <div className="flex-1 overflow-y-auto py-2 relative z-10 pr-1 scrollbar-thin max-h-[50vh]">
                  {twinTab === 'profile' ? (
                    renderFormattedProfile(performanceTwin)
                  ) : (
                    <div className="space-y-4">
                      {/* Live Procrastination Gauge */}
                      <div className="bg-black/40 border border-white/5 rounded-2xl p-4 space-y-2">
                        {procrastinationRating !== null ? (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Procrastination Level</span>
                              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                                procrastinationRating >= 8.0 ? 'bg-red-950/40 border-red-800 text-red-400' :
                                procrastinationRating >= 5.0 ? 'bg-amber-950/40 border-amber-800 text-amber-400' :
                                'bg-green-950/40 border-green-800 text-green-400'
                              }`}>
                                {procrastinationRating.toFixed(1)} / 10
                              </span>
                            </div>
                            {/* Progress Bar / Gauge */}
                            <div className="h-2.5 bg-gray-900 rounded-full overflow-hidden border border-white/5">
                              <div 
                                className={`h-full transition-all duration-500 rounded-full ${
                                  procrastinationRating >= 8.0 ? 'bg-gradient-to-r from-red-600 to-red-400' :
                                  procrastinationRating >= 5.0 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
                                  'bg-gradient-to-r from-green-500 to-emerald-400'
                                }`}
                                style={{ width: `${procrastinationRating * 10}%` }}
                              />
                            </div>
                            <p className="text-[7.5px] text-gray-500 font-mono italic">
                              {procrastinationRating >= 8.0 ? "CRITICAL DELAY RISK: Chronos expects start lead times of less than 3 hours." :
                               procrastinationRating >= 5.0 ? "MODERATE DELAY RISK: Chronos expects task start lead times of around 7 hours." :
                               "STABLE: Highly proactive start behaviors detected. Expected lead times exceed 12 hours."}
                            </p>
                          </>
                        ) : (
                          <p className="text-[10px] text-gray-500 font-mono italic text-center py-2">
                            Analysis pending — complete identity scan to calibrate behavioral patterns.
                          </p>
                        )}
                      </div>

                      {/* Behavioral Cycles & Stress Response */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-black/40 border border-white/5 rounded-2xl p-3.5 space-y-1">
                          <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest block">Attention Peak Cycle</span>
                          <p className="text-xs text-[#66FCF1] font-mono leading-relaxed">{attentionCycle || "Not calibrated."}</p>
                        </div>
                        <div className="bg-black/40 border border-white/5 rounded-2xl p-3.5 space-y-1">
                          <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest block">Stress Response Profile</span>
                          <p className="text-xs text-[#c084fc] font-mono leading-relaxed">{stressResponse || "Not calibrated."}</p>
                        </div>
                      </div>

                      {/* Execution Statistics Grid */}
                      <div className="bg-black/40 border border-white/5 rounded-2xl p-4 space-y-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block border-b border-white/5 pb-1">Execution & Deadline Defenses</span>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                          <div className="flex items-center justify-between border-r border-white/5 pr-3">
                            <div>
                              <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">Active Streak</div>
                              {streakCount !== null ? (
                              <div className="text-base font-bold font-mono text-orange-400">{streakCount} 🔥</div>
                            ) : (
                              <div className="text-base font-bold font-mono text-gray-600"> — </div>
                            )}
                            </div>
                            <span className="text-base">⚡</span>
                          </div>
                          <div className="flex items-center justify-between pl-2">
                            <div>
                              <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">Recovered Hours</div>
                              <div className="text-base font-bold font-mono text-cyan-400">
                              {totalRecoveredHours !== null ? `${totalRecoveredHours.toFixed(1)}h` : " — "}
                            </div>
                            </div>
                            <span className="text-base">⌛</span>
                          </div>
                          <div className="flex items-center justify-between border-r border-white/5 pr-3 pt-1.5 border-t border-white/5">
                            <div>
                              <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">Secured Deadlines</div>
                              {executionCount !== null ? (
                              <div className="text-base font-bold font-mono text-green-400">{executionCount}</div>
                            ) : (
                              <div className="text-base font-bold font-mono text-gray-600"> — </div>
                            )}
                            </div>
                            <span className="text-base">✅</span>
                          </div>
                          <div className="flex items-center justify-between pl-2 pt-1.5 border-t border-white/5">
                            <div>
                              <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">Nexus Events</div>
                              <div className="text-base font-bold font-mono text-red-500">
                              {failureCount !== null ? failureCount : " — "}
                            </div>
                            </div>
                            <span className="text-base">☄️</span>
                          </div>
                      </div>
                      </div>

                      {/* Voice Companion Subsystem status card */}
                      <div className="bg-black/40 border border-white/5 rounded-2xl p-4 space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block border-b border-white/5 pb-1">Voice Companion Subsystem</span>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">Connection</div>
                            <div className="flex items-center gap-1 text-xs font-mono font-bold mt-0.5">
                              {voiceTelemetry.status === 'online' ? (
                                <>
                                  <span className="text-green-400 animate-pulse">🟢</span>
                                  <span className="text-green-400">Connected</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-gray-500">⚪</span>
                                  <span className="text-gray-500">Offline</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">Last Seen</div>
                            <div className="text-xs font-mono font-semibold text-gray-300 mt-0.5">
                              {voiceTelemetry.status === 'online' ? (
                                voiceTelemetry.lastSeenSeconds < 0 ? 'unknown' :
                                voiceTelemetry.lastSeenSeconds <= 2 ? 'Just now' : `${voiceTelemetry.lastSeenSeconds}s ago`
                              ) : (
                                'Never'
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {voiceTelemetry.status === 'online' && (
                          <div className="flex items-center justify-between pt-1 text-[8.5px] font-mono text-gray-500">
                            <div>
                              <span>Node: </span>
                              <span className="text-purple-400">{API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1') ? 'Localhost' : 'Google Cloud'}</span>
                            </div>
                            <div>
                              <span>Latency: </span>
                              <span className="text-[#06C6B3]">{voiceTelemetry.latency !== null ? `${voiceTelemetry.latency}ms` : '--'}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Buttons */}
                <div className="flex gap-4 border-t border-white/5 pt-4 mt-2 relative z-10">
                  <button
                    type="button"
                    onClick={() => setOpenTwinModal(false)}
                    className="flex-1 px-5 py-2.5 bg-[#1F2833]/40 border border-gray-800 text-gray-400 hover:text-gray-200 font-mono text-[10px] uppercase tracking-wider rounded-xl hover:bg-[#1F2833]/60 transition-all cursor-pointer text-center"
                  >
                    Exit Profile
                  </button>
                  <button
                    type="button"
                    onClick={handleStartTraining}
                    className="flex-1 px-5 py-2.5 bg-gradient-to-r from-[#8A2BE2] to-[#c084fc] hover:from-[#9d4edd] hover:to-[#d8bbff] text-white font-mono text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center shadow-[0_0_15px_rgba(138,43,226,0.2)] hover:shadow-[0_0_25px_rgba(138,43,226,0.35)] hover:scale-[1.01]"
                  >
                    Build Your Twin's Brain 🧠
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Header */}
                <div className="text-center border-b border-white/5 pb-4 mb-4 relative z-10">
                  <div className="text-4xl mb-2 select-none animate-bounce">🧠</div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-[#66FCF1] font-mono">
                    Calibrating Digital Brain
                  </h2>
                  <p className="text-[8px] text-gray-500 font-mono mt-1.5 uppercase tracking-widest">
                    Chronos Identity Scan Phase: Refinement
                  </p>
                </div>

                {/* Question Area & Conversation Log */}
                <div ref={trainingChatEndRef} className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4 mb-4 min-h-[160px] relative z-10">
                  {trainingHistory.length === 0 && trainingLoading ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                      <div className="w-8 h-8 border-2 border-t-transparent border-[#8A2BE2] rounded-full animate-spin" />
                      <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
                        Establishing neuro-link with AI core...
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Log of previous exchanges */}
                      <div className="space-y-3">
                        {trainingHistory.map((msg, idx) => (
                          <div 
                            key={idx} 
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div 
                              className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                                msg.role === 'user'
                                  ? 'bg-[#8A2BE2]/10 border border-[#8A2BE2]/30 text-purple-200'
                                  : 'bg-[#1F2833]/40 border border-gray-800 text-gray-300 font-mono text-[11px]'
                              }`}
                            >
                              <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mb-1 select-none">
                                {msg.role === 'user' ? username : 'Chronos Gateway'}
                              </div>
                              <p className="font-sans leading-relaxed">{msg.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Loading status */}
                      {trainingLoading && (
                        <div className="flex items-center gap-2 text-gray-500 text-[9px] font-mono uppercase tracking-wider animate-pulse">
                          <span>⚡</span>
                          <span>Processing responses...</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Input & Control Form */}
                <div className="border-t border-white/5 pt-4 mt-auto relative z-10">
                  <form onSubmit={handleSendTrainingAnswer} className="space-y-4">
                    <textarea
                      rows={2}
                      required
                      disabled={trainingLoading}
                      value={trainingInput}
                      onChange={e => setTrainingInput(e.target.value)}
                      placeholder="Type your response here..."
                      className="w-full bg-[#1F2833]/60 border border-gray-700 focus:border-[#8A2BE2]/40 rounded-xl p-4 text-xs font-sans focus:outline-none focus:ring-1 focus:ring-[#8A2BE2]/30 transition-all text-white placeholder-gray-600 resize-none disabled:opacity-50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendTrainingAnswer(e as any);
                        }
                      }}
                    />
                    <div className="flex justify-between items-center gap-4">
                      <button
                        type="button"
                        onClick={handleCompileTraining}
                        disabled={trainingLoading || trainingHistory.length === 0}
                        className="px-5 py-3 bg-green-950/30 border border-green-500/30 hover:border-green-500/50 hover:bg-green-950/50 text-green-400 font-mono text-[9px] uppercase tracking-wider rounded-xl transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Enough Questions
                      </button>
                      <button
                        type="submit"
                        disabled={trainingLoading || !trainingInput.trim()}
                        className="px-6 py-3 bg-gradient-to-r from-[#8A2BE2] to-[#c084fc] hover:from-[#9d4edd] hover:to-[#d8bbff] disabled:from-purple-950/20 disabled:to-purple-950/20 disabled:border-purple-800/30 disabled:text-purple-400 font-mono text-[9px] uppercase tracking-wider rounded-xl transition-all cursor-pointer border border-transparent flex items-center justify-center gap-1.5 shadow-[0_0_12px_rgba(138,43,226,0.15)] disabled:shadow-none"
                      >
                        {trainingLoading ? 'Analyzing...' : 'Submit Answer ⚡'}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Collapsed/Dead Task Acknowledgment Panel */}
      {deadTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-[#0B0C10]/95 border border-red-500/50 text-gray-100 shadow-[0_0_35px_rgba(239,68,68,0.3)] rounded-3xl w-full max-w-md p-8 relative flex flex-col items-center text-center space-y-4">
            <div className="text-5xl animate-bounce select-none">☄️</div>
            <h2 className="text-lg font-black uppercase tracking-widest text-red-500 font-mono">
              Nexus Event: Deadline Collapse
            </h2>
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
              Containment Failure Detected
            </p>
            <div className="p-4 bg-red-950/20 border border-red-500/20 rounded-2xl w-full font-mono text-left space-y-1">
              <div className="text-[9px] text-gray-500 uppercase tracking-widest">Collapsed Task</div>
              <div className="text-sm font-bold text-white leading-snug">{deadTask.title}</div>
              <div className="text-[8px] text-red-400 mt-2">DUE DATE PASSED: {new Date(deadTask.due).toLocaleString('en-GB')}</div>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed font-sans font-light">
              The temporal timeline for this task has collapsed. Acknowledging this collapse will log a Nexus Event in your twin profile telemetry.
            </p>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/api/tasks/${deadTask.id}/acknowledge_collapse`, {
                    method: 'POST'
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.failureCount !== undefined) {
                      setFailureCount(data.failureCount);
                      setStreakCount(data.streakCount || 0);
                    }
                    toast.error(`Nexus Event Logged: "${deadTask.title}" has collapsed.`);
                    setDeadTask(null);
                    fetchTasks(); // refresh task list
                  }
                } catch (e) {
                  console.error("Failed to acknowledge collapse", e);
                  setDeadTask(null);
                }
              }}
              className="w-full py-3 bg-gradient-to-r from-red-600 to-red-800 hover:opacity-90 text-white font-mono text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer font-bold shadow-[0_0_15px_rgba(239,68,68,0.3)] border border-transparent"
            >
              Acknowledge Collapse & Log Nexus Event ☄️
            </button>
          </div>
        </div>
      )}

      {/* Phone Link Setup Modal */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-[#0B0C10]/95 border border-[#0099FF]/30 text-gray-100 shadow-[0_0_35px_rgba(0,153,255,0.25)] rounded-3xl w-full max-w-md p-6 relative flex flex-col space-y-5 relative overflow-hidden">
            
            {/* Close button */}
            <button
              onClick={() => setShowPhoneModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors focus:outline-none text-base font-bold font-mono"
            >
              ✕
            </button>

            <div className="text-center space-y-1.5 pt-2">
              <span className="text-3xl block select-none">📱</span>
              <h2 className="text-base font-black uppercase tracking-widest text-[#0099FF] font-mono">
                Mobile Phone Link
              </h2>
              <p className="text-[8px] font-mono text-gray-500 uppercase tracking-widest">
                Establish Out-of-Band Warning Channel
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5 text-left">
                <label className="block text-[8px] font-mono font-bold uppercase tracking-widest text-gray-400">
                  1. ntfy Subscription Topic
                </label>
                <input
                  type="text"
                  value={ntfyTopic}
                  readOnly
                  placeholder="Generating topic..."
                  className="w-full rounded-lg px-4 py-2.5 text-xs bg-[#1F2833]/20 border border-gray-800 text-gray-400 focus:outline-none transition-all font-mono select-all cursor-not-allowed"
                />
                <p className="text-[7px] text-gray-500 leading-normal">
                  This unique subscription topic is randomly generated to secure your Out-of-Band warnings channel.
                </p>
              </div>

              {/* Connection instructions card */}
              <div className="p-3.5 bg-white/5 border border-white/10 rounded-2xl space-y-2 text-left">
                <span className="text-[#0099FF] font-mono text-[8px] font-bold uppercase tracking-wider block">
                  2. Install App & Subscribe
                </span>
                <ol className="list-decimal list-inside text-[8px] font-mono text-gray-400 space-y-1 pl-0.5 leading-relaxed">
                  <li>Download <span className="text-white font-bold">ntfy</span> app from Google Play or App Store.</li>
                  <li>Tap <span className="text-white font-bold">"Subscribe to topic"</span> inside the app.</li>
                  <li>Enter the exact topic name: <code className="text-[#c084fc] font-bold bg-[#1F2833] px-1 rounded">{ntfyTopic || '(empty)'}</code></li>
                  <li>Make sure notifications are enabled for ntfy.</li>
                </ol>
              </div>

              {/* Verification Status */}
              <div className="p-3.5 bg-black/40 border border-white/5 rounded-2xl text-left space-y-1.5">
                <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest block">
                  3. Verification Status
                </span>
                <div className="flex justify-between items-center">
                  <span className="text-[8px] font-mono text-gray-400">Status:</span>
                  {phoneTestSuccess === true ? (
                    <span className="px-2 py-0.5 rounded bg-green-950/40 border border-green-800/40 text-green-400 text-[8px] font-mono font-bold uppercase">
                      Verified Sync Online
                    </span>
                  ) : phoneTestSuccess === false ? (
                    <span className="px-2 py-0.5 rounded bg-red-950/40 border border-red-800/40 text-red-400 text-[8px] font-mono font-bold uppercase">
                      Verification Failed
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-500 text-[8px] font-mono uppercase">
                      Awaiting Diagnostic Test
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSavePhoneTopic}
                  disabled={phoneLoading}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 font-mono text-[8px] uppercase tracking-wider transition-all cursor-pointer text-center font-bold"
                >
                  Save Config
                </button>
                <button
                  type="button"
                  onClick={handleTestPhoneTopic}
                  disabled={phoneLoading}
                  className="flex-1 py-2.5 rounded-xl bg-[#0099FF] text-black font-mono text-[8px] uppercase tracking-wider transition-all cursor-pointer text-center font-black border border-transparent shadow-[0_0_15px_rgba(0,153,255,0.2)] hover:opacity-90"
                >
                  {phoneLoading ? "Transmitting..." : "⚡ Test Link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast container */}
      <Toaster />
      </div>
    </>
  );
}

'use client';
import { API_BASE } from "@/config";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ParticleBackground } from "../../page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export default function TwinProfilePage() {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [twin, setTwin] = useState<string>("");
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [username, setUsername] = useState<string>("user");

  // Refinement states
  const [isRefining, setIsRefining] = useState(false);
  const [refineHistory, setRefineHistory] = useState<any[]>([]);
  const [refineInput, setRefineInput] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineCount, setRefineCount] = useState(0);

  useEffect(() => {
    // Route Guard: Prevent skipping onboarding
    const savedName = localStorage.getItem("chronos-username");
    const savedTwin = localStorage.getItem("chronos-performance-twin");
    if (!savedName || !savedTwin) {
      router.push('/');
      return;
    }
    setIsTransitioning(false);
  }, []);

  const navigateTo = (path: string) => {
    setIsTransitioning(true);
    setTimeout(() => {
      router.push(path);
    }, 450);
  };

  useEffect(() => {
    const savedTwin = localStorage.getItem("chronos-performance-twin");
    if (savedTwin) {
      setTwin(savedTwin);
    } else {
      setTwin(`### PERFORMANCE TWIN PROFILE (DEMO)
- **Procrastination Risk**: MEDIUM
- **Peak Focus Window**: 8:00 PM - 12:00 AM
- **Primary Source of Delay**: Scope Creep & Perfectionism
- **Suggested Strategy**: 20-minute Micro-sprints with active cooldowns.`);
    }

    const savedConfig = localStorage.getItem("chronos-ai-config");
    if (savedConfig) {
      setAiConfig(JSON.parse(savedConfig));
    }

    const savedName = localStorage.getItem("chronos-username");
    if (savedName) {
      setUsername(savedName);
    }
  }, []);

  const handleStartRefining = async () => {
    setIsRefining(true);
    setRefineLoading(true);
    setRefineHistory([]);
    setRefineCount(0);

    const config = aiConfig || { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' };

    const initialPrompt = `You are Chronos, the AI onboarding guide. The user is refining their Performance Twin Profile.
Here is their current profile summary:
${twin}

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

      setRefineHistory([{ role: 'assistant', content: data.content }]);
      setRefineCount(1);
    } catch (err) {
      toast.error("Could not connect to AI core. Proceeding in offline mode.");
      setRefineHistory([{ role: 'assistant', content: "[Offline Mode] Tell me more about your peak focus hours or typical daily distractions." }]);
      setRefineCount(1);
    } finally {
      setRefineLoading(false);
    }
  };

  const handleSendRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refineInput.trim() || refineLoading) return;

    const userInput = refineInput.trim();
    setRefineInput("");
    setRefineLoading(true);

    const updatedHistory = [
      ...refineHistory,
      { role: 'user', content: userInput }
    ];
    setRefineHistory(updatedHistory);

    const config = aiConfig || { provider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' };

    if (refineCount >= 3) {
      // Compile final twin profile summary
      const compilePrompt = `You are Chronos, the AI onboarding guide.
The user has completed their twin profile refinement scanning session.
Here is the previous twin profile summary:
${twin}

Here are the scan logs:
${JSON.stringify(updatedHistory)}

Based on these answers, compile a new, updated Performance Twin Profile. Mention their name: ${username}.
Keep it concise (3-4 bullet points) and highlight specific focus windows and procrastination risks.
Start immediately with a markdown title "### PERFORMANCE TWIN PROFILE". Do not include greetings.`;

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
        setTwin(data.content);
        toast.success("Identity Scan complete. Twin model recalibrated successfully.");
        setIsRefining(false);
      } catch (err) {
        toast.error("Failed to compile final profile.");
      } finally {
        setRefineLoading(false);
      }
      return;
    }

    const nextPrompt = `You are Chronos, the AI onboarding guide. The user is answering diagnostic questions.
Here is the scan logs so far:
${JSON.stringify(updatedHistory)}

Please ask a follow-up diagnostic question (Question ${refineCount + 1} of 3) to probe deeper.
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

      setRefineHistory([
        ...updatedHistory,
        { role: 'assistant', content: data.content }
      ]);
      setRefineCount(prev => prev + 1);
    } catch (err) {
      toast.error("AI core offline. Refinement aborted.");
      setIsRefining(false);
    } finally {
      setRefineLoading(false);
    }
  };

  return (
    <>
      <ParticleBackground isPurpleMode={true} />
      <div 
        className={`min-h-screen text-gray-100 relative overflow-x-hidden flex flex-col font-sans select-none transition-all duration-500 ease-in-out ${
          isTransitioning 
            ? 'opacity-0 scale-[0.98] blur-[2px]' 
            : 'opacity-100 scale-100 blur-0'
        }`}
        style={{ backgroundColor: 'transparent' }}
      >
      <Toaster position="top-center" theme="dark" />

      {/* Centered Header */}
      <header className="grid grid-cols-3 h-20 items-center px-6 bg-transparent border-b border-white/5 relative z-10 backdrop-blur-md">
        <div>
          <span 
            className="text-[9px] font-mono tracking-widest uppercase text-gray-500 hover:text-gray-300 cursor-pointer transition-colors" 
            onClick={() => navigateTo('/dashboard')}
          >
            ← Back to Control
          </span>
        </div>

        <h1 
          className="text-center text-lg md:text-xl font-black tracking-[0.25em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-[#8A2BE2] to-[#c084fc]"
          style={{ textShadow: '0 0 15px rgba(138,43,226,0.25)' }}
        >
          Behavioral Twin
        </h1>

        <div className="flex items-center justify-end">
          <button
            onClick={() => navigateTo('/dashboard?settings=true')}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-gray-400 hover:text-white transition-all cursor-pointer flex items-center justify-center hover:rotate-90 duration-300"
            title="System Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 relative z-10 w-full max-w-2xl mx-auto">
        {!isRefining ? (
          <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-3xl w-full p-8 space-y-6">
            <div className="text-center border-b border-white/5 pb-4">
              <div className="text-4xl mb-2">👤</div>
              <h2 className="text-base font-bold uppercase tracking-widest text-[#8A2BE2]">
                {username}'s Twin Profile
              </h2>
              <p className="text-[9px] text-gray-500 font-mono mt-1 uppercase">
                Active Cognitive Behavior Model
              </p>
            </div>

            <div className="font-mono text-xs md:text-sm leading-relaxed whitespace-pre-wrap text-gray-300 bg-white/5 border border-white/5 rounded-2xl p-6 max-h-[350px] overflow-y-auto scrollbar-thin">
              {twin}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => navigateTo('/dashboard')}
                className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 transition-all cursor-pointer"
              >
                Exit Profile
              </button>
              <button
                onClick={handleStartRefining}
                className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-[#8A2BE2] hover:opacity-90 text-white transition-all cursor-pointer shadow-[0_0_15px_rgba(138,43,226,0.25)]"
              >
                Ask Extra Questions ⚡
              </button>
            </div>
          </Card>
        ) : (
          <Card className="bg-black/20 border border-white/[0.08] text-gray-100 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl rounded-3xl w-full p-8 space-y-6 text-center">
            <div className="border-b border-white/5 pb-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#8A2BE2] animate-pulse">
                Deeper Profile Scan Active
              </h2>
              <p className="text-[8px] text-gray-500 font-mono mt-1 uppercase tracking-widest">
                Gathering additional behavioral context
              </p>
            </div>

            <div className="py-6 min-h-[120px] flex items-center justify-center w-full">
              {refineLoading ? (
                <div className="space-y-4">
                  <div className="w-8 h-8 border-t-2 border-b-2 border-[#8A2BE2] rounded-full animate-spin mx-auto" />
                  <p className="text-[10px] text-[#8A2BE2] font-mono animate-pulse uppercase tracking-widest">
                    Syncing cognitive weights...
                  </p>
                </div>
              ) : (
                <p className="text-sm md:text-base text-[#c2fcf7]/95 font-medium leading-relaxed max-w-[90%]">
                  {refineHistory.length > 0 ? refineHistory[refineHistory.length - 1].content : "Loading query..."}
                </p>
              )}
            </div>

            <form onSubmit={handleSendRefine} className="space-y-4">
              <input
                type="text"
                required
                disabled={refineLoading}
                value={refineInput}
                onChange={e => setRefineInput(e.target.value)}
                placeholder="Type your response..."
                className="w-full rounded-xl px-5 py-3.5 text-xs text-center focus:ring-1 focus:ring-[#8A2BE2] focus:outline-none transition-colors border border-white/10 placeholder-gray-600 bg-white/5 text-[#c084fc]"
              />

              <div className="flex gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRefining(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-red-950/20 border border-red-900/25 hover:bg-red-900/30 text-red-400 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refineLoading}
                  className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-[#8A2BE2] hover:opacity-90 text-white transition-all cursor-pointer shadow-[0_0_15px_rgba(138,43,226,0.25)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Submit Response
                </button>
              </div>
            </form>
          </Card>
        )}
      </main>
      </div>
    </>
  );
}

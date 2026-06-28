'use client';
import { API_BASE } from "@/config";

import { useState, useEffect } from "react";
import { useRouter } from 'next/navigation';
import { ParticleBackground } from "../../page";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export default function PhoneLinkPage() {
  const router = useRouter();
  const [ntfyTopic, setNtfyTopic] = useState<string>("chronos-alerts-user");
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(true);

  useEffect(() => {
    setIsTransitioning(false);
    // Load from backend settings or localStorage
    fetch(`${API_BASE}/api/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.ntfyTopic) {
          setNtfyTopic(data.ntfyTopic);
        }
      })
      .catch(() => {
        const saved = localStorage.getItem("chronos-ntfy-topic");
        if (saved) setNtfyTopic(saved);
      });
  }, []);

  const handleSave = async () => {
    if (!ntfyTopic.trim()) {
      toast.error("Topic name cannot be empty.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ntfyTopic: ntfyTopic
        })
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
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!ntfyTopic.trim()) {
      toast.error("Set a topic name first.");
      return;
    }

    setLoading(true);
    setTestSuccess(null);
    try {
      const res = await fetch(`https://ntfy.sh/${ntfyTopic}`, {
        method: 'POST',
        headers: {
          'Title': 'Chronos Synchronization',
          'Priority': 'high'
        },
        body: 'Chronos Phone Link successfully verified! Real-time telemetry alerts are now active.'
      });
      if (res.ok) {
        setTestSuccess(true);
        toast.success("Verification notification dispatched successfully!");
      } else {
        setTestSuccess(false);
        toast.error("Failed to reach notification broker.");
      }
    } catch (err) {
      setTestSuccess(false);
      toast.error("Network error. Verify internet connectivity.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        body { background: #0B0C10; font-family: 'Inter', sans-serif; }
        .glow-border {
          box-shadow: 0 0 15px rgba(0, 153, 255, 0.2);
          border-color: rgba(0, 153, 255, 0.3);
        }
        .glow-border:hover {
          box-shadow: 0 0 25px rgba(0, 153, 255, 0.35);
          border-color: rgba(0, 153, 255, 0.5);
        }
      `}</style>

      <ParticleBackground theme="dashboard" state="idle" />

      {/* Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center px-8 gap-6 bg-black/40 backdrop-blur-md border-b border-white/5">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-[9px] font-mono tracking-widest uppercase text-gray-500 hover:text-gray-300 cursor-pointer transition-colors"
        >
          ← Return to Control
        </button>
        <div className="h-4 w-[1px] bg-white/10" />
        <span className="text-[9px] font-mono tracking-widest uppercase text-[#0099FF]">
          Phone Link Setup & Verification Wizard
        </span>
      </header>

      <main
        className={`min-h-screen flex items-center justify-center p-6 transition-all duration-700 ${
          isTransitioning ? 'opacity-0 scale-[0.97]' : 'opacity-100 scale-100'
        }`}
      >
        <div className="w-full max-w-lg bg-[#0B0C10]/80 border border-[#0099FF]/20 p-8 rounded-3xl backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] space-y-6 relative z-10">
          <div className="text-center space-y-2">
            <span className="text-4xl block select-none">📱</span>
            <h1 className="text-xl font-black uppercase tracking-widest text-[#0099FF]">
              Mobile Phone Link
            </h1>
            <p className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">
              Establish Out-of-Band Warning Channel
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5 text-left">
              <label className="block text-[9px] font-mono font-bold uppercase tracking-widest text-gray-400">
                1. Choose ntfy Subscription Topic
              </label>
              <input
                type="text"
                value={ntfyTopic}
                onChange={e => setNtfyTopic(e.target.value.trim())}
                placeholder="e.g. chronos-alerts-operator"
                className="w-full rounded-lg px-4 py-2.5 text-xs bg-[#1F2833]/40 border border-gray-700 text-gray-200 focus:outline-none focus:border-[#0099FF]/40 transition-all font-mono"
              />
              <p className="text-[8px] text-gray-500 leading-normal">
                Avoid generic names so your alerts are private and not intercepted by other clients.
              </p>
            </div>

            {/* Connection instructions card */}
            <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3 text-left">
              <span className="text-[#0099FF] font-mono text-[9px] font-bold uppercase tracking-wider block">
                2. Install App & Subscribe
              </span>
              <ol className="list-decimal list-inside text-[9px] font-mono text-gray-400 space-y-1.5 pl-0.5">
                <li>Download the free <span className="text-white font-bold">ntfy</span> application from Google Play (Android) or App Store (iOS).</li>
                <li>Tap <span className="text-white font-bold">"Subscribe to topic"</span> inside the app.</li>
                <li>Enter the exact topic name: <code className="text-[#c084fc] font-bold bg-[#1F2833] px-1 rounded">{ntfyTopic || '(empty)'}</code></li>
                <li>Make sure notifications are enabled in your mobile phone settings for the ntfy app.</li>
              </ol>
            </div>

            {/* Verification Status */}
            <div className="p-4 bg-black/40 border border-white/5 rounded-2xl text-left space-y-2">
              <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest block">
                3. Verification & Diagnostic Test
              </span>
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-mono text-gray-400">Status:</span>
                {testSuccess === true ? (
                  <span className="px-2 py-0.5 rounded bg-green-950/40 border border-green-800/40 text-green-400 text-[8px] font-mono font-bold uppercase">
                    Verified Sync Online
                  </span>
                ) : testSuccess === false ? (
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
            <div className="flex flex-col md:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 font-mono text-[9px] uppercase tracking-wider transition-all cursor-pointer text-center font-bold"
              >
                Save Topic Config
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={loading}
                className="flex-1 py-3 rounded-xl bg-[#0099FF] text-black font-mono text-[9px] uppercase tracking-wider transition-all cursor-pointer text-center font-black glow-border border border-transparent"
              >
                {loading ? "Transmitting..." : "⚡ Verify & Test Link"}
              </button>
            </div>
          </div>
        </div>
      </main>
      <Toaster />
    </>
  );
}

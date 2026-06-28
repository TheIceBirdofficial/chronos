"use client";
import { API_BASE } from "@/config";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

// SettingsMenu component – appears on every page (included via RootLayout)
// Provides three tabs: AI Core, Digital Twin, Developer.
// AI Core shows connection status, API key, model, and a simple recommendation.
// Digital Twin is left as a placeholder (as requested).
// Developer tab lets the user set a "Singularity Phase" override and perform an "Instant Bypass"
// which records a short summary of the user ("ME") into the twin's brain (saved in localStorage).

export default function SettingsMenu() {
  // Determine which page we are on – Next.js provides the current pathname.
  const pathname = usePathname();
  // Helper booleans for the four logical views.
  const isRoot = pathname === '/' || pathname === '';
  const isDashboard = pathname.startsWith('/dashboard');
  // In the dashboard component the "debrief" view is a tab, not a route. We expose a simple
  // check: if the URL contains "debrief" (e.g. /dashboard?view=debrief) we treat it as the debrief view.
  const isDebrief = pathname.includes('debrief');
  const isNonUser = isRoot && (!localStorage.getItem('chronos-username') || localStorage.getItem('chronos-username') === 'user');
  const isUser = isRoot && !!localStorage.getItem('chronos-username') && localStorage.getItem('chronos-username') !== 'user';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'ai' | 'twin' | 'dev'>('ai');
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [devPhase, setDevPhase] = useState<'offline' | 'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [bypassSummary, setBypassSummary] = useState('');
  // Detect if the current page is scrollable (i.e., taller than the viewport).
  const [isScrollable, setIsScrollable] = useState(false);
  useEffect(() => {
    const checkScrollable = () => {
      const doc = document.documentElement;
      setIsScrollable(doc.scrollHeight > window.innerHeight);
    };
    // Initial check
    checkScrollable();
    // Re‑check on resize and scroll events
    window.addEventListener('resize', checkScrollable);
    window.addEventListener('scroll', checkScrollable);
    return () => {
      window.removeEventListener('resize', checkScrollable);
      window.removeEventListener('scroll', checkScrollable);
    };
  }, []);
  // Edge‑case: content may load after mount (e.g., async data). Keep polling a few times until we detect scroll.
  useEffect(() => {
    if (isScrollable) return;
    const interval = setInterval(() => {
      const doc = document.documentElement;
      if (doc.scrollHeight > window.innerHeight) {
        setIsScrollable(true);
        clearInterval(interval);
      }
    }, 500); // check every 0.5s
    return () => clearInterval(interval);
  }, [isScrollable]);
  // When the Settings modal is open, prevent background scrolling.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }, [open]);

  // Load AI config from localStorage on mount (same source used by the main page)
  useEffect(() => {
    const stored = localStorage.getItem('chronos-ai-config');
    if (stored) {
      try {
        setAiConfig(JSON.parse(stored));
      } catch (e) {
        console.warn('Failed to parse ai config', e);
      }
    }
  }, []);

  // Simple connection check – tries to fetch model list from backend.
  const checkConnection = async () => {
    setConnectionStatus('checking');
    try {
      const res = await fetch(`${API_BASE}/api/ai/models`);
      if (res.ok) {
        setConnectionStatus('online');
      } else {
        setConnectionStatus('offline');
      }
    } catch (e) {
      setConnectionStatus('offline');
    }
  };

  // Run connection check when the AI tab is opened.
  useEffect(() => {
    if (open && tab === 'ai') {
      checkConnection();
    }
  }, [open, tab]);

  // Developer actions -------------------------------------------------------
  const applyPhaseOverride = () => {
    localStorage.setItem('chronos-dev-phase', devPhase);
    alert(`Singularity phase set to ${devPhase}`);
  };

  const instantBypass = () => {
    const summary = bypassSummary.trim() || 'User summary: (no input provided)';
    localStorage.setItem('chronos-instant-bypass', summary);
    alert('Instant bypass stored in twin brain');
  };

  // Render ---------------------------------------------------------------
  return (
    <>
      {/* Gear button – positioning changes based on page scrollability */}
      <div
        className={
          isScrollable
            ? "z-30 flex items-center w-full justify-end p-4"
: "z-30 flex items-center fixed top-12 right-12"
        }
      >
        <button
          onClick={() => setOpen(!open)}
          className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-purple-950/20 text-gray-400 hover:text-white transition-all cursor-pointer flex items-center justify-center"
          title="System Configuration"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>

      {/* Modal – appears when open is true */}
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
          <div className="relative w-full max-w-lg bg-[#0B0C10]/95 border border-white/[0.08] rounded-3xl p-6 shadow-[0_8px_32px_0_rgba(138,43,226,0.4)] backdrop-blur-xl space-y-5">
            <div className="flex justify-between items-start pb-2 border-b border-gray-900">
              <h2 className="text-base font-bold uppercase tracking-wider text-[#8A2BE2]">Chronos Settings</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-200 text-xs font-bold cursor-pointer">✕</button>
            </div>

            {/* Tab selector */}
            <div className="flex border-b border-white/5 pb-2 gap-4">
              <button
                type="button"
                onClick={() => setTab('ai')}
                className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${tab === 'ai' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'}`}
              >
                AI Core
              </button>
              <button
                type="button"
                onClick={() => setTab('twin')}
                className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${tab === 'twin' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'}`}
              >
                Digital Twin
              </button>
              <button
                type="button"
                onClick={() => setTab('dev')}
                className={`pb-1 text-xs font-bold uppercase tracking-wider transition-all focus:outline-none cursor-pointer ${tab === 'dev' ? 'text-[#8A2BE2] border-b-2 border-[#8A2BE2]' : 'text-gray-500 hover:text-gray-300'}`}
              >
                Developer
              </button>
            </div>

            {/* Tab contents */}
            <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 scrollbar-thin">
              {tab === 'ai' && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#06C6B3] border-b border-white/5 pb-1">AI Core Status</h3>
                  <div className="flex items-center justify-between bg-black/30 px-4 py-2.5 rounded-xl border border-white/5">
                    <span className="text-[9px] font-mono tracking-wider text-gray-500 uppercase">Connection:</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-widest uppercase border ${connectionStatus === 'offline' ? 'bg-red-950/40 border-red-800 text-red-400' : connectionStatus === 'checking' ? 'bg-gray-950/40 border-gray-800 text-gray-400' : 'bg-green-950/40 border-green-800 text-green-400'}`}
                    >
                      {connectionStatus === 'checking' ? 'Checking…' : connectionStatus === 'online' ? '🟢 Online' : '🔴 Offline'}
                    </span>
                  </div>
                  {aiConfig && (
                    <div className="space-y-2 text-sm">
                      <p><strong>Provider:</strong> {aiConfig.provider}</p>
                      <p><strong>Model:</strong> {aiConfig.model}</p>
                      <p><strong>API URL:</strong> {aiConfig.apiUrl}</p>
                      <p><strong>API Key:</strong> {aiConfig.apiKey ? '[REDACTED]' : '(none)'}</p>
                      {/* Simple recommendation based on provider */}
                      <p><strong>Recommendation:</strong> {aiConfig.provider === 'ollama' ? 'Run local Ollama server for best latency.' : aiConfig.provider === 'gemini' ? 'Check quota limits on Google AI.' : aiConfig.provider === 'nvidia' ? 'Ensure NVIDIA NIM token is active.' : 'Verify custom endpoint.'}</p>
                    </div>
                  )}
                  <button
                    onClick={checkConnection}
                    className="mt-2 px-3 py-1.5 text-xs bg-[#8A2BE2]/20 border border-[#8A2BE2] rounded hover:bg-[#8A2BE2]/30"
                  >
                    Re‑check Connection
                  </button>
                </div>
              )}

              {tab === 'twin' && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-400">Digital Twin settings are managed elsewhere. No changes needed here.</p>
                </div>
              )}

              {tab === 'dev' && (
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#06C6B3]">Singularity Phase Override</h3>
                  <select
                    value={devPhase}
                    onChange={e => setDevPhase(e.target.value as any)}
                    className="w-full rounded-lg px-3 py-2 text-xs bg-black/30 border border-gray-800 text-gray-200 focus:outline-none"
                  >
                    <option value="offline">offline</option>
                    <option value="idle">idle</option>
                    <option value="listening">listening</option>
                    <option value="thinking">thinking</option>
                    <option value="speaking">speaking</option>
                  </select>
                  <button
                    onClick={applyPhaseOverride}
                    className="w-full px-3 py-1.5 text-xs bg-[#8A2BE2]/20 border border-[#8A2BE2] rounded hover:bg-[#8A2BE2]/30"
                  >
                    Apply Override
                  </button>

                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#06C6B3] mt-4">Instant Bypass (Onboarding)</h3>
                  <textarea
                    placeholder="Enter a short summary of you (ME) …"
                    value={bypassSummary}
                    onChange={e => setBypassSummary(e.target.value)}
                    className="w-full h-20 rounded-lg p-2 text-xs bg-black/30 border border-gray-800 text-gray-200 focus:outline-none"
                  ></textarea>
                  <button
                    onClick={instantBypass}
                    className="w-full px-3 py-1.5 text-xs bg-[#8A2BE2]/20 border border-[#8A2BE2] rounded hover:bg-[#8A2BE2]/30"
                  >
                    Store Summary (Instant Bypass)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

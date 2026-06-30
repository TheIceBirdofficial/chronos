'use client';

interface SettingsGearProps {
  isOffline: boolean;
  onClick: () => void;
}

export default function SettingsGear({ isOffline, onClick }: SettingsGearProps) {
  return (
    <div className="relative flex items-center">
      {isOffline && (
        <div className="absolute inset-0 pointer-events-none z-0 scale-150">
          <span className="absolute w-1 h-1 bg-red-500 rounded-full animate-ping opacity-60" style={{ top: '-6px', left: '50%', animationDelay: '0s' }} />
          <span className="absolute w-1 h-1 bg-red-500 rounded-full animate-ping opacity-45" style={{ bottom: '-6px', right: '15%', animationDelay: '0.4s' }} />
          <span className="absolute w-1 h-1 bg-red-500 rounded-full animate-ping opacity-30" style={{ left: '-6px', top: '30%', animationDelay: '0.8s' }} />
        </div>
      )}
      <button
        onClick={onClick}
        className={`p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-purple-950/20 text-gray-400 hover:text-white transition-all cursor-pointer flex items-center justify-center hover:rotate-90 duration-300 focus:outline-none z-10 ${
          isOffline
            ? 'border-red-500/40 hover:border-red-500/70 hover:shadow-[0_0_15px_rgba(239,68,68,0.25)]'
            : 'hover:border-[#8A2BE2]/40 hover:shadow-[0_0_15px_rgba(138,43,226,0.15)]'
        }`}
        title="System Configuration"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      {isOffline && (
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" title="Core Supplier Offline"></span>
        </span>
      )}
    </div>
  );
}

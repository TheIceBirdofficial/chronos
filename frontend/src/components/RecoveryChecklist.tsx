import React, { useState, useEffect } from 'react';

interface Props {
  taskId: string;
  items: string[];
  onAllChecked: () => void;
  onProgressChange: (progress: number) => void;
}

export default function RecoveryChecklist({ taskId, items, onAllChecked, onProgressChange }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!taskId || !items.length) return;
    const storageKey = `chronos-recovery-checklist-${taskId}`;
    const saved = localStorage.getItem(storageKey);
    let initialChecked: Record<string, boolean> = {};

    if (saved) {
      try {
        initialChecked = JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved checklist state', e);
      }
    }

    // Ensure all current checklist items have a boolean entry
    const mergedChecked: Record<string, boolean> = {};
    items.forEach(item => {
      mergedChecked[item] = !!initialChecked[item];
    });

    setChecked(mergedChecked);
  }, [taskId, items]);

  useEffect(() => {
    if (!items.length) return;
    const checkedCount = items.filter(item => checked[item]).length;
    const totalCount = items.length;
    const progress = Math.round((checkedCount / totalCount) * 100);
    onProgressChange(progress);

    if (checkedCount === totalCount && totalCount > 0) {
      onAllChecked();
    }
  }, [checked, items, onAllChecked, onProgressChange]);

  const toggle = (item: string) => {
    const updated = { ...checked, [item]: !checked[item] };
    setChecked(updated);
    if (taskId) {
      localStorage.setItem(`chronos-recovery-checklist-${taskId}`, JSON.stringify(updated));
    }
  };

  return (
    <div className="mt-4">
      <div className="text-xs font-bold uppercase tracking-widest text-[#66FCF1] mb-2 font-mono">Checklist</div>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 bg-black/20 p-2.5 rounded-xl border border-white/5 font-mono text-xs">
            <input
              type="checkbox"
              className="mt-0.5 rounded accent-[#66FCF1] cursor-pointer"
              checked={!!checked[item]}
              onChange={() => toggle(item)}
            />
            <span className={checked[item] ? 'line-through text-gray-505 text-gray-500' : 'text-gray-200'}>
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}


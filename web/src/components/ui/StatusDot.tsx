import React from 'react';

export const StatusDot: React.FC<{
  tone?: 'success' | 'error' | 'warning' | 'muted';
  pulse?: boolean;
}> = ({ tone = 'success', pulse = false }) => {
  const tones = {
    success: 'bg-emerald-500',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    muted: 'bg-neutral-300',
  } as const;
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${tones[tone]}`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${tones[tone]}`} />
    </span>
  );
};

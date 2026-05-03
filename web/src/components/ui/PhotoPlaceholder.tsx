import React from 'react';

// Striped placeholder — POC spec stores image URLs but never downloads them.
export const PhotoPlaceholder: React.FC<{ id: string; className?: string; label?: string }> = ({
  id,
  className,
  label = 'photo',
}) => {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = (h % 60) + 160;
  return (
    <div
      className={`relative overflow-hidden rounded-sm bg-neutral-100 ${className ?? ''}`}
      style={{
        backgroundImage: `repeating-linear-gradient(135deg, oklch(0.95 0.02 ${hue}) 0 6px, oklch(0.92 0.02 ${hue}) 6px 12px)`,
      }}
    >
      <div className="absolute inset-0 flex items-end p-2">
        <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-600">
          {label}
        </span>
      </div>
    </div>
  );
};

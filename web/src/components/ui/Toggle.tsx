import React from 'react';

export const Toggle: React.FC<{
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}> = ({ checked, disabled, onChange }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange?.(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
      checked ? 'bg-accent' : 'bg-neutral-200'
    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    aria-pressed={checked}
  >
    <span
      className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
      style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
    />
  </button>
);

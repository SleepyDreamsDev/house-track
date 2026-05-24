import React from 'react';

interface Feature {
  featureId: number;
  label: string;
}

interface BooleanFieldProps {
  features: Feature[];
  activeFeatureIds: number[];
  onToggle: (featureId: number) => void;
}

export const BooleanField: React.FC<BooleanFieldProps> = ({
  features,
  activeFeatureIds,
  onToggle,
}) => (
  <div className="flex flex-wrap gap-1.5">
    {features.map((feat) => {
      const active = activeFeatureIds.includes(feat.featureId);
      return (
        <button
          key={feat.featureId}
          type="button"
          onClick={() => onToggle(feat.featureId)}
          className={`rounded-sm px-2 py-0.5 text-[11px] border transition-colors ${
            active
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
          }`}
        >
          {feat.label}
        </button>
      );
    })}
  </div>
);

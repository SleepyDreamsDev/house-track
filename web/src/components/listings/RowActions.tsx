import React from 'react';

// Favorite (★) + exclude (✕) toggles shared by the listings table, the
// listings card view, and the analytics Best-buys table so the action set
// stays identical everywhere. Stops click propagation so it never triggers a
// row/card select or navigation.
export const RowActions: React.FC<{
  id: string;
  watchlist?: boolean | undefined;
  excluded?: boolean | undefined;
  onToggleFavorite?: ((id: string, next: boolean) => void) | undefined;
  onToggleExclude?: ((id: string, next: boolean) => void) | undefined;
}> = ({ id, watchlist, excluded, onToggleFavorite, onToggleExclude }) => {
  if (!onToggleFavorite && !onToggleExclude) return null;
  return (
    <div className="flex items-center gap-1.5">
      {onToggleFavorite && (
        <button
          type="button"
          aria-label={watchlist ? 'Remove favorite' : 'Add favorite'}
          title={watchlist ? 'Remove favorite' : 'Add favorite'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite(id, !watchlist);
          }}
          className={`text-base leading-none ${watchlist ? 'text-amber-500' : 'text-neutral-300 hover:text-neutral-500'}`}
        >
          {watchlist ? '★' : '☆'}
        </button>
      )}
      {onToggleExclude && (
        <button
          type="button"
          aria-label={excluded ? 'Unexclude' : 'Exclude'}
          title={excluded ? 'Unexclude' : 'Exclude'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleExclude(id, !excluded);
          }}
          className={`text-[11px] leading-none rounded-sm border px-1.5 py-0.5 font-medium transition-colors ${excluded ? 'border-error/40 bg-error/10 text-error' : 'border-neutral-300 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600'}`}
        >
          ✕
        </button>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { PhotoPlaceholder } from './PhotoPlaceholder.js';

// Renders a listing's primary photo straight from 999's CDN. Falls back to the
// striped PhotoPlaceholder when there is no image or the CDN load fails (e.g.
// the listing was deleted from 999 and its image 404s). referrerPolicy is
// no-referrer so the request carries no foreign-origin tell; loading=lazy keeps
// off-screen rows from fetching.
export const ListingThumb: React.FC<{
  id: string;
  src: string | null | undefined;
  className?: string;
  label?: string;
  alt?: string;
}> = ({ id, src, className, label, alt }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <PhotoPlaceholder
        id={id}
        {...(className ? { className } : {})}
        {...(label ? { label } : {})}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`rounded-sm bg-neutral-100 object-cover ${className ?? ''}`}
    />
  );
};

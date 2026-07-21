import type { CSSProperties } from 'react';

// Official fatsecret attribution badge, required by the fatsecret Platform
// API Terms of Use (Premier Free tier). The two snippets below are the
// UNMODIFIED badge HTML from https://platform.fatsecret.com/attribution —
// brand for light backgrounds, dark for dark backgrounds (the same pairing
// the mobile app uses). Do not edit the snippet markup, and "fatsecret" must
// always be written in lowercase in any text mention.
export const FATSECRET_BADGE_HTML = `<a href="https://platform.fatsecret.com"><img alt="Nutrition information provided by fatsecret Platform API" src="https://platform.fatsecret.com/api/static/images/powered_by_fatsecret_horizontal_brand.svg" border="0"/></a>`;
export const FATSECRET_BADGE_HTML_DARK = `<a href="https://platform.fatsecret.com"><img alt="Nutrition information provided by fatsecret Platform API" src="https://platform.fatsecret.com/api/static/images/powered_by_fatsecret_horizontal_dark.svg" border="0"/></a>`;

// Renders both official variants; CSS (.fatsecret-badge in globals.css)
// shows the one matching the active theme and sizes the image via
// --fs-badge-h. The badge markup itself is injected verbatim.
export function FatsecretBadge({
  height = 20,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={`fatsecret-badge ${className ?? ''}`}
      style={{ '--fs-badge-h': `${height}px` } as CSSProperties}
    >
      <span className="fs-brand" dangerouslySetInnerHTML={{ __html: FATSECRET_BADGE_HTML }} />
      <span className="fs-dark" dangerouslySetInnerHTML={{ __html: FATSECRET_BADGE_HTML_DARK }} />
    </span>
  );
}

export default FatsecretBadge;

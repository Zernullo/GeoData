/**
 * Header component - Application branding and metadata display.
 */

export function Header() {
  return (
    <header className="border-b border-dark-border pb-6 mb-8 animate-slideDown">
      <div className="flex items-baseline gap-4 mb-2 flex-wrap">
        <h1 className="header-primary relative">
          GEODATA
          <span className="absolute -top-1 -right-2 text-xs text-green animate-pulse">●</span>
        </h1>
        <span className="header-secondary">v2.0 // EXIF INTELLIGENCE</span>
      </div>
      <p className="label-text flex items-center gap-2">
        METADATA EXTRACTION & PRIVACY RISK ANALYSIS
        <span className="cursor::after inline-block" />
      </p>
    </header>
  );
}
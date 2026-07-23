import { FatsecretBadge } from '@/components/FatsecretBadge';

// Global site footer. Carries the fatsecret attribution required by the
// fatsecret Platform API Terms of Use (Premier Free tier): the official Web
// Badge, unmodified, linked to platform.fatsecret.com (see FatsecretBadge).
// "fatsecret" must always be written in lowercase.
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t-2 border-border">
      <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
        <div className="text-center text-sm font-semibold text-muted sm:text-left">
          <p>&copy; {new Date().getFullYear()} Mealspire</p>
          <p className="mt-1">Powered by fatsecret Platform API</p>
        </div>
        <FatsecretBadge height={22} />
      </div>
    </footer>
  );
}

export default SiteFooter;

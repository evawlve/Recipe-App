// Global site footer. Carries the fatsecret attribution required by the
// fatsecret Platform API Terms of Use (Premier Free tier): the official Web
// Badge, unmodified, linked to platform.fatsecret.com. Do not edit the badge
// markup — the snippet must match https://platform.fatsecret.com/attribution
// exactly, and "fatsecret" must always be written in lowercase.
const FATSECRET_BADGE_HTML = `<a href="https://platform.fatsecret.com"><img alt="Nutrition information provided by fatsecret Platform API" src="https://platform.fatsecret.com/api/static/images/powered_by_fatsecret_horizontal_brand.svg" border="0"/></a>`;

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-12">
      <div className="container mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground text-center sm:text-left">
          <p>&copy; {new Date().getFullYear()} Mealspire</p>
          <p className="mt-1">Nutrition data provided in part by fatsecret.</p>
        </div>
        <div dangerouslySetInnerHTML={{ __html: FATSECRET_BADGE_HTML }} />
      </div>
    </footer>
  );
}

export default SiteFooter;

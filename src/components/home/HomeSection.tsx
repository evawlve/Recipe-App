import Link from 'next/link';

export function HomeSection({ 
  title, 
  children, 
  href 
}: { 
  title: string; 
  children: React.ReactNode; 
  href?: string 
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm text-primary hover:underline">
            See all
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

import Link from 'next/link';
import Image from 'next/image';

export function CategoryTile({
  label, 
  slug, 
  imageSrc,
}: { 
  label: string; 
  slug: string; 
  imageSrc: string; 
}) {
  const href = `/recipes?tags=${encodeURIComponent(slug)}`;
  
  return (
    <Link href={href} className="group block">
      <div className="aspect-[16/12] overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
        <Image
          src={imageSrc}
          alt={label}
          width={300}
          height={225}
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
        />
      </div>
      <div className="mt-2 text-sm font-medium">{label}</div>
    </Link>
  );
}

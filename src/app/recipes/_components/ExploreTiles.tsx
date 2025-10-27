import Link from 'next/link';
import Image from 'next/image';

const mealType = [
  { label:'Breakfast', slug:'breakfast', image:'/images/cat/breakfast.png' },
  { label:'Lunch',     slug:'lunch',     image:'/images/cat/lunch.png' },
  { label:'Dinner',    slug:'dinner',    image:'/images/cat/dinner.png' },
  { label:'Snacks',    slug:'snack',     image:'/images/cat/snacks.png' },
  { label:'Desserts',  slug:'dessert',   image:'/images/cat/dessert.png' },
  { label:'Drinks',    slug:'drinks',    image:'/images/cat/drinks.png' },
];

const cuisine = [
  { label:'Mexican', slug:'mexican', image:'/images/cat/mexican.png' },
  { label:'Italian', slug:'italian', image:'/images/cat/italian.png' },
  { label:'American',slug:'american',image:'/images/cat/american.png' },
  { label:'Japanese', slug:'japanese', image:'/images/cat/japanese.png' },
  { label:'Greek', slug:'greek', image:'/images/cat/greek.png' },
  { label:'Chinese', slug:'chinese', image:'/images/cat/chinese.png' },
];

function Tile({label,slug,image}:{label:string;slug:string;image:string}) {
  return (
    <Link href={`/recipes?tags=${encodeURIComponent(slug)}`} className="group block">
      <div className="aspect-[16/12] overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
        <Image
          src={image}
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

export function ExploreTiles() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-base font-semibold">Explore by Category</h3>
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {mealType.map(t => <Tile key={t.slug} {...t} />)}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-base font-semibold">Explore by Cuisine</h3>
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {cuisine.map(t => <Tile key={t.slug} {...t} />)}
        </div>
      </div>
    </div>
  );
}

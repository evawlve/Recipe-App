import { RecipeCard } from "@/components/recipe/RecipeCard";
import { Card } from "@/components/ui/card";

interface RecipeItem {
  id: string;
  title: string;
  createdAt: Date;
  author: { 
    id: string;
    name: string | null; 
    username: string | null; 
    displayName: string | null; 
    avatarKey: string | null; 
  };
  photos: Array<{
    id: string;
    s3Key: string;
    width: number;
    height: number;
  }>;
}

interface RecipeGridProps {
  items: RecipeItem[];
  currentUserId?: string | null;
}

export default function RecipeGrid({ items, currentUserId }: RecipeGridProps) {
  if (items.length === 0) {
    return (
      <Card className="rounded-2xl border border-border bg-card shadow-sm p-12">
        <div className="text-center">
          <div className="text-6xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-foreground mb-2">No recipes yet</h3>
          <p className="text-muted-foreground">
            Start creating or saving recipes to see them here.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {items.map((item) => (
        <RecipeCard
          key={item.id}
          recipe={{
            id: item.id,
            title: item.title,
            bodyMd: "",
            servings: 1,
            prepTime: null,
            authorId: item.author.id,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
            parentId: null,
            photos: item.photos,
            nutrition: null,
            author: item.author,
            _count: { likes: 0, comments: 0 }
          }}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}

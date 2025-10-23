"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecipeCard = RecipeCard;
const link_1 = __importDefault(require("next/link"));
const image_1 = __importDefault(require("next/image"));
const card_1 = require("@/components/ui/card");
const images_1 = require("@/lib/images");
const SaveButton_1 = __importDefault(require("./SaveButton"));
const AuthorLink_1 = require("./AuthorLink");
function RecipeCard({ recipe, currentUserId }) {
    const primaryImageUrl = recipe.photos.length > 0 ? (0, images_1.imageSrcForKey)(recipe.photos[0].s3Key) : null;
    const nutrition = recipe.nutrition;
    return (<card_1.Card className="hover:shadow-lg transition-shadow h-full flex flex-col">
      <link_1.default href={`/recipes/${recipe.id}`} className="flex flex-col h-full">
        <div className="relative w-full h-48 overflow-hidden rounded-lg bg-secondary" aria-hidden style={{ position: 'relative' }}>
          {primaryImageUrl ? (<image_1.default src={primaryImageUrl} alt={recipe.title} width={400} height={192} priority={true} className="object-cover w-full h-full" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"/>) : (<div className="h-full w-full grid place-items-center text-muted">No image</div>)}
        </div>
        
        <card_1.CardHeader className="pb-2 flex-shrink-0">
          <card_1.CardTitle className="line-clamp-2 text-lg">{recipe.title}</card_1.CardTitle>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <AuthorLink_1.AuthorLink author={recipe.author} currentUserId={currentUserId} size="sm" showAvatar={true} useButton={true}/>
            <span>{new Date(recipe.createdAt).toLocaleDateString()}</span>
          </div>
        </card_1.CardHeader>
        
        <card_1.CardContent className="pt-0 flex-shrink-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-3 text-muted-foreground">
              {nutrition && (<div className="flex items-center gap-2">
                  <span>{nutrition.calories} cal</span>
                  <span>•</span>
                  <span>{nutrition.proteinG.toFixed(1)}g protein</span>
                </div>)}
              {typeof recipe._count?.likes === 'number' && (<span>❤ {recipe._count.likes}</span>)}
              {typeof recipe._count?.comments === 'number' && (<span>💬 {recipe._count.comments}</span>)}
            </div>
          </div>
          
        </card_1.CardContent>
      </link_1.default>
      
      {/* Save button outside of Link to prevent navigation */}
      <div className="mt-3 flex justify-end px-6 pb-4">
        <SaveButton_1.default recipeId={recipe.id} initiallySaved={recipe.savedByMe || false} variant="small" isAuthenticated={Boolean(currentUserId)}/>
      </div>
    </card_1.Card>);
}

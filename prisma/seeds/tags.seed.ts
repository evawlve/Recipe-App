import { PrismaClient, TagNamespace } from '@prisma/client';

const prisma = new PrismaClient();

const seed = async () => {
  const tags = [
    // MEAL_TYPE (required)
    { slug: 'breakfast', label: 'Breakfast', namespace: TagNamespace.MEAL_TYPE },
    { slug: 'lunch', label: 'Lunch', namespace: TagNamespace.MEAL_TYPE },
    { slug: 'dinner', label: 'Dinner', namespace: TagNamespace.MEAL_TYPE },
    { slug: 'dessert', label: 'Dessert', namespace: TagNamespace.MEAL_TYPE },
    { slug: 'snack', label: 'Snack', namespace: TagNamespace.MEAL_TYPE },
    { slug: 'drinks', label: 'Drinks', namespace: TagNamespace.MEAL_TYPE },

    // METHOD
    { slug: 'air_fry', label: 'Air Fry', namespace: TagNamespace.METHOD },
    { slug: 'bake', label: 'Bake', namespace: TagNamespace.METHOD },
    { slug: 'grill', label: 'Grill', namespace: TagNamespace.METHOD },

    // DIET
    { slug: 'high_protein', label: 'High Protein', namespace: TagNamespace.DIET },
    { slug: 'gluten_free', label: 'Gluten Free', namespace: TagNamespace.DIET },
    { slug: 'vegetarian', label: 'Vegetarian', namespace: TagNamespace.DIET },
    { slug: 'vegan', label: 'Vegan', namespace: TagNamespace.DIET },
    { slug: 'dairy_free', label: 'Dairy Free', namespace: TagNamespace.DIET },
    { slug: 'nut_free', label: 'Nut Free', namespace: TagNamespace.DIET },

    // CUISINE (start small)
    { slug: 'mexican', label: 'Mexican', namespace: TagNamespace.CUISINE },
    { slug: 'italian', label: 'Italian', namespace: TagNamespace.CUISINE },
    { slug: 'american', label: 'American', namespace: TagNamespace.CUISINE },
    { slug: 'japanese', label: 'Japanese', namespace: TagNamespace.CUISINE },
    { slug: 'greek', label: 'Greek', namespace: TagNamespace.CUISINE },
    { slug: 'chinese', label: 'Chinese', namespace: TagNamespace.CUISINE },

    // GOAL (derived)
    { slug: 'pre_workout', label: 'Pre-workout', namespace: TagNamespace.GOAL },
    { slug: 'post_workout', label: 'Post-workout', namespace: TagNamespace.GOAL },
    { slug: 'fat_loss', label: 'Fat Loss', namespace: TagNamespace.GOAL },
    { slug: 'lean_bulk', label: 'Lean Bulk', namespace: TagNamespace.GOAL },
  ];

  for (const t of tags) {
    await prisma.tag.upsert({
      where: { slug: t.slug },
      update: t,
      create: t,
    });
  }
};

seed().finally(() => prisma.$disconnect());

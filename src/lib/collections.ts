import { prisma } from "@/lib/db";

export async function ensureSavedCollection(userId: string) {
  // Find or create the "Saved" collection for the user
  const collection = await prisma.collection.upsert({
    where: {
      userId_name: {
        userId,
        name: "Saved"
      }
    },
    update: {},
    create: {
      userId,
      name: "Saved"
    }
  });

  return collection.id;
}

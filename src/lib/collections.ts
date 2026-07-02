import { prisma } from "@/lib/db";

export async function ensureSavedCollection(userId: string) {
  const found = await prisma.collection.findFirst({ 
    where: { userId, name: "Saved" }, 
    select: { id: true }
  });
  
  if (found) return found.id;
  
  const created = await prisma.collection.create({ 
    data: { 
      id: crypto.randomUUID(), 
      userId, 
      name: "Saved"
    }
  });
  
  return created.id;
}

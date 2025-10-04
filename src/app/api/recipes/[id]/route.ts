import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
  const user = await getCurrentUser();
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  if (!region || !bucket) {
    return NextResponse.json({ error: "Missing AWS_REGION or S3_BUCKET" }, { status: 500 });
  }

  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: { photos: true },
  });

  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (recipe.authorId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Attempt S3 delete for all photo keys
  try {
    if (recipe.photos.length) {
      const s3 = new S3Client({ region });
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: recipe.photos.map((p) => ({ Key: p.s3Key })),
            Quiet: true,
          },
        })
      );
    }
  } catch {
    // ignore S3 delete failures; continue DB cleanup
  }

  // DB cleanup (no cascades assumed)
  await prisma.$transaction([
    prisma.photo.deleteMany({ where: { recipeId: id } }),
    prisma.ingredient.deleteMany({ where: { recipeId: id } }),
    prisma.comment.deleteMany({ where: { recipeId: id } }),
    prisma.like.deleteMany({ where: { recipeId: id } }),
    prisma.recipeTag.deleteMany({ where: { recipeId: id } }),
    prisma.collectionRecipe.deleteMany({ where: { recipeId: id } }),
    prisma.nutrition.deleteMany({ where: { recipeId: id } }),
    prisma.recipe.delete({ where: { id } }),
  ]);

  return new NextResponse(null, { status: 204 });
}

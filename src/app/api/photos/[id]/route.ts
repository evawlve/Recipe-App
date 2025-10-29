import { NextResponse } from "next/server";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  const resolvedParams = await params;
  const photoId = resolvedParams.id;
  const user = await getCurrentUser();
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  if (!region || !bucket) return NextResponse.json({ error: "Server misconfig" }, { status: 500 });

  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    include: { recipe: { select: { authorId: true } } },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!user || photo.recipe.authorId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const s3 = new S3Client({ 
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      }
    });
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: photo.s3Key }));
  } catch {
    // ignore S3 delete failures (object may already be gone)
  }

  await prisma.photo.delete({ where: { id: photoId } });
  return new NextResponse(null, { status: 204 });
}
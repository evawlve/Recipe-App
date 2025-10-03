import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

const s3 = new S3Client({ region });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!region || !bucket) {
      return NextResponse.json(
        { error: "Missing AWS_REGION or S3_BUCKET" },
        { status: 500 }
      );
    }

    // Look up the photo by id
    const photo = await prisma.photo.findUnique({
      where: { id },
    });

    if (!photo) {
      return NextResponse.json(
        { error: "Photo not found" },
        { status: 404 }
      );
    }

    // Delete object from S3 first
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: photo.s3Key,
      }));
    } catch (s3Error) {
      console.error("Failed to delete from S3:", s3Error);
      // Continue with DB deletion even if S3 deletion fails
    }

    // Delete photo from database
    await prisma.photo.delete({
      where: { id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting photo:", error);
    return NextResponse.json(
      { error: "Failed to delete photo" },
      { status: 500 }
    );
  }
}


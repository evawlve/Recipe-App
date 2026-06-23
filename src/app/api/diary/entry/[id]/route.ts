import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user = await getCurrentUser();
  let userId = user?.id;

  if (!userId && process.env.NODE_ENV === 'development') {
    const mockUser = await prisma.user.findFirst();
    if (mockUser) {
      userId = mockUser.id;
    } else {
      const newUser = await prisma.user.create({
        data: {
          id: "mock-user-123",
          email: "mock@example.com",
          name: "Mock User",
        },
      });
      userId = newUser.id;
    }
  }

  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    // Find log entry first to make sure it belongs to this user
    const entry = await prisma.logEntry.findUnique({
      where: { id },
      include: {
        dailyLog: true,
      },
    });

    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    if (entry.dailyLog.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await prisma.logEntry.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "Entry deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting log entry:", error);
    return NextResponse.json({ error: error.message || "Failed to delete entry" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user = await getCurrentUser();
  let userId = user?.id;

  if (!userId && process.env.NODE_ENV === 'development') {
    const mockUser = await prisma.user.findFirst();
    if (mockUser) {
      userId = mockUser.id;
    }
  }

  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      servingSize,
      quantity,
      grams,
      calories,
      protein,
      carbs,
      fat,
      mealType,
    } = body;

    // Find log entry first to make sure it belongs to this user
    const entry = await prisma.logEntry.findUnique({
      where: { id },
      include: {
        dailyLog: true,
      },
    });

    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    if (entry.dailyLog.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Build update data
    const updateData: any = {};
    if (servingSize !== undefined) updateData.servingSize = servingSize;
    if (quantity !== undefined) updateData.quantity = Number(quantity);
    if (grams !== undefined) updateData.grams = Number(grams);
    if (calories !== undefined) updateData.calories = Number(calories);
    if (protein !== undefined) updateData.protein = Number(protein);
    if (carbs !== undefined) updateData.carbs = Number(carbs);
    if (fat !== undefined) updateData.fat = Number(fat);
    if (mealType !== undefined) updateData.mealType = mealType;

    const updatedEntry = await prisma.logEntry.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, entry: updatedEntry });
  } catch (error: any) {
    console.error("Error updating log entry:", error);
    return NextResponse.json({ error: error.message || "Failed to update entry" }, { status: 500 });
  }
}

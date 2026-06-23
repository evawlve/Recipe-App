import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  
  if (!date) {
    return NextResponse.json({ error: "Date parameter is required (YYYY-MM-DD)" }, { status: 400 });
  }

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
    // Try to find existing daily log
    let dailyLog = await prisma.dailyLog.findUnique({
      where: {
        userId_date: {
          userId: userId,
          date: date,
        },
      },
      include: {
        entries: {
          orderBy: {
            loggedAt: "asc",
          },
        },
      },
    });

    // If it doesn't exist, initialize one for the day
    if (!dailyLog) {
      dailyLog = await prisma.dailyLog.create({
        data: {
          userId: userId,
          date: date,
          calorieTarget: 2000,
          proteinTarget: 150,
          carbsTarget: 200,
          fatTarget: 65,
        },
        include: {
          entries: true,
        },
      });
    }

    return NextResponse.json({ dailyLog });
  } catch (error: any) {
    console.error("Error fetching daily log:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch daily log" }, { status: 500 });
  }
}

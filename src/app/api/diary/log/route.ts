import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
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
    const body = await request.json();
    const {
      date,
      mealType,
      foodId,
      foodName,
      brandName,
      servingSize,
      quantity,
      grams,
      calories,
      protein,
      carbs,
      fat,
    } = body;

    if (!date || !mealType || !foodName || quantity === undefined || grams === undefined) {
      return NextResponse.json({ error: "Missing required fields (date, mealType, foodName, quantity, grams)" }, { status: 400 });
    }

    // Ensure DailyLog exists for this date/user
    let dailyLog = await prisma.dailyLog.findUnique({
      where: {
        userId_date: {
          userId: userId,
          date: date,
        },
      },
    });

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
      });
    }

    // Determine macros
    let finalCalories = calories;
    let finalProtein = protein;
    let finalCarbs = carbs;
    let finalFat = fat;

    // If foodId is provided, we can fetch food details from the DB and verify/calculate
    if (foodId && (calories === undefined || protein === undefined)) {
      const food = await prisma.food.findUnique({
        where: { id: foodId },
      });
      if (food) {
        finalCalories = (food.kcal100 / 100) * grams;
        finalProtein = (food.protein100 / 100) * grams;
        finalCarbs = (food.carbs100 / 100) * grams;
        finalFat = (food.fat100 / 100) * grams;
      }
    }

    // Default to 0 if still undefined
    finalCalories = finalCalories ?? 0;
    finalProtein = finalProtein ?? 0;
    finalCarbs = finalCarbs ?? 0;
    finalFat = finalFat ?? 0;

    const entry = await prisma.logEntry.create({
      data: {
        dailyLogId: dailyLog.id,
        mealType,
        foodId: foodId || null,
        foodName,
        brandName: brandName || null,
        servingSize: servingSize || `${grams}g`,
        quantity: Number(quantity),
        grams: Number(grams),
        calories: Number(finalCalories),
        protein: Number(finalProtein),
        carbs: Number(finalCarbs),
        fat: Number(finalFat),
      },
    });

    return NextResponse.json({ success: true, entry });
  } catch (error: any) {
    console.error("Error logging food:", error);
    return NextResponse.json({ error: error.message || "Failed to log food" }, { status: 500 });
  }
}

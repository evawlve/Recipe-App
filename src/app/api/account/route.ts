import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, firstName, lastName, avatarUrl, avatarKey } = await req.json().catch(() => ({}));
    
    // Validate name if provided
    if (name !== undefined && (!name || typeof name !== "string" || name.length > 80)) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    // Validate firstName if provided
    if (firstName !== undefined && (typeof firstName !== "string" || firstName.length > 50)) {
      return NextResponse.json({ error: "Invalid first name" }, { status: 400 });
    }

    // Validate lastName if provided
    if (lastName !== undefined && (typeof lastName !== "string" || lastName.length > 50)) {
      return NextResponse.json({ error: "Invalid last name" }, { status: 400 });
    }

    // Validate avatarUrl if provided
    if (avatarUrl !== undefined) {
      console.log("Received avatarUrl:", avatarUrl, "Length:", avatarUrl?.length);
      if (typeof avatarUrl !== "string" || avatarUrl.length > 1000) {
        return NextResponse.json({ error: "Invalid avatar URL" }, { status: 400 });
      }
    }

    // Validate avatarKey if provided
    if (avatarKey !== undefined) {
      console.log("Received avatarKey:", avatarKey);
      if (typeof avatarKey !== "string" || avatarKey.length > 500) {
        return NextResponse.json({ error: "Invalid avatar key" }, { status: 400 });
      }
    }

    // Build update data object with only provided fields
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (avatarKey !== undefined) updateData.avatarKey = avatarKey;

    console.log("Updating user with data:", updateData);
    
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    console.log("User updated successfully:", updatedUser);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error updating account:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

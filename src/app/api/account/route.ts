import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function PATCH(req: Request) {
  try {
    // Skip execution during build time
    if (process.env.NEXT_PHASE === 'phase-production-build' || 
        process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
        process.env.BUILD_TIME === 'true') {
      return NextResponse.json({ error: "Not available during build" }, { status: 503 });
    }

    // Import only when not in build mode
    const { getCurrentUser } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let { name, firstName, lastName, username, bio, avatarUrl, avatarKey } = await req.json().catch(() => ({}));
    
    // Validate name if provided
    if (name !== undefined && (!name || typeof name !== "string" || name.length > 80)) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    // Validate firstName if provided (required if provided, must be non-empty)
    if (firstName !== undefined) {
      if (typeof firstName !== "string") {
        return NextResponse.json({ error: "First name must be a string" }, { status: 400 });
      }
      const trimmedFirstName = firstName.trim();
      if (trimmedFirstName.length === 0) {
        return NextResponse.json({ error: "First name is required and cannot be empty" }, { status: 400 });
      }
      if (trimmedFirstName.length > 50) {
        return NextResponse.json({ error: "First name must be 50 characters or less" }, { status: 400 });
      }
      // Use trimmed version
      firstName = trimmedFirstName;
    }

    // Validate lastName if provided (optional, but must be valid if provided)
    if (lastName !== undefined && lastName !== null) {
      if (typeof lastName !== "string") {
        return NextResponse.json({ error: "Invalid last name" }, { status: 400 });
      }
      const trimmedLastName = lastName.trim();
      // Allow empty string for lastName (will be stored as null)
      if (trimmedLastName.length === 0) {
        lastName = null;
      } else {
        if (trimmedLastName.length > 50) {
          return NextResponse.json({ error: "Last name must be 50 characters or less" }, { status: 400 });
        }
        // Use trimmed version if not empty
        lastName = trimmedLastName;
      }
    }

    // Validate username if provided
    if (username !== undefined) {
      if (typeof username !== "string" || username.length < 3 || username.length > 20) {
        return NextResponse.json({ error: "Username must be 3-20 characters" }, { status: 400 });
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        return NextResponse.json({ error: "Username can only contain lowercase letters, numbers, and underscores" }, { status: 400 });
      }
      
      // Check if username is already taken (case-insensitive)
      const existingUser = await prisma.user.findFirst({
        where: {
          username: {
            equals: username,
            mode: 'insensitive'
          }
        }
      });

      if (existingUser && existingUser.id !== user.id) {
        return NextResponse.json({ error: 'Username is already taken' }, { status: 400 });
      }
    }

    // Validate bio if provided
    if (bio !== undefined && (typeof bio !== "string" || bio.length > 500)) {
      return NextResponse.json({ error: "Bio must be 500 characters or less" }, { status: 400 });
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
    if (firstName !== undefined) {
      updateData.firstName = firstName; // Already trimmed and validated above
      // If name is not explicitly provided, construct it from firstName and lastName
      if (name === undefined) {
        updateData.name = lastName ? `${firstName} ${lastName}` : firstName;
      }
    }
    // Allow lastName to be explicitly set to null (for optional lastName)
    if (lastName !== undefined) {
      updateData.lastName = lastName; // Already handled (null or trimmed string)
    }
    if (username !== undefined) updateData.username = username.toLowerCase();
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (avatarKey !== undefined) updateData.avatarKey = avatarKey;

    console.log("Updating user with data:", updateData);
    console.log("Current user before update:", user);
    
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        avatarKey: true,
      }
    });

    console.log("User updated successfully:", updatedUser);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error updating account:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

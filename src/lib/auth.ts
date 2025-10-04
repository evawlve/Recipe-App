import { prisma } from "@/lib/db";

export async function getCurrentUser() {
  const email = process.env.DEMO_USER_EMAIL || "demo@example.com";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, name: "Demo User" } });
  }
  return user;
}

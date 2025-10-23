"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSavedCollection = ensureSavedCollection;
const db_1 = require("@/lib/db");
async function ensureSavedCollection(userId) {
    const found = await db_1.prisma.collection.findFirst({
        where: { userId, name: "Saved" },
        select: { id: true }
    });
    if (found)
        return found.id;
    const created = await db_1.prisma.collection.create({
        data: {
            id: crypto.randomUUID(),
            userId,
            name: "Saved"
        }
    });
    return created.id;
}

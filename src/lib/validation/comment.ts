import { z } from "zod";

export const commentBodySchema = z.object({
	body: z.string().trim().min(1, "Say something").max(500, "Keep it under 500 chars"),
});

export type CommentBodyInput = z.infer<typeof commentBodySchema>;



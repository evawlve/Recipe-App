import 'server-only';
import { prisma } from '@/lib/db';
import { TagNamespace } from '@prisma/client';

export async function getTagSuggestions(namespace: TagNamespace) {
  const tags = await prisma.tag.findMany({
    where: { namespace },
    select: {
      id: true,
      label: true,
      namespace: true,
    },
    orderBy: {
      label: 'asc'
    }
  });

  return tags;
}

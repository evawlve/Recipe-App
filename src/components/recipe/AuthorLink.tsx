'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface AuthorLinkProps {
  author: {
    id: string;
    name: string | null;
    username: string | null;
    displayName: string | null;
    avatarKey: string | null;
  };
  currentUserId?: string | null;
  size?: 'sm' | 'md' | 'lg';
  showAvatar?: boolean;
  useButton?: boolean; // New prop to control whether to use button or link
}

export function AuthorLink({ 
  author, 
  currentUserId, 
  size = 'md',
  showAvatar = true,
  useButton = false
}: AuthorLinkProps) {
  const router = useRouter();
  const avatarSize = size === 'sm' ? 24 : size === 'md' ? 32 : 40;
  const displayName = author.displayName || author.name || author.username || "Anonymous";
  
  // Debug logging
  console.log('AuthorLink - author:', author);
  console.log('AuthorLink - showAvatar:', showAvatar);
  console.log('AuthorLink - author.avatarKey:', author.avatarKey);
  
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const href = currentUserId === author.id ? '/me' : `/u/${author.username}`;
    router.push(href);
  };
  
  const content = (
    <>
      <span>By {displayName}</span>
      {author.username && (
        <span className={`opacity-75 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
          @{author.username}
        </span>
      )}
    </>
  );
  
  const clickableContent = (
    <>
      {showAvatar && (
        <div className={`relative rounded-full overflow-hidden bg-muted flex-shrink-0`} 
             style={{ width: avatarSize, height: avatarSize }}>
          {author.avatarKey ? (
            <Image
              src={`/api/image/${author.avatarKey}`}
              alt={`${displayName} avatar`}
              width={avatarSize}
              height={avatarSize}
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="w-full h-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      )}
      {content}
    </>
  );

  return (
    <div className="flex items-center gap-2">
      {useButton ? (
        <button
          onClick={handleClick}
          className="hover:text-foreground transition-colors flex items-center gap-2 text-left"
        >
          {clickableContent}
        </button>
      ) : (
        <Link 
          href={currentUserId === author.id ? '/me' : `/u/${author.username}`}
          className="hover:text-foreground transition-colors flex items-center gap-2"
        >
          {clickableContent}
        </Link>
      )}
    </div>
  );
}

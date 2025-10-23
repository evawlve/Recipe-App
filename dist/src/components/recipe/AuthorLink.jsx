"use strict";
'use client';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorLink = AuthorLink;
const link_1 = __importDefault(require("next/link"));
const image_1 = __importDefault(require("next/image"));
const navigation_1 = require("next/navigation");
function AuthorLink({ author, currentUserId, size = 'md', showAvatar = true, useButton = false }) {
    const router = (0, navigation_1.useRouter)();
    const avatarSize = size === 'sm' ? 24 : size === 'md' ? 32 : 40;
    const displayName = author.displayName || author.name || author.username || "Anonymous";
    // Debug logging
    console.log('AuthorLink - author:', author);
    console.log('AuthorLink - showAvatar:', showAvatar);
    console.log('AuthorLink - author.avatarKey:', author.avatarKey);
    const handleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const href = currentUserId === author.id ? '/me' : `/u/${author.username}`;
        router.push(href);
    };
    const content = (<>
      <span>By {displayName}</span>
      {author.username && (<span className={`opacity-75 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
          @{author.username}
        </span>)}
    </>);
    const clickableContent = (<>
      {showAvatar && (<div className={`relative rounded-full overflow-hidden bg-muted flex-shrink-0`} style={{ width: avatarSize, height: avatarSize }}>
          {author.avatarKey ? (<image_1.default src={`/api/image/${author.avatarKey}`} alt={`${displayName} avatar`} width={avatarSize} height={avatarSize} className="object-cover w-full h-full"/>) : (<div className="w-full h-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {displayName.charAt(0).toUpperCase()}
            </div>)}
        </div>)}
      {content}
    </>);
    return (<div className="flex items-center gap-2">
      {useButton ? (<button onClick={handleClick} className="hover:text-foreground transition-colors flex items-center gap-2 text-left">
          {clickableContent}
        </button>) : (<link_1.default href={currentUserId === author.id ? '/me' : `/u/${author.username}`} className="hover:text-foreground transition-colors flex items-center gap-2">
          {clickableContent}
        </link_1.default>)}
    </div>);
}

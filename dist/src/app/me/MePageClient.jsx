"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MePageClient = MePageClient;
const react_1 = require("react");
const ProfileHeader_1 = __importDefault(require("@/components/account/ProfileHeader"));
const TabNav_1 = __importDefault(require("@/components/account/TabNav"));
const RecipeGrid_1 = __importDefault(require("@/components/account/RecipeGrid"));
const SettingsPanel_1 = __importDefault(require("@/components/account/SettingsPanel"));
function MePageClient({ user, uploaded, saved, uploadedCount, savedCount, followersCount, followingCount, tab }) {
    const [currentAvatarUrl, setCurrentAvatarUrl] = (0, react_1.useState)(user.avatarUrl);
    const [currentAvatarKey, setCurrentAvatarKey] = (0, react_1.useState)(user.avatarKey);
    const [currentUser, setCurrentUser] = (0, react_1.useState)(user);
    const handleAvatarUpdate = (newAvatarUrl) => {
        console.log("MePageClient received avatar update:", newAvatarUrl);
        setCurrentAvatarUrl(newAvatarUrl);
    };
    const handleProfileUpdate = (updatedUser) => {
        console.log("MePageClient received profile update:", updatedUser);
        setCurrentUser(prev => ({ ...prev, ...updatedUser }));
    };
    return (<div className="container mx-auto max-w-6xl p-4 sm:p-6">
      <ProfileHeader_1.default name={currentUser.name} email={currentUser.email} username={currentUser.username} bio={currentUser.bio} uploadedCount={uploadedCount} savedCount={savedCount} followersCount={followersCount} followingCount={followingCount} avatarUrl={currentAvatarUrl} onAvatarUpdate={handleAvatarUpdate}/>
      
      <TabNav_1.default tab={tab}/>
      
      <div className="mt-6">
        {tab === "saved" && <RecipeGrid_1.default items={saved} currentUserId={user.id}/>}
        {tab === "uploaded" && <RecipeGrid_1.default items={uploaded} currentUserId={user.id}/>}
        {tab === "settings" && (<SettingsPanel_1.default name={currentUser.name} email={currentUser.email} firstName={currentUser.firstName} lastName={currentUser.lastName} username={currentUser.username} bio={currentUser.bio} avatarUrl={currentAvatarUrl} avatarKey={currentAvatarKey} onAvatarUpdate={handleAvatarUpdate} onProfileUpdate={handleProfileUpdate}/>)}
      </div>
    </div>);
}

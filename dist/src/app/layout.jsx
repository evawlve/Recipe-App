"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RootLayout;
require("./globals.css");
const AuthHeader_1 = require("@/components/auth/AuthHeader");
const WelcomeNotification_1 = require("@/components/WelcomeNotification");
const ErrorBoundary_1 = require("@/components/ErrorBoundary");
const SignupGuard_1 = require("@/components/SignupGuard");
const ThemeScript_1 = __importDefault(require("@/components/ThemeScript"));
const react_1 = require("react");
const next_themes_1 = require("next-themes");
function RootLayout({ children }) {
    return (<html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript_1.default />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <next_themes_1.ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ErrorBoundary_1.ErrorBoundary>
            <SignupGuard_1.SignupGuard>
              <react_1.Suspense fallback={<div className="border-b border-border"><div className="container mx-auto px-4 py-4"><div className="animate-pulse bg-muted h-8 w-32 rounded"></div></div></div>}>
                <AuthHeader_1.AuthHeader />
              </react_1.Suspense>
              <main className="min-h-screen pt-20">{children}</main>
              <react_1.Suspense fallback={null}>
                <WelcomeNotification_1.WelcomeNotification />
              </react_1.Suspense>
            </SignupGuard_1.SignupGuard>
          </ErrorBoundary_1.ErrorBoundary>
        </next_themes_1.ThemeProvider>
      </body>
    </html>);
}

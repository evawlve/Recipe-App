"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ThemeScript;
function ThemeScript() {
    return (<script dangerouslySetInnerHTML={{
            __html: `
          try {
            const theme = localStorage.getItem('theme') || 'system';
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            const isDark = theme === 'dark' || (theme === 'system' && systemTheme === 'dark');
            
            if (isDark) {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
          } catch (e) {
            // Fallback: check system preference
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
              document.documentElement.classList.add('dark');
            }
          }
        `,
        }}/>);
}

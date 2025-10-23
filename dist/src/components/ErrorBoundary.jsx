"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorBoundary = void 0;
const react_1 = require("react");
const button_1 = require("@/components/ui/button");
const card_1 = require("@/components/ui/card");
class ErrorBoundary extends react_1.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error('Error caught by boundary:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (<div className="min-h-screen flex items-center justify-center p-4">
          <card_1.Card className="max-w-md w-full p-6 text-center">
            <h2 className="text-xl font-semibold mb-4">Something went wrong</h2>
            <p className="text-muted-foreground mb-4">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            <div className="space-y-2">
              <button_1.Button onClick={() => window.location.reload()} className="w-full">
                Refresh Page
              </button_1.Button>
              <button_1.Button onClick={() => window.location.href = '/signin'} variant="outline" className="w-full">
                Sign In Again
              </button_1.Button>
            </div>
          </card_1.Card>
        </div>);
        }
        return this.props.children;
    }
}
exports.ErrorBoundary = ErrorBoundary;

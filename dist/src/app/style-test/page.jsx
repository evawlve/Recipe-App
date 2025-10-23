"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = StyleTestPage;
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
function StyleTestPage() {
    return (<div className="container mx-auto p-6 space-y-8">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold">Style Test Page</h1>
        <p className="text-muted-foreground text-lg">
          Testing Tailwind CSS with custom design tokens and shadcn/ui components
        </p>
      </div>

      {/* Color Blocks */}
      <card_1.Card>
        <card_1.CardHeader>
          <card_1.CardTitle>Color Palette</card_1.CardTitle>
          <card_1.CardDescription>Testing primary, secondary, and accent colors</card_1.CardDescription>
        </card_1.CardHeader>
        <card_1.CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Primary Color Block */}
            <div className="space-y-2">
              <h3 className="font-semibold">Primary</h3>
              <div className="h-20 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-medium">Primary</span>
              </div>
            </div>
            
            {/* Secondary Color Block */}
            <div className="space-y-2">
              <h3 className="font-semibold">Secondary</h3>
              <div className="h-20 bg-secondary rounded-lg flex items-center justify-center">
                <span className="text-secondary-foreground font-medium">Secondary</span>
              </div>
            </div>
            
            {/* Accent Color Block */}
            <div className="space-y-2">
              <h3 className="font-semibold">Accent</h3>
              <div className="h-20 bg-accent rounded-lg flex items-center justify-center">
                <span className="text-accent-foreground font-medium">Accent</span>
              </div>
            </div>
          </div>
        </card_1.CardContent>
      </card_1.Card>

      {/* Button Variants */}
      <card_1.Card>
        <card_1.CardHeader>
          <card_1.CardTitle>Button Variants</card_1.CardTitle>
          <card_1.CardDescription>Testing different button styles and states</card_1.CardDescription>
        </card_1.CardHeader>
        <card_1.CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <button_1.Button>Default</button_1.Button>
            <button_1.Button variant="secondary">Secondary</button_1.Button>
            <button_1.Button variant="outline">Outline</button_1.Button>
            <button_1.Button variant="ghost">Ghost</button_1.Button>
            <button_1.Button variant="destructive">Destructive</button_1.Button>
          </div>
          
          <div className="flex flex-wrap gap-4">
            <button_1.Button size="sm">Small</button_1.Button>
            <button_1.Button size="default">Default</button_1.Button>
            <button_1.Button size="lg">Large</button_1.Button>
          </div>
        </card_1.CardContent>
      </card_1.Card>

      {/* Text Styles */}
      <card_1.Card>
        <card_1.CardHeader>
          <card_1.CardTitle>Text Styles</card_1.CardTitle>
          <card_1.CardDescription>Testing typography and muted text</card_1.CardDescription>
        </card_1.CardHeader>
        <card_1.CardContent className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Heading 2</h2>
            <h3 className="text-xl font-semibold">Heading 3</h3>
            <p className="text-base">Regular paragraph text</p>
            <p className="text-sm text-muted-foreground">Small muted text for descriptions</p>
            <p className="text-xs text-muted-foreground">Extra small muted text</p>
          </div>
        </card_1.CardContent>
      </card_1.Card>

      {/* Border Radius Test */}
      <card_1.Card>
        <card_1.CardHeader>
          <card_1.CardTitle>Border Radius</card_1.CardTitle>
          <card_1.CardDescription>Testing custom border radius values</card_1.CardDescription>
        </card_1.CardHeader>
        <card_1.CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="h-16 bg-primary rounded-sm flex items-center justify-center">
              <span className="text-primary-foreground text-sm">Small</span>
            </div>
            <div className="h-16 bg-secondary rounded-md flex items-center justify-center">
              <span className="text-secondary-foreground text-sm">Medium</span>
            </div>
            <div className="h-16 bg-accent rounded-lg flex items-center justify-center">
              <span className="text-accent-foreground text-sm">Large</span>
            </div>
            <div className="h-16 bg-muted rounded-xl flex items-center justify-center">
              <span className="text-muted-foreground text-sm">XL</span>
            </div>
          </div>
        </card_1.CardContent>
      </card_1.Card>
    </div>);
}

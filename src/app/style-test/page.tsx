import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function StyleTestPage() {
  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold">Style Test Page</h1>
        <p className="text-muted-foreground text-lg">
          Testing Tailwind CSS with custom design tokens and shadcn/ui components
        </p>
      </div>

      {/* Color Blocks */}
      <Card>
        <CardHeader>
          <CardTitle>Color Palette</CardTitle>
          <CardDescription>Testing primary, secondary, and accent colors</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {/* Button Variants */}
      <Card>
        <CardHeader>
          <CardTitle>Button Variants</CardTitle>
          <CardDescription>Testing different button styles and states</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          
          <div className="flex flex-wrap gap-4">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
          </div>
        </CardContent>
      </Card>

      {/* Text Styles */}
      <Card>
        <CardHeader>
          <CardTitle>Text Styles</CardTitle>
          <CardDescription>Testing typography and muted text</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Heading 2</h2>
            <h3 className="text-xl font-semibold">Heading 3</h3>
            <p className="text-base">Regular paragraph text</p>
            <p className="text-sm text-muted-foreground">Small muted text for descriptions</p>
            <p className="text-xs text-muted-foreground">Extra small muted text</p>
          </div>
        </CardContent>
      </Card>

      {/* Border Radius Test */}
      <Card>
        <CardHeader>
          <CardTitle>Border Radius</CardTitle>
          <CardDescription>Testing custom border radius values</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}

"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagsInput = TagsInput;
const react_1 = require("react");
const input_1 = require("@/components/ui/input");
const button_1 = require("@/components/ui/button");
const badge_1 = require("@/components/ui/badge");
const lucide_react_1 = require("lucide-react");
// Utility function to create slug from label
function createSlug(label) {
    return label
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}
// Utility function to humanize slug back to label
function humanizeSlug(slug) {
    return slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
function TagsInput({ value, onChange, placeholder = "Add tags...", maxTags = 10 }) {
    const [inputValue, setInputValue] = (0, react_1.useState)("");
    const [suggestions, setSuggestions] = (0, react_1.useState)([]);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const [showSuggestions, setShowSuggestions] = (0, react_1.useState)(false);
    const inputRef = (0, react_1.useRef)(null);
    const suggestionsRef = (0, react_1.useRef)(null);
    const debounceRef = (0, react_1.useRef)(null);
    // Debounced search for suggestions
    const searchSuggestions = (0, react_1.useCallback)(async (query) => {
        if (query.length < 1) {
            setSuggestions([]);
            return;
        }
        setIsLoading(true);
        try {
            const response = await fetch(`/api/tags?s=${encodeURIComponent(query)}`);
            if (response.ok) {
                const data = await response.json();
                setSuggestions(data);
            }
        }
        catch (error) {
            console.error("Error fetching tag suggestions:", error);
        }
        finally {
            setIsLoading(false);
        }
    }, []);
    // Handle input change with debouncing
    const handleInputChange = (e) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        // Clear existing timeout
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        // Set new timeout for debounced search
        debounceRef.current = setTimeout(() => {
            searchSuggestions(newValue);
        }, 300);
    };
    // Add tag from input or suggestion
    const addTag = (tagLabel) => {
        const slug = createSlug(tagLabel);
        const normalizedLabel = tagLabel.trim();
        if (!normalizedLabel || value.includes(slug) || value.length >= maxTags) {
            return;
        }
        onChange([...value, slug]);
        setInputValue("");
        setShowSuggestions(false);
    };
    // Remove tag
    const removeTag = (tagToRemove) => {
        onChange(value.filter(tag => tag !== tagToRemove));
    };
    // Handle key events
    const handleKeyDown = (e) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (inputValue.trim()) {
                addTag(inputValue.trim());
            }
        }
        else if (e.key === "Escape") {
            setShowSuggestions(false);
        }
    };
    // Handle suggestion click
    const handleSuggestionClick = (suggestion) => {
        addTag(suggestion.label);
    };
    // Handle input focus
    const handleInputFocus = () => {
        if (inputValue.length > 0) {
            setShowSuggestions(true);
        }
    };
    // Handle click outside to close suggestions
    (0, react_1.useEffect)(() => {
        const handleClickOutside = (event) => {
            if (suggestionsRef.current &&
                !suggestionsRef.current.contains(event.target) &&
                inputRef.current &&
                !inputRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    // Show suggestions when input has value
    (0, react_1.useEffect)(() => {
        setShowSuggestions(inputValue.length > 0 && suggestions.length > 0);
    }, [inputValue, suggestions]);
    // Cleanup timeout on unmount
    (0, react_1.useEffect)(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, []);
    return (<div className="space-y-2">
      <div className="relative">
        <input_1.Input ref={inputRef} value={inputValue} onChange={handleInputChange} onKeyDown={handleKeyDown} onFocus={handleInputFocus} placeholder={value.length >= maxTags ? "Maximum tags reached" : placeholder} disabled={value.length >= maxTags} className="pr-10"/>
        {inputValue && (<button_1.Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0" onClick={() => addTag(inputValue.trim())} disabled={!inputValue.trim() || value.includes(createSlug(inputValue.trim()))}>
            <lucide_react_1.Plus className="h-3 w-3"/>
          </button_1.Button>)}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && (<div ref={suggestionsRef} className="absolute z-50 w-full bg-background border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {isLoading ? (<div className="p-3 text-sm text-muted-foreground">Loading suggestions...</div>) : suggestions.length > 0 ? (<div className="py-1">
              {suggestions.map((suggestion) => (<button key={suggestion.id} type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none" onClick={() => handleSuggestionClick(suggestion)}>
                  <div className="flex items-center justify-between">
                    <span>{suggestion.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {suggestion.count} recipes
                    </span>
                  </div>
                </button>))}
            </div>) : (<div className="p-3 text-sm text-muted-foreground">
              No suggestions found
            </div>)}
        </div>)}

      {/* Selected tags */}
      {value.length > 0 && (<div className="flex flex-wrap gap-2">
          {value.map((tag) => (<badge_1.Badge key={tag} variant="secondary" className="flex items-center gap-1 pr-1">
              <span>{humanizeSlug(tag)}</span>
              <button_1.Button type="button" variant="ghost" size="sm" className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground" onClick={() => removeTag(tag)}>
                <lucide_react_1.X className="h-3 w-3"/>
              </button_1.Button>
            </badge_1.Badge>))}
        </div>)}

      {/* Helper text */}
      <p className="text-xs text-muted-foreground">
        {value.length}/{maxTags} tags. Press Enter or comma to add tags.
      </p>
    </div>);
}

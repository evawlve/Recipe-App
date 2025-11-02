"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { X, ChevronDown, ChevronUp } from "lucide-react";

interface Tag {
  id: string;
  slug: string;
  label: string;
  namespace: string;
}

interface FiltersProps {
  initial: {
    ns: string[];
    tags: string[];
    sort: string;
    kcalMax?: number;
    prepTime?: string;
  };
}

const NAMESPACES = [
  { value: 'MEAL_TYPE', label: 'Meal Type' },
  { value: 'CUISINE', label: 'Cuisine' },
  { value: 'DIET', label: 'Diet' },
  { value: 'METHOD', label: 'Method' },
  { value: 'GOAL', label: 'Goal' },
];

const SORT_OPTIONS = [
  { value: 'new', label: 'Newest' },
  { value: 'interactions', label: 'Most Popular' },
  { value: 'proteinDensity', label: 'Protein Density' },
  { value: 'kcalAsc', label: 'Calories (Low to High)' },
];

const PREP_TIME_OPTIONS = [
  { value: '<15 min', label: '< 15 min' },
  { value: '15-30 min', label: '15-30 min' },
  { value: '30-45 min', label: '30-45 min' },
  { value: '45min - 1hr', label: '45 min - 1 hr' },
  { value: '1hr+', label: '1 hr+' },
];

export function Filters({ initial }: FiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedTags, setSelectedTags] = useState<string[]>(initial.tags);
  const [kcalMax, setKcalMax] = useState(initial.kcalMax || 1000);
  const [sort, setSort] = useState(initial.sort);
  const [prepTime, setPrepTime] = useState(initial.prepTime || '');
  const [tagsByNamespace, setTagsByNamespace] = useState<Record<string, Tag[]>>({});
  const [loading, setLoading] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Sync state with URL parameters when they change
  useEffect(() => {
    setSelectedTags(initial.tags);
    setKcalMax(initial.kcalMax || 1000);
    setSort(initial.sort);
    setPrepTime(initial.prepTime || '');
  }, [JSON.stringify(initial.tags), initial.kcalMax, initial.sort, initial.prepTime]);

  // Auto-expand if there are active filters (only on initial mount)
  useEffect(() => {
    const hasActiveFilters = selectedTags.length > 0 || kcalMax !== 1000 || sort !== 'new' || prepTime !== '';
    if (hasActiveFilters) {
      setIsExpanded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);

  // Fetch tags for selected namespaces
  const fetchTagsForNamespaces = useCallback(async (namespaces: string[]) => {
    if (namespaces.length === 0) {
      setTagsByNamespace({});
      return;
    }

    setLoading(true);
    try {
      const promises = namespaces.map(async (ns) => {
        const response = await fetch(`/api/tags?namespace=${ns}`);
        if (response.ok) {
          const data = await response.json();
          return { namespace: ns, tags: data.tags || data };
        }
        return { namespace: ns, tags: [] };
      });

      const results = await Promise.all(promises);
      const newTagsByNamespace: Record<string, Tag[]> = {};
      results.forEach(({ namespace, tags }) => {
        newTagsByNamespace[namespace] = tags;
      });
      setTagsByNamespace(newTagsByNamespace);
    } catch (error) {
      console.error("Error fetching tags:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch tags for all namespaces by default
    fetchTagsForNamespaces(NAMESPACES.map(ns => ns.value));
  }, [fetchTagsForNamespaces]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('[data-dropdown]')) {
        setOpenDropdowns({});
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateURL = useCallback((updates: Partial<{
    ns: string[];
    tags: string[];
    sort: string;
    kcalMax: number;
    prepTime: string;
  }>, immediate = false) => {
    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    const performUpdate = () => {
      const params = new URLSearchParams(searchParams.toString());
      
      // Update namespaces
      if (updates.ns !== undefined) {
        params.delete('ns');
        if (updates.ns.length > 0) {
          params.set('ns', updates.ns.join(','));
        }
      }
      
      // Update tags
      if (updates.tags !== undefined) {
        params.delete('tags');
        if (updates.tags.length > 0) {
          params.set('tags', updates.tags.join(','));
        }
      }
      
      // Update sort
      if (updates.sort !== undefined) {
        if (updates.sort === 'new') {
          params.delete('sort');
        } else {
          params.set('sort', updates.sort);
        }
      }
      
      // Update kcalMax
      if (updates.kcalMax !== undefined) {
        if (updates.kcalMax === 1000) {
          params.delete('kcalMax');
        } else {
          params.set('kcalMax', updates.kcalMax.toString());
        }
      }
      
      // Update prepTime
      if (updates.prepTime !== undefined) {
        if (updates.prepTime === '') {
          params.delete('prepTime');
        } else {
          params.set('prepTime', updates.prepTime);
        }
      }
      
      // Remove cursor for new filters
      params.delete('cursor');
      
      router.push(`/recipes?${params.toString()}`, { scroll: false });
    };

    if (immediate) {
      performUpdate();
    } else {
      // Debounce URL updates by 300ms
      const timer = setTimeout(performUpdate, 300);
      setDebounceTimer(timer);
    }
  }, [router, searchParams, debounceTimer]);


  const toggleTag = (tagSlug: string) => {
    const newTags = selectedTags.includes(tagSlug)
      ? selectedTags.filter(tag => tag !== tagSlug)
      : [...selectedTags, tagSlug];
    
    setSelectedTags(newTags);
    updateURL({ tags: newTags }); // Debounced - allows rapid clicking
  };

  const toggleDropdown = (namespace: string) => {
    setOpenDropdowns(prev => ({
      ...prev,
      [namespace]: !prev[namespace]
    }));
  };

  const getSelectedTagsForNamespace = (namespace: string) => {
    const namespaceTags = tagsByNamespace[namespace] || [];
    return selectedTags.filter(tag => 
      namespaceTags.some(t => t.slug === tag)
    );
  };

  const getDisplayText = (namespace: string) => {
    const selected = getSelectedTagsForNamespace(namespace);
    if (selected.length === 0) return `Select ${NAMESPACES.find(ns => ns.value === namespace)?.label.toLowerCase()}`;
    if (selected.length === 1) return selected[0];
    return `${selected.length} selected`;
  };

  const handleKcalChange = (value: number[]) => {
    const newKcalMax = value[0];
    setKcalMax(newKcalMax);
    updateURL({ kcalMax: newKcalMax }); // Debounced - good for sliders
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    updateURL({ sort: newSort }, true); // Immediate for sort
  };

  const handlePrepTimeChange = (newPrepTime: string) => {
    setPrepTime(newPrepTime);
    updateURL({ prepTime: newPrepTime }); // Debounced
  };

  const clearAllFilters = () => {
    setSelectedTags([]);
    setKcalMax(1000);
    setSort('new');
    setPrepTime('');
    updateURL({ ns: [], tags: [], sort: 'new', kcalMax: 1000, prepTime: '' }, true); // Immediate
  };


  return (
    <div className="space-y-6">

      {/* Expandable Filters Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Filters</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2"
            >
              {isExpanded ? (
                <>
                  <span>Hide Filters</span>
                  <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  <span>Show Filters</span>
                  <ChevronDown className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <div 
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            isExpanded 
              ? 'max-h-[2000px] opacity-100' 
              : 'max-h-0 opacity-0'
          }`}
        >
          <CardContent className="space-y-6">
          {/* Namespace dropdowns */}
          <div className="space-y-4">
            <label className="text-sm font-medium">Categories</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {NAMESPACES.map((namespace) => (
                <div key={namespace.value} className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">
                    {namespace.label}
                  </label>
                  <div className="relative" data-dropdown>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between bg-search-bg border-border text-search-text hover:bg-accent hover:text-accent-foreground"
                      onClick={() => toggleDropdown(namespace.value)}
                    >
                      <span className="truncate">{getDisplayText(namespace.value)}</span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                    
                    {openDropdowns[namespace.value] && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-search-bg border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                        <div className="p-2 space-y-1">
                          {tagsByNamespace[namespace.value]?.map((tag) => (
                            <div key={tag.id} className="flex items-center space-x-2 p-2 hover:bg-accent rounded-sm">
                              <Checkbox
                                id={`${namespace.value}-${tag.slug}`}
                                checked={selectedTags.includes(tag.slug)}
                                onCheckedChange={() => toggleTag(tag.slug)}
                              />
                              <label
                                htmlFor={`${namespace.value}-${tag.slug}`}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                              >
                                {tag.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Prep Time dropdown */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Prep Time
                </label>
                <div className="relative" data-dropdown>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between bg-search-bg border-border text-search-text hover:bg-accent hover:text-accent-foreground"
                    onClick={() => toggleDropdown('PREP_TIME')}
                  >
                    <span className="truncate">{prepTime || 'Any prep time'}</span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                  
                  {openDropdowns['PREP_TIME'] && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-search-bg border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                      <div className="p-2 space-y-1">
                        {PREP_TIME_OPTIONS.map((option) => (
                          <div key={option.value} className="flex items-center space-x-2 p-2 hover:bg-accent rounded-sm">
                            <Checkbox
                              id={`preptime-${option.value}`}
                              checked={prepTime === option.value}
                              onCheckedChange={() => {
                                // Toggle: if already selected, clear it; otherwise select it
                                if (prepTime === option.value) {
                                  handlePrepTimeChange('');
                                } else {
                                  handlePrepTimeChange(option.value);
                                }
                              }}
                            />
                            <label
                              htmlFor={`preptime-${option.value}`}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                            >
                              {option.label}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Calorie filter */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Max Calories (per serving)</label>
              <span className="text-sm text-muted-foreground">{kcalMax} cal</span>
            </div>
            <Slider
              value={[kcalMax]}
              onValueChange={handleKcalChange}
              max={2000}
              min={100}
              step={50}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>100 cal</span>
              <span>2000 cal</span>
            </div>
          </div>

          {/* Sort options */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Sort By</label>
            <Select value={sort} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full bg-search-bg border-border text-search-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-search-bg border-border">
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-search-text hover:bg-accent">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          </CardContent>
        </div>
      </Card>


      {/* Selected tags - Always visible when there are selected tags */}
      {selectedTags.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Selected Tags ({selectedTags.length})</CardTitle>
              <Button variant="outline" size="sm" onClick={clearAllFilters}>
                Clear All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {selectedTags.map((tagSlug) => {
                // Find the tag from all loaded tags
                const tag = Object.values(tagsByNamespace).flat().find(t => t.slug === tagSlug);
                const label = tag?.label || tagSlug;
                
                return (
                  <Badge
                    key={tagSlug}
                    variant="default"
                    className="flex items-center gap-1 pr-1"
                  >
                    <span>{label}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => toggleTag(tagSlug)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}


    </div>
  );
}

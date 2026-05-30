"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  BellOff,
  Bookmark,
  History,
  Mail,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  fetchPopularSearches,
  fetchSearchSuggestions,
  type ProductSort,
  type SavedSearch,
} from "@/services/productService";
import type { ProductCategory } from "@/types/product";
import type { SearchFiltersState } from "@/hooks/useSearch";

const CATEGORIES: ProductCategory[] = [
  "Vegetables",
  "Fruits",
  "Grains",
  "Tubers",
  "Livestock",
  "Other",
];

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low → high" },
  { value: "price-desc", label: "Price: high → low" },
  { value: "rating", label: "Top rated" },
  { value: "distance", label: "Nearest" },
  { value: "popular", label: "Most popular" },
];

const MAX_PRICE = 10_000;
const MAX_AGE = 90;

export interface SearchFiltersProps {
  filters: SearchFiltersState;
  setFilters: (patch: Partial<SearchFiltersState>) => void;
  reset: () => void;
  activeFilterCount: number;
  history: string[];
  recordSearch: () => void;
  clearHistory: () => void;
  saved: SavedSearch[];
  savedLoading: boolean;
  saveCurrent: (
    name: string,
    options?: { emailAlerts?: boolean; pushAlerts?: boolean },
  ) => Promise<SavedSearch>;
  removeSaved: (id: string) => Promise<void>;
  toggleAlerts: (
    id: string,
    channel: "email" | "push",
    value: boolean,
  ) => Promise<void>;
  applySaved: (saved: SavedSearch) => void;
}

export function SearchFilters({
  filters,
  setFilters,
  reset,
  activeFilterCount,
  history,
  recordSearch,
  clearHistory,
  saved,
  savedLoading,
  saveCurrent,
  removeSaved,
  toggleAlerts,
  applySaved,
}: SearchFiltersProps) {
  const [showSavedDialog, setShowSavedDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <SearchBox
          value={filters.search}
          onChange={(v) => setFilters({ search: v })}
          onCommit={recordSearch}
          history={history}
          clearHistory={clearHistory}
        />

        <div className="flex gap-2">
          {/* Mobile: filters in a Sheet. Desktop: filters in a Popover. */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="md:hidden">
                <SlidersHorizontal className="size-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>
                  Narrow your results.
                </SheetDescription>
              </SheetHeader>
              <div className="p-4">
                <FilterPanel filters={filters} setFilters={setFilters} reset={reset} />
              </div>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="hidden md:inline-flex">
                <SlidersHorizontal className="size-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[380px] max-h-[80vh] overflow-y-auto"
            >
              <FilterPanel filters={filters} setFilters={setFilters} reset={reset} />
            </PopoverContent>
          </Popover>

          <Select
            value={filters.sort}
            onValueChange={(v: string) =>
              setFilters({ sort: v as ProductSort })
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={() => setShowSavedDialog(true)}
            title="Saved searches"
          >
            <Bookmark className="size-4" />
            <span className="hidden sm:inline">Saved</span>
            {saved.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {saved.length}
              </Badge>
            )}
          </Button>

          <Button
            variant="default"
            disabled={activeFilterCount === 0}
            onClick={() => setShowCreateDialog(true)}
          >
            Save current
          </Button>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <ActiveChips filters={filters} setFilters={setFilters} reset={reset} />
      )}

      {/* Quick category bar */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => {
          const active = filters.categories.includes(c);
          return (
            <button
              key={c}
              onClick={() => {
                const next = active
                  ? filters.categories.filter((x) => x !== c)
                  : [...filters.categories, c];
                setFilters({ categories: next });
              }}
              className="cursor-pointer"
              type="button"
            >
              <Badge
                variant={active ? "default" : "outline"}
                className="px-3 py-1 text-xs"
              >
                {c}
              </Badge>
            </button>
          );
        })}
      </div>

      <PopularSearches
        onPick={(term) => {
          setFilters({ search: term });
          recordSearch();
        }}
      />

      <SavedSearchesDialog
        open={showSavedDialog}
        onClose={() => setShowSavedDialog(false)}
        saved={saved}
        savedLoading={savedLoading}
        removeSaved={removeSaved}
        toggleAlerts={toggleAlerts}
        applySaved={(s) => {
          applySaved(s);
          setShowSavedDialog(false);
        }}
      />

      <CreateSavedSearchDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSave={async (name, opts) => {
          await saveCurrent(name, opts);
          setShowCreateDialog(false);
        }}
      />
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  onCommit,
  history,
  clearHistory,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  history: string[];
  clearHistory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      if (!value.trim()) {
        setSuggestions([]);
        return;
      }
      try {
        const list = await fetchSearchSuggestions(value);
        if (!cancelled) setSuggestions(list);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [value]);

  const showDropdown =
    open && (suggestions.length > 0 || history.length > 0);

  return (
    <div className="relative flex-1">
      <SearchIcon className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onCommit();
            setOpen(false);
          }
        }}
        placeholder="Search by name, category, or location…"
        className="pl-10"
        aria-label="Search products"
      />
      {showDropdown && (
        <div className="bg-card absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border shadow-lg">
          {suggestions.length > 0 && (
            <div className="p-2">
              <p className="text-muted-foreground mb-1 px-2 text-xs uppercase">
                Suggestions
              </p>
              {suggestions.map((s) => (
                <button
                  type="button"
                  key={s}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(s);
                    onCommit();
                    setOpen(false);
                  }}
                  className="hover:bg-muted/40 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                >
                  <Sparkles className="text-muted-foreground size-3.5" />
                  {s}
                </button>
              ))}
            </div>
          )}
          {history.length > 0 && (
            <>
              {suggestions.length > 0 && <Separator />}
              <div className="p-2">
                <div className="mb-1 flex items-center justify-between px-2">
                  <p className="text-muted-foreground text-xs uppercase">
                    Recent
                  </p>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={clearHistory}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    Clear
                  </button>
                </div>
                {history.map((h) => (
                  <button
                    type="button"
                    key={h}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(h);
                      setOpen(false);
                    }}
                    className="hover:bg-muted/40 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <History className="text-muted-foreground size-3.5" />
                    {h}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilterPanel({
  filters,
  setFilters,
  reset,
}: {
  filters: SearchFiltersState;
  setFilters: (patch: Partial<SearchFiltersState>) => void;
  reset: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Categories</Label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((c) => {
            const checked = filters.categories.includes(c);
            return (
              <label
                key={c}
                className="hover:bg-muted/30 flex cursor-pointer items-center gap-2 rounded-md p-1.5"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value: boolean | "indeterminate") => {
                    const isChecked = value === true;
                    const next = isChecked
                      ? [...filters.categories, c]
                      : filters.categories.filter((x) => x !== c);
                    setFilters({ categories: next });
                  }}
                />
                <span className="text-sm">{c}</span>
              </label>
            );
          })}
        </div>
      </div>

      <Separator />

      <RangeSlider
        label="Price"
        unit=""
        max={MAX_PRICE}
        min={0}
        step={10}
        value={[filters.priceMin ?? 0, filters.priceMax ?? MAX_PRICE]}
        onChange={([min, max]) =>
          setFilters({
            priceMin: min > 0 ? min : undefined,
            priceMax: max < MAX_PRICE ? max : undefined,
          })
        }
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Minimum seller rating</Label>
          <span className="text-muted-foreground text-xs">
            {filters.ratingMin?.toFixed(1) ?? "any"} ★
          </span>
        </div>
        <Slider
          min={0}
          max={5}
          step={0.5}
          value={[filters.ratingMin ?? 0]}
          onValueChange={(v: number[]) =>
            setFilters({ ratingMin: v[0] === 0 ? undefined : v[0] })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="filter-location">Location</Label>
        <Input
          id="filter-location"
          value={filters.location}
          onChange={(e) => setFilters({ location: e.target.value })}
          placeholder="City, state, or country"
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium">In-stock only</p>
          <p className="text-muted-foreground text-xs">
            Hide listings without available inventory.
          </p>
        </div>
        <Switch
          checked={filters.inStockOnly}
          onCheckedChange={(checked: boolean) =>
            setFilters({ inStockOnly: checked })
          }
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Product freshness</Label>
          <span className="text-muted-foreground text-xs">
            {filters.maxAgeDays
              ? `≤ ${filters.maxAgeDays} day(s)`
              : "any age"}
          </span>
        </div>
        <Slider
          min={0}
          max={MAX_AGE}
          step={1}
          value={[filters.maxAgeDays ?? 0]}
          onValueChange={(v: number[]) =>
            setFilters({ maxAgeDays: v[0] === 0 ? undefined : v[0] })
          }
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Minimum stock</Label>
          <span className="text-muted-foreground text-xs">
            {filters.stockMin ?? "any"}
          </span>
        </div>
        <Slider
          min={0}
          max={500}
          step={5}
          value={[filters.stockMin ?? 0]}
          onValueChange={(v: number[]) =>
            setFilters({ stockMin: v[0] === 0 ? undefined : v[0] })
          }
        />
      </div>

      <Separator />

      <Button variant="ghost" size="sm" onClick={reset} className="w-full">
        Reset filters
      </Button>
    </div>
  );
}

function RangeSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-muted-foreground text-xs">
          {value[0]}
          {unit} – {value[1]}
          {unit}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v: number[]) => onChange([v[0] ?? min, v[1] ?? max])}
      />
    </div>
  );
}

function ActiveChips({
  filters,
  setFilters,
  reset,
}: {
  filters: SearchFiltersState;
  setFilters: (patch: Partial<SearchFiltersState>) => void;
  reset: () => void;
}) {
  const chips: { key: string; label: string; clear: () => void }[] = [];

  if (filters.search)
    chips.push({
      key: "search",
      label: `“${filters.search}”`,
      clear: () => setFilters({ search: "" }),
    });
  if (filters.categories.length > 0)
    chips.push({
      key: "categories",
      label: filters.categories.join(", "),
      clear: () => setFilters({ categories: [] }),
    });
  if (filters.priceMin !== undefined || filters.priceMax !== undefined)
    chips.push({
      key: "price",
      label: `Price ${filters.priceMin ?? 0}–${filters.priceMax ?? "∞"}`,
      clear: () =>
        setFilters({ priceMin: undefined, priceMax: undefined }),
    });
  if (filters.ratingMin !== undefined)
    chips.push({
      key: "rating",
      label: `≥ ${filters.ratingMin}★`,
      clear: () => setFilters({ ratingMin: undefined }),
    });
  if (filters.location)
    chips.push({
      key: "location",
      label: `📍 ${filters.location}`,
      clear: () => setFilters({ location: "" }),
    });
  if (filters.inStockOnly)
    chips.push({
      key: "stock",
      label: "In stock",
      clear: () => setFilters({ inStockOnly: false }),
    });
  if (filters.maxAgeDays !== undefined)
    chips.push({
      key: "age",
      label: `≤ ${filters.maxAgeDays}d old`,
      clear: () => setFilters({ maxAgeDays: undefined }),
    });
  if (filters.stockMin !== undefined)
    chips.push({
      key: "stockMin",
      label: `Stock ≥ ${filters.stockMin}`,
      clear: () => setFilters({ stockMin: undefined }),
    });
  if (filters.sort !== "newest")
    chips.push({
      key: "sort",
      label: `Sort: ${filters.sort}`,
      clear: () => setFilters({ sort: "newest" }),
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          className="bg-muted/40 hover:bg-muted text-foreground inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
        >
          {c.label}
          <X className="size-3" />
        </button>
      ))}
      <button
        type="button"
        onClick={reset}
        className="text-muted-foreground hover:text-foreground text-xs underline"
      >
        Clear all
      </button>
    </div>
  );
}

function PopularSearches({ onPick }: { onPick: (term: string) => void }) {
  const [popular, setPopular] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchPopularSearches();
        if (!cancelled) setPopular(list.slice(0, 8));
      } catch {
        if (!cancelled) setPopular([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (popular.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs uppercase">Popular</span>
      {popular.map((term) => (
        <button
          key={term}
          type="button"
          onClick={() => onPick(term)}
          className="hover:bg-muted/40 text-muted-foreground hover:text-foreground rounded-full border px-2.5 py-0.5 text-xs transition-colors"
        >
          {term}
        </button>
      ))}
    </div>
  );
}

function SavedSearchesDialog({
  open,
  onClose,
  saved,
  savedLoading,
  removeSaved,
  toggleAlerts,
  applySaved,
}: {
  open: boolean;
  onClose: () => void;
  saved: SavedSearch[];
  savedLoading: boolean;
  removeSaved: (id: string) => Promise<void>;
  toggleAlerts: (
    id: string,
    channel: "email" | "push",
    value: boolean,
  ) => Promise<void>;
  applySaved: (s: SavedSearch) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Saved Searches</DialogTitle>
          <DialogDescription>
            Reuse a search and manage alerts for new matches.
          </DialogDescription>
        </DialogHeader>

        {savedLoading ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Loading…
          </p>
        ) : saved.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No saved searches yet. Configure filters and click “Save current”.
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {saved.map((s) => (
              <li key={s.id} className="space-y-2 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {summarizeFilters(s)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applySaved(s)}
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void removeSaved(s.id)}
                      aria-label={`Delete saved search ${s.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={s.emailAlerts}
                      onCheckedChange={(checked: boolean) =>
                        void toggleAlerts(s.id, "email", checked)
                      }
                    />
                    <Mail className="size-3.5" />
                    Email
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={s.pushAlerts}
                      onCheckedChange={(checked: boolean) =>
                        void toggleAlerts(s.id, "push", checked)
                      }
                    />
                    {s.pushAlerts ? (
                      <Bell className="size-3.5" />
                    ) : (
                      <BellOff className="size-3.5" />
                    )}
                    Push
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateSavedSearchDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    options: { emailAlerts: boolean; pushAlerts: boolean },
  ) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(false);
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim(), { emailAlerts: email, pushAlerts: push });
      setName("");
      setEmail(false);
      setPush(true);
    } finally {
      setBusy(false);
    }
  }, [name, email, push, onSave]);

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this search</DialogTitle>
          <DialogDescription>
            Name your filter set and choose how you’d like to be notified about
            new matches.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="saved-name">Name</Label>
            <Input
              id="saved-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cheap tomatoes near Lagos"
            />
          </div>
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="flex items-center gap-2 text-sm">
              <Mail className="size-4" />
              Email alerts
            </span>
            <Switch
              checked={email}
              onCheckedChange={(c: boolean) => setEmail(c)}
            />
          </label>
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="flex items-center gap-2 text-sm">
              <Bell className="size-4" />
              Push notifications
            </span>
            <Switch
              checked={push}
              onCheckedChange={(c: boolean) => setPush(c)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function summarizeFilters(s: SavedSearch): string {
  const f = s.filters;
  const parts: string[] = [];
  if (f.search) parts.push(`“${f.search}”`);
  if (f.categories?.length) parts.push(f.categories.join("/"));
  if (f.priceMin !== undefined || f.priceMax !== undefined)
    parts.push(`${f.priceMin ?? 0}–${f.priceMax ?? "∞"}`);
  if (f.ratingMin !== undefined) parts.push(`≥${f.ratingMin}★`);
  if (f.location) parts.push(`📍${f.location}`);
  if (f.inStockOnly) parts.push("in stock");
  if (f.maxAgeDays !== undefined) parts.push(`≤${f.maxAgeDays}d`);
  if (f.stockMin !== undefined) parts.push(`stock≥${f.stockMin}`);
  if (f.sort && f.sort !== "newest") parts.push(`sort:${f.sort}`);
  return parts.length > 0 ? parts.join(" · ") : "All products";
}

"use client";

import { useEffect, useState } from "react";
import { Key, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPost, apiDelete } from "@/lib/apiHelper";

interface IntegratorKey {
  id: string;
  organizationName: string;
  apiKey?: string;
  scopedFarmerWallets?: string[];
  scopedRegion?: string;
  createdAt: string;
  createdByAdmin: string;
  revokedAt?: string | null;
}

export default function IntegratorKeysPage() {
  const [keys, setKeys] = useState<IntegratorKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Form state
  const [orgName, setOrgName] = useState("");
  const [farmerWallets, setFarmerWallets] = useState("");
  const [region, setRegion] = useState("");

  useEffect(() => {
    void loadKeys();
  }, []);

  async function loadKeys() {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiGet<IntegratorKey[]>("/admin/integrator/keys");
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate() {
    if (!orgName.trim()) {
      setError("Organization name is required");
      return;
    }

    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: {
        organizationName: string;
        scopedFarmerWallets?: string[];
        scopedRegion?: string;
      } = {
        organizationName: orgName.trim(),
      };

      if (farmerWallets.trim()) {
        payload.scopedFarmerWallets = farmerWallets
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean);
      }

      if (region.trim()) {
        payload.scopedRegion = region.trim();
      }

      const created = await apiPost<IntegratorKey>(
        "/admin/integrator/keys",
        payload,
      );
      setKeys([created, ...keys]);
      setSuccess(`API key created for ${orgName}`);

      // Reset form
      setOrgName("");
      setFarmerWallets("");
      setRegion("");
      setShowCreateForm(false);

      // Auto-reveal the new key
      if (created.id) {
        setRevealedKeys(new Set([created.id]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(keyId: string, orgName: string) {
    if (
      !confirm(`Revoke API key for ${orgName}? This action cannot be undone.`)
    ) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await apiDelete(`/admin/integrator/keys/${keyId}`);
      setKeys(
        keys.map((k) =>
          k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k,
        ),
      );
      setSuccess(`API key revoked for ${orgName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }

  function toggleReveal(keyId: string) {
    const next = new Set(revealedKeys);
    if (next.has(keyId)) {
      next.delete(keyId);
    } else {
      next.add(keyId);
    }
    setRevealedKeys(next);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Integrator API Keys"
        description="Manage scoped API keys for external NGOs, cooperatives, and government programs."
      >
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          <Plus className="mr-2 size-4" />
          Create Key
        </Button>
      </PageHeader>

      {error && (
        <div className="bg-destructive/10 border-destructive/30 rounded-lg border p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
          {success}
        </div>
      )}

      {showCreateForm && (
        <Card className="rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Key className="text-primary size-5" />
            <h2 className="text-lg font-semibold">Create New API Key</h2>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name *</Label>
              <Input
                id="org-name"
                placeholder="e.g. Ghana Farmers Association"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="farmer-wallets">
                Scoped Farmer Wallets (Optional)
              </Label>
              <Textarea
                id="farmer-wallets"
                placeholder="Comma-separated wallet addresses, e.g. GA..., GB..."
                rows={3}
                value={farmerWallets}
                onChange={(e) => setFarmerWallets(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Limit this key to specific farmer wallets. Leave blank for
                region-based scope.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Scoped Region (Optional)</Label>
              <Input
                id="region"
                placeholder="e.g. Kumasi, Ghana"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Limit this key to a specific geographic region.
              </p>
            </div>

            <div className="flex gap-3">
              <Button onClick={handleCreate} isLoading={isCreating}>
                Create API Key
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateForm(false);
                  setOrgName("");
                  setFarmerWallets("");
                  setRegion("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="rounded-2xl border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">
          Active Keys ({keys.filter((k) => !k.revokedAt).length})
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-secondary/50 rounded-lg h-24 animate-pulse"
              />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center">
            <Key className="mx-auto mb-3 size-12 opacity-20" />
            <p>No API keys created yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`rounded-xl border p-4 ${
                  key.revokedAt ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{key.organizationName}</h3>
                      {key.revokedAt && (
                        <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
                          Revoked
                        </span>
                      )}
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-muted-foreground text-xs font-medium">
                          API Key:
                        </p>
                        <code className="bg-secondary flex-1 rounded px-2 py-1 font-mono text-xs">
                          {key.apiKey
                            ? revealedKeys.has(key.id)
                              ? key.apiKey
                              : "••••••••••••••••••••••••••••••••"
                            : "Hidden (key was previously generated)"}
                        </code>
                        {key.apiKey && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => toggleReveal(key.id)}
                          >
                            {revealedKeys.has(key.id) ? (
                              <EyeOff className="size-3.5" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                          </Button>
                        )}
                      </div>

                      {key.scopedFarmerWallets &&
                        key.scopedFarmerWallets.length > 0 && (
                          <p className="text-muted-foreground text-xs">
                            <strong>Scope:</strong>{" "}
                            {key.scopedFarmerWallets.length} farmer wallet(s)
                          </p>
                        )}

                      {key.scopedRegion && (
                        <p className="text-muted-foreground text-xs">
                          <strong>Region:</strong> {key.scopedRegion}
                        </p>
                      )}

                      <p className="text-muted-foreground text-xs">
                        <strong>Created:</strong>{" "}
                        {new Date(key.createdAt).toLocaleString()} by{" "}
                        {key.createdByAdmin.slice(0, 6)}...
                      </p>

                      {key.revokedAt && (
                        <p className="text-muted-foreground text-xs">
                          <strong>Revoked:</strong>{" "}
                          {new Date(key.revokedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  {!key.revokedAt && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        void handleRevoke(key.id, key.organizationName)
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

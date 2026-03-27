"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Text, Button, Input, Badge } from "@/components/ui";
import { useWallet } from "@/hooks/useWallet";

interface FarmerSettingsProps {
  farmerAddress: string;
}

interface SettingsState {
  farmName: string;
  farmDescription: string;
  location: string;
  contactEmail: string;
  contactPhone: string;
  deliveryRadius: string;
  minimumOrder: string;
  notificationSettings: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
}

export default function FarmerSettings({ farmerAddress }: FarmerSettingsProps) {
  const { address } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [settings, setSettings] = useState<SettingsState>({
    farmName: "",
    farmDescription: "",
    location: "",
    contactEmail: "",
    contactPhone: "",
    deliveryRadius: "10",
    minimumOrder: "1",
    notificationSettings: {
      email: true,
      sms: false,
      push: true,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChange = (field: keyof SettingsState, value: any) => {
    setSettings(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleNotificationChange = (type: keyof SettingsState["notificationSettings"]) => {
    setSettings(prev => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        [type]: !prev.notificationSettings[type],
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;

    setIsLoading(true);
    setMessage(null);

    try {
      // In a real implementation, this would save to your backend
      console.log("Saving settings:", settings);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      setMessage({ type: "success", text: "Settings saved successfully!" });
    } catch {
      setMessage({ type: "error", text: "Failed to save settings. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Text variant="h3" as="h3">Farm Settings</Text>
        <Text variant="body" muted>Manage your farm profile and preferences</Text>
      </div>

      {/* Profile Settings */}
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle>Farm Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Farm Name"
                value={settings.farmName}
                onChange={(e) => handleChange("farmName", e.target.value)}
                placeholder="My Organic Farm"
              />
              <Input
                label="Location"
                value={settings.location}
                onChange={(e) => handleChange("location", e.target.value)}
                placeholder="Nairobi, Kenya"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Farm Description</label>
              <textarea
                value={settings.farmDescription}
                onChange={(e) => handleChange("farmDescription", e.target.value)}
                className="w-full p-2 border rounded-md"
                rows={3}
                placeholder="Tell buyers about your farm and farming practices..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Contact Email"
                value={settings.contactEmail}
                onChange={(e) => handleChange("contactEmail", e.target.value)}
                type="email"
                placeholder="farmer@example.com"
              />
              <Input
                label="Contact Phone"
                value={settings.contactPhone}
                onChange={(e) => handleChange("contactPhone", e.target.value)}
                placeholder="+254 700 000 000"
              />
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Delivery Settings */}
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle>Delivery Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Delivery Radius (km)"
              value={settings.deliveryRadius}
              onChange={(e) => handleChange("deliveryRadius", e.target.value)}
              type="number"
              min="1"
              max="100"
            />
            <Input
              label="Minimum Order (XLM)"
              value={settings.minimumOrder}
              onChange={(e) => handleChange("minimumOrder", e.target.value)}
              type="number"
              step="0.01"
              min="0"
            />
          </div>

          <div className="bg-muted/30 p-4 rounded-lg">
            <Text variant="h4" as="h4" className="mb-2">Delivery Information</Text>
            <Text variant="bodySmall" muted>
              • You deliver within {settings.deliveryRadius} km radius
            </Text>
            <Text variant="bodySmall" muted>
              • Minimum order amount: {settings.minimumOrder} XLM
            </Text>
            <Text variant="bodySmall" muted>
              • Delivery time: 2-3 business days
            </Text>
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Text variant="body">Email Notifications</Text>
                <Text variant="caption" muted>Receive order updates via email</Text>
              </div>
              <input
                type="checkbox"
                checked={settings.notificationSettings.email}
                onChange={() => handleNotificationChange("email")}
                className="w-4 h-4"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Text variant="body">SMS Notifications</Text>
                <Text variant="caption" muted>Get text messages for urgent updates</Text>
              </div>
              <input
                type="checkbox"
                checked={settings.notificationSettings.sms}
                onChange={() => handleNotificationChange("sms")}
                className="w-4 h-4"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Text variant="body">Push Notifications</Text>
                <Text variant="caption" muted>Browser notifications for new orders</Text>
              </div>
              <input
                type="checkbox"
                checked={settings.notificationSettings.push}
                onChange={() => handleNotificationChange("push")}
                className="w-4 h-4"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Information */}
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Text variant="caption" muted className="block mb-1">Wallet Address</Text>
            <Text variant="bodySmall" className="font-mono bg-muted p-2 rounded">
              {farmerAddress}
            </Text>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <Text variant="caption" muted className="block mb-1">Account Status</Text>
              <Badge variant="success">Active</Badge>
            </div>
            <div>
              <Text variant="caption" muted className="block mb-1">Member Since</Text>
              <Text variant="bodySmall">January 2024</Text>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex gap-4">
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={isLoading}
          className="min-w-32"
        >
          {isLoading ? "Saving..." : "Save Settings"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            // Reset form to initial state
            setSettings({
              farmName: "",
              farmDescription: "",
              location: "",
              contactEmail: "",
              contactPhone: "",
              deliveryRadius: "10",
              minimumOrder: "1",
              notificationSettings: {
                email: true,
                sms: false,
                push: true,
              },
            });
          }}
        >
          Reset
        </Button>
      </div>

      {/* Message Display */}
      {message && (
        <Card
          variant="elevated"
          padding="lg"
          className={
            message.type === "success"
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }
        >
          <CardContent>
            <Text
              variant="body"
              className={message.type === "success" ? "text-green-700" : "text-red-700"}
            >
              {message.text}
            </Text>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

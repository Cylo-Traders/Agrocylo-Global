"use client";

import React, { useState } from "react";
import { 
  Badge, 
  Button, 
  Text 
} from "@/components/ui";
import DisputeActionModal from "./DisputeActionModal";

interface DisputeListProps {
  disputes: any[];
  onRefresh: () => void;
}

export default function DisputeList({ disputes, onRefresh }: DisputeListProps) {
  const [selectedDispute, setSelectedDispute] = useState<any | null>(null);

  const getStatusVariant = (status: string): any => {
    switch (status.toUpperCase()) {
      case "OPEN":
        return "warning";
      case "RESOLVED":
        return "success";
      case "REJECTED":
        return "error";
      default:
        return "default";
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="py-3 px-4 text-xs font-semibold uppercase text-muted-foreground">Order ID</th>
            <th className="py-3 px-4 text-xs font-semibold uppercase text-muted-foreground">Raised By</th>
            <th className="py-3 px-4 text-xs font-semibold uppercase text-muted-foreground">Reason</th>
            <th className="py-3 px-4 text-xs font-semibold uppercase text-muted-foreground">Status</th>
            <th className="py-3 px-4 text-xs font-semibold uppercase text-muted-foreground text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {disputes.map((dispute) => (
            <tr key={dispute.id} className="hover:bg-muted/30 transition-colors">
              <td className="py-4 px-4 font-mono text-xs">{dispute.orderIdOnChain || dispute.order?.orderIdOnChain}</td>
              <td className="py-4 px-4 font-mono text-xs truncate max-w-[120px]">{dispute.raisedBy}</td>
              <td className="py-4 px-4 text-sm truncate max-w-[200px]">{dispute.reason || "No reason provided"}</td>
              <td className="py-4 px-4">
                <Badge variant={getStatusVariant(dispute.status)}>{dispute.status}</Badge>
              </td>
              <td className="py-4 px-4 text-right">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setSelectedDispute(dispute)}
                  disabled={dispute.status === "RESOLVED" || dispute.status === "REJECTED"}
                >
                  Manage
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedDispute && (
        <DisputeActionModal 
          dispute={selectedDispute} 
          onClose={() => setSelectedDispute(null)} 
          onSuccess={() => {
            setSelectedDispute(null);
            onRefresh();
          }} 
        />
      )}
    </div>
  );
}

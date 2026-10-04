"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PermissionDenied, ToneBadge } from "@/components/ui/tone-badge";
import { Plus } from "lucide-react";
import React, { useState } from "react";

import { whatsappLink } from "../../../utils";
import type { SupplierCapabilities, SupplierContactRow, SupplierProfile } from "../../../types";
import AddEditContactDialog from "../add-edit-contact-dialog";

interface ContactsTabProps {
  profile: SupplierProfile;
  can: SupplierCapabilities;
}

export default function ContactsTab({ profile, can }: ContactsTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierContactRow | null>(null);

  if (!can.viewContacts && !can.viewEmergencyContactsOnly) {
    return <PermissionDenied what="Contacts" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {can.manageContacts && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> Add Contact
          </Button>
        </div>
      )}

      {profile.contacts.length === 0 ? (
        <EmptyState title="No contacts recorded" description="Add the people Operations should reach for this supplier." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profile.contacts.map((contact) => (
            <Card
              key={contact.id}
              className={can.manageContacts ? "gap-2 cursor-pointer" : "gap-2"}
              onClick={
                can.manageContacts
                  ? () => {
                      setEditing(contact);
                      setDialogOpen(true);
                    }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{contact.name}</span>
                <div className="flex gap-1">
                  {contact.is_primary && <ToneBadge tone="brand" label="Primary" />}
                  {contact.is_emergency && <ToneBadge tone="danger" label="Emergency" />}
                </div>
              </div>
              {contact.role_title && <p className="text-xs text-muted-foreground">{contact.role_title}</p>}
              {contact.whatsapp_number && (
                <a
                  href={whatsappLink(contact.whatsapp_number)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-primary hover:underline"
                >
                  WhatsApp: {contact.whatsapp_number}
                </a>
              )}
              {contact.languages && <p className="text-xs text-muted-foreground">{contact.languages}</p>}
              {contact.notes && <p className="text-xs text-muted-foreground">{contact.notes}</p>}
            </Card>
          ))}
        </div>
      )}

      {can.manageContacts && (
        <AddEditContactDialog supplierId={profile.supplier.id} open={dialogOpen} existing={editing} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

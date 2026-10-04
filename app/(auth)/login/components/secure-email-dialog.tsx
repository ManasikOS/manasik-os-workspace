import { Dialog, DialogContent } from "@/components/ui/dialog";
import React from "react";

interface SecureEmailDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  email: string;
}
const SecureEmailDialog = ({ open, setOpen, email }: SecureEmailDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className={"text-center gap-0"}>
        <h2 className="text-3xl tracking-tighter font-medium">
          Check your inbox
        </h2>

        <p className="mt-2">
          We’ve sent a secure sign-in link to
          <br />
          <span className="text-primary">{email}</span>
        </p>
      </DialogContent>
    </Dialog>
  );
};

export default SecureEmailDialog;

import React from "react";
import { InputGroupText } from "./input-group";

interface FormDataLabelProps {
  label: string;
  value: string;
}
const FormDataLabel = ({ label, value }: FormDataLabelProps) => {
  return (
    <div>
      <InputGroupText className="text-xs text-muted-foreground">
        {label}
      </InputGroupText>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
};

export default FormDataLabel;

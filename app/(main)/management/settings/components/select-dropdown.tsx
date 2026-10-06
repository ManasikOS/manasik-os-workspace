"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

/** Single-select dropdown over a plain options list — same composition as `SelectDropdown` in the Team invite dialog. */
export function SelectDropdown({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  label?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled}>
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>{label}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            value={selected?.label ?? ""}
            placeholder={placeholder}
            disabled={disabled}
            className="cursor-pointer"
          />
          {/* <ChevronDown className="size-4 text-muted-foreground mr-2" /> */}
        </InputGroup>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-56 max-h-72 overflow-y-auto custom-scroll"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

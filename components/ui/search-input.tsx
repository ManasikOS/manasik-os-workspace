import React from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "./input-group";
import { Search, X } from "lucide-react";
import { Button } from "./button";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Lets a keyboard shortcut find and focus the field. */
  id?: string;
  ariaKeyShortcuts?: string;
}
const SearchInput = ({ value, onChange, placeholder, id, ariaKeyShortcuts }: SearchInputProps) => {
  return (
    <InputGroup className="autofill-transparent bg-card/50 aria-[invalid]:bg-destructive/5 border focus:border-gray-200/70! dark:focus:border-gray-200/10! border-gray-200/30 dark:border-card/40 shadow-xs group/input-group dark:bg-gray-100/3 rounded-sm h-fit">
      <InputGroupAddon>
        <InputGroupText>
          <Search className="size-4 text-muted-foreground" />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        aria-keyshortcuts={ariaKeyShortcuts}
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="border-none! bg-transparent! shadow-none! h-10"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
          }}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </InputGroup>
  );
};

export default SearchInput;

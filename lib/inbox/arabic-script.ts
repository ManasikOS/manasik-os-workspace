/** True when the text contains any Arabic-script character, so a contact name can be shown in the Arabic typeface. */
export function containsArabicScript(value: string): boolean {
  return /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(value);
}

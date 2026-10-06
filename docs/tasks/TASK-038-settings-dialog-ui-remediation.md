# TASK-038 Settings Dialog UI Remediation

## What

Standardise the Settings dialog shell and every settings section so navigation,
loading, scrolling, headings, forms, empty states and actions remain clear and
usable from mobile through desktop. Preserve all existing data and behaviour.

## Why

The dialog currently mixes several independent scrolling containers and section
layouts. Dense forms can be clipped behind fixed footers, sparse action screens
stretch into large empty rows, several tabs lose their heading while loading,
and mobile users must swipe through fourteen pill-shaped navigation buttons.
Some settings inputs also bypass the repository's InputGroup and shadcn rules.

## Data model changes

None.

## Access control changes

None. Existing section visibility and edit capabilities remain authoritative.

## UI surfaces

- Shared Settings dialog navigation, section shell, loading, denied and error states.
- Organisation, Branches, Branding, Operational Defaults, Service Add-ons,
  Communication Templates, Finance Defaults and Integrations.
- Email & SMTP, WhatsApp Templates, WhatsApp Billing, Security & Access,
  Data & Audit and Danger Zone.
- Shared field and toggle compositions used by those sections.

### Visual contract

- One vertical content scroller per active section; section actions remain visible
  without covering the final fields.
- Every tab keeps a visible H2 title and concise description in the same position.
- Desktop navigation shows complete labels with an active-state announcement;
  mobile navigation uses one labelled shadcn Select rather than a long pill strip.
- Form controls use shadcn components and the repository InputGroup composition.
- Dense controls use the token spacing scale; action rows size to their content.
- Loading, denied, error and empty states retain the active section's context.
- Keyboard focus, labels, status announcements and 320 px layout remain usable.

## Test plan

- Run `npm run lint`, `npm run typecheck`, and `npm run test`.
- Browser-audit all fourteen tabs at desktop width for clipping, nested scroll,
  console errors, headings and focusable controls.
- Browser-audit representative dense and sparse tabs at 320 px and 768 px.
- Verify keyboard navigation, active section semantics, mobile section selection,
  loading/error affordances, and that destructive actions still require their
  existing confirmation dialogs.

## Status

In progress.

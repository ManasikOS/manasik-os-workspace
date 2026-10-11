# Add Lead screen: browser verification

The manual check for the Add Lead screen at `/leads/new` (TASK-045). Type and
test passes prove the rules; this proves the screen works. Run it after any
change to the screen, the duplicate check or `createLeadAction`.

## Before you start

- Sign in as a role with `createLead` (Admin or Marketing). A second session
  as Operations is needed for the permission checks.
- Have one lead you can match against: note its mobile and, if it has one, its
  email. Create it first if the agency has none.
- Dev server: `npm run dev`, then `https://localhost:3000/leads/new`.

## Checks

| # | Do | Expect |
|---|---|---|
| 1 | Open `/leads`, press **Add Lead** | The page `/leads/new` opens; no dialog. Breadcrumb reads Home > Leads > New. |
| 2 | Open `/leads/new` directly as Operations | 404. The **Add Lead** button is not on `/leads` for that role. |
| 3 | Step 1, type a mobile that nobody uses | "Checking for an existing lead…", then "No existing lead uses this number." Continue works. |
| 4 | Step 1, type the noted mobile | A warning card names the existing lead (reference, owner, stage). Continue is blocked with "Select a reason…". |
| 5 | Choose a reason, tick **Proceed with creation** | Continue works. Untick: blocked again. |
| 6 | Type the mobile in different forms: `0771234567`, `+94 77 123 4567`, `94771234567` | All match the same lead. |
| 7 | Go on to step 2, enter the noted email with a new mobile | On steps 2 to 6 a notice names the lead, with **Review duplicate**; the button returns to step 1. |
| 8 | Step 2, leave name empty and press **Continue** | Message under the field and in the footer; focus moves to the field. |
| 9 | Step 2, type `abc` as email | Email message appears. |
| 10 | Step 5, set a follow-up in the past | "Follow-up time cannot be in the past"; Continue blocked. There is no switch to skip the follow-up. |
| 11 | Step 6, press **Create lead** | A "Creating lead…" toast appears at once, then "Lead LD-… created". You land on `/leads?open=<id>` with the lead's drawer open and the lead in the list. |
| 12 | In tab A reach step 6 with a new mobile. In tab B create a lead with that same mobile. In tab A press **Create lead** | Creation is refused with "This looks like an existing lead…"; the form is kept. (The server rule is also covered by `actions.create-lead.test.ts`.) |
| 13 | Step 6, **Create and add another** | The lead is created, the form is blank except source, owner and journey type, and step 1 is open. |
| 14 | Block the network (devtools offline) while on step 1 and type a mobile | "We could not check just now…"; Continue is allowed. |
| 15 | Edit any field, then press **Cancel** | Prompt "Discard unsaved lead?". **Keep Editing** stays; **Discard Changes** goes to `/leads`. |
| 16 | Edit any field, then click a sidebar link, then the browser Back button | The same prompt each time. Closing the tab shows the browser's own prompt. |
| 17 | Change nothing, press **Cancel** | Leaves at once, no prompt. |
| 18 | Press Escape or click outside the prompt | Stays on the form. |
| 19 | Widths 320, 768, 1024, 1440 px; light and dark | Stepper switches to the compact strip when narrow; footer stays in view; nothing clipped; the form is not stretched awkwardly at 1440. |
| 20 | Keyboard only | Tab order runs stepper, form, footer; focus lands on the step heading after Continue; the prompt traps and restores focus. |
| 21 | Network tab on `/leads/new` | Only packages and staff are read on load; no lead rows. |

## Results

Record the date, the role used and any check that failed in the PR that
touches this screen. TASK-045 stays "In progress" until checks 1 to 21 pass.

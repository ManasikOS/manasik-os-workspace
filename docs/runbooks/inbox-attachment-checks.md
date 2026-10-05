# Inbox attachment checks

SEC-8 of [`docs/progress/2026-10-05-inbox-security-and-bug-audit.md`](../progress/2026-10-05-inbox-security-and-bug-audit.md). What happens to a
file before it is sent from the Inbox, what each check can and cannot catch, and what the `scan_status` values mean **today**.

## The most important thing to know

**Nothing here is a virus scanner.** The checks are a *policy filter*: they decide what an agency should send a customer. They do not recognise
malware. A file that passes is recorded as unscanned.

## What a staff-sent file goes through

In order, on the server, when the person presses Send (the browser's own checks are only a friendly early warning):

| Step | Where | What it does |
|---|---|---|
| 1. Type and channel | `staff-attachment.ts`, `staged-file.ts` | Only JPG, PNG, PDF, DOCX, XLSX, PPTX. Instagram carries photos only. The path must be exactly this agency's and this conversation's. |
| 2. Size, from the stored record | `staged-file.ts` | The size is read from the stored object's own record **before** it is downloaded. Photos up to 5 MB, documents up to 10 MB. Over the limit: refused, and the file is deleted. |
| 3. Signature and size, from the bytes | `staff-attachment.ts` | The file must start like its type (a PNG starts like a PNG) and fit the limit. |
| 4. Deep look | `file-inspection.ts` | PDF and Office files, below. |
| 5. Queued | the `enqueue_inbox_media_message` function | Only the size and checksum read from storage are recorded, never the browser's. A refused file is deleted so a later request cannot send it. |

**PDF** (`inspectPdf`): refused if it contains a script, launch action, attached file, rich media, XFA form, form-submit or remote-go-to action
(`/JavaScript`, `/Launch`, `/EmbeddedFile(s)`, `/RichMedia`, `/XFA`, `/SubmitForm`, `/ImportData`, `/GoToR`, `/GoToE`). Names are read the way a PDF
reader reads them, so `/Java#53cript` counts as `/JavaScript`. A bare `/JS` is not on the list because a script action cannot run without the name
`/JavaScript`, and three bytes turn up by chance in the compressed images of large, ordinary PDFs. Compressed object streams, where a PDF keeps its dictionaries, are unpacked (with a size
limit) and checked too. Refused because it **cannot be looked at**: password-protected PDFs, and object streams in any compression other than plain
Flate. An `/OpenAction` that only opens a page, and ordinary links, are allowed.

**Word, Excel, PowerPoint** (`inspectOoxml`): the file must be a real ZIP with the structure of what it claims to be (`word/` for .docx, `xl/` for .xlsx,
`ppt/` for .pptx), so an ordinary ZIP can no longer pass as a Word file. Refused if it holds a macro (`vbaProject`), an Excel 4.0 macro sheet, an ActiveX
control, an embedded object, or a program or script of any kind, or if its content types declare any of those. Refused because it cannot be looked at:
encrypted entries, ZIP64, an entry count or declared size far beyond a normal document.

Every read is bounded, so a crafted file cannot make the server use unbounded memory or time.

## What it cannot catch

- Malware that hides in a way these checks do not look for. A PDF or Office file can be harmful without any of the markers above.
- Anything inside a photo.
- A file that is genuine and harmful by content (a link to a phishing page).
- Compressed streams other than PDF object streams, and the contents of the Office parts themselves (only their names and declared types are checked).

## What `scan_status` means today

`message_attachments.scan_status` is `PENDING`, `CLEAN`, `QUARANTINED` or `FAILED`. **No scanner runs, so the values do not mean what their names say.**

| Value | Set by | What it really means |
|---|---|---|
| `PENDING` | a file staff send from the Inbox | Passed the policy filter. Never scanned. Nothing moves it on. |
| `CLEAN` | a file a customer sends on WhatsApp (`lib/inbox/media/handlers.ts`) or by email (`lib/channels/email/imap-poll.ts`) | **Fetched and stored. Not scanned.** |
| `QUARANTINED`, `FAILED` | nothing | Never written. |

The one place that *reads* the value is Finance evidence (`lib/data/finance-evidence-repository.ts`), which accepts only `CLEAN`. Because inbound files are marked
`CLEAN` without a scan, that is **not a security control today**: it only excludes outbound `PENDING` files.

## The upload size limit

The `inbox-attachments` bucket is private and has a 10 MiB `file_size_limit`, set by `20261202092400_mi5_4_message_media_analyses.sql` (it is re-applied if the
bucket already existed). Checked on both staging and production on 2026-10-05: 10,485,760 bytes. A test pins that migration value to the largest file the code
allows. Storage refuses an oversize upload; the size check in step 2 is a second barrier, so a misconfigured bucket cannot make the server download a huge file.

## A real scan: a decision for the business

Adding a scan means choosing where customer files are examined. Customer files include passports and payment receipts.

| Option | Customer files leave your infrastructure? | Notes |
|---|---|---|
| **ClamAV** run next to the always-on Inbox worker ([`inbox-worker.md`](inbox-worker.md)) | **No** | Free. Needs a small always-on container with its signature updates. Fits the existing `channel_jobs` queue: a scan job moves `PENDING` to `CLEAN` or `QUARANTINED`. Recommended. |
| A hosted scanning API | **Yes** | Needs a data-processing agreement and a decision on sending passports and receipts to a third party. Public services (for example VirusTotal) share what they receive, so they are not suitable. |
| None (today) | No | The policy filter above is all there is. |

Whichever is chosen, two further decisions follow: whether a send **waits** for the scan (safe but slower) or goes out and is pulled back if the scan later fails;
and what happens to a customer's file that is `QUARANTINED` (staff cannot open it). Neither is built.

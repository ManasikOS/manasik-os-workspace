import { z } from "zod";

/**
 * Zod schemas for the WhatsApp knowledge base Server Actions. See
 * docs/modules/whatsapp-knowledge-base-implementation-plan.md. The limits below mirror the
 * `knowledge-base` storage bucket (20261125090000_knowledge_base_foundations.sql), so a file the
 * form accepts is a file storage will accept.
 */

export const KNOWLEDGE_DOCUMENT_KINDS = ["POLICY", "FAQ", "VISA_AND_HEALTH", "GENERAL"] as const;
export const KNOWLEDGE_LANGUAGES = ["en", "si", "ta"] as const;
export const KNOWLEDGE_ALLOWED_MIME_TYPES = ["application/pdf", "text/plain", "text/markdown"] as const;
export const KNOWLEDGE_MAX_FILE_BYTES = 10 * 1024 * 1024;

export type KnowledgeDocumentKind = (typeof KNOWLEDGE_DOCUMENT_KINDS)[number];
export type KnowledgeLanguage = (typeof KNOWLEDGE_LANGUAGES)[number];

/** What staff see in the kind picker — plain words, not the stored codes. */
export const KNOWLEDGE_DOCUMENT_KIND_LABELS: Record<KnowledgeDocumentKind, string> = {
  POLICY: "Policy (cancellation, refunds, payments)",
  FAQ: "Frequently asked questions",
  VISA_AND_HEALTH: "Visa and health guidance",
  GENERAL: "Other guidance",
};

export const KNOWLEDGE_LANGUAGE_LABELS: Record<KnowledgeLanguage, string> = {
  en: "English",
  si: "Sinhala",
  ta: "Tamil",
};

export const knowledgeUploadSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the document a title so you can find it later.")
    .max(200, "Keep the title under 200 characters."),
  documentKind: z.enum(KNOWLEDGE_DOCUMENT_KINDS, { message: "Choose what kind of document this is." }),
  language: z.enum(KNOWLEDGE_LANGUAGES, { message: "Choose the language the document is written in." }),
  fileName: z.string().trim().min(1, "Choose a file to upload.").max(255),
  mimeType: z.enum(KNOWLEDGE_ALLOWED_MIME_TYPES, {
    message: "This file type isn't supported. Upload a PDF, a plain text file or a Markdown file.",
  }),
  byteSize: z
    .number()
    .int()
    .positive("This file is empty.")
    .max(KNOWLEDGE_MAX_FILE_BYTES, "This file is larger than 10 MB. Split it into smaller documents."),
});

/** The upload form's fields plus where the browser already put the file in the `knowledge-base` bucket. */
export const registerKnowledgeDocumentSchema = knowledgeUploadSchema.extend({
  storagePath: z.string().trim().min(1, "The uploaded file could not be found.").max(600),
});

export const KNOWLEDGE_ARTICLE_MAX_CHARS = 20_000;

/** A policy typed straight into the app. `documentId` is present when editing an existing one. */
export const knowledgeArticleSchema = knowledgeUploadSchema.pick({ title: true, documentKind: true, language: true }).extend({
  documentId: z.string().uuid("This document could not be found.").optional(),
  body: z
    .string()
    .trim()
    .min(20, "Write at least a couple of sentences so the assistant has something to use.")
    .max(KNOWLEDGE_ARTICLE_MAX_CHARS, "Keep this under 20,000 characters, or split it into separate documents."),
});

export const knowledgeDocumentIdSchema = z.object({
  documentId: z.string().uuid("This document could not be found."),
});

export const setKnowledgeDocumentActiveSchema = knowledgeDocumentIdSchema.extend({
  isActive: z.boolean(),
});

export type KnowledgeUploadInput = z.infer<typeof knowledgeUploadSchema>;

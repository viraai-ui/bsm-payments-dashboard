export const PAYMENT_PROOF_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,application/pdf";
export const PAYMENT_PROOF_MAX_FILES = 5;
export const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set(PAYMENT_PROOF_ACCEPT.split(","));
const ALLOWED_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|heic|heif|pdf)$/i;

type ProofFile = Pick<File, "name" | "size" | "type" | "lastModified">;

export type ProofSelectionResult<T extends ProofFile> = {
  files: T[];
  error: string;
  ignoredDuplicates: number;
};

const fingerprint = (file: ProofFile) =>
  `${file.name.toLocaleLowerCase()}\u0000${file.size}\u0000${file.type.toLocaleLowerCase()}\u0000${file.lastModified}`;

export function normalizePaymentProofFiles<T extends ProofFile>(
  current: readonly T[],
  incoming: readonly T[],
  mode: "append" | "replace",
): ProofSelectionResult<T> {
  if (!incoming.length) return { files: [...current], error: "No files were dropped.", ignoredDuplicates: 0 };

  const unsupported = incoming.find(file => !ALLOWED_TYPES.has(file.type.toLocaleLowerCase()) && !(file.type === "" && ALLOWED_EXTENSIONS.test(file.name)));
  if (unsupported) return { files: [...current], error: `“${unsupported.name}” is not a supported image or PDF.`, ignoredDuplicates: 0 };

  const invalidSize = incoming.find(file => !file.size || file.size > PAYMENT_PROOF_MAX_BYTES);
  if (invalidSize) return { files: [...current], error: `“${invalidSize.name}” must be non-empty and no larger than 10 MB.`, ignoredDuplicates: 0 };

  const base = mode === "append" ? [...current] : [];
  const seen = new Set(base.map(fingerprint));
  let ignoredDuplicates = 0;
  for (const file of incoming) {
    const key = fingerprint(file);
    if (seen.has(key)) {
      ignoredDuplicates += 1;
      continue;
    }
    seen.add(key);
    base.push(file);
  }

  if (base.length > PAYMENT_PROOF_MAX_FILES) {
    return { files: [...current], error: "Attach up to 5 images or PDFs.", ignoredDuplicates };
  }
  return {
    files: base,
    error: ignoredDuplicates ? `${ignoredDuplicates} duplicate ${ignoredDuplicates === 1 ? "file was" : "files were"} already selected.` : "",
    ignoredDuplicates,
  };
}

/** Remove exactly one locally staged proof. Persisted attachments are never involved. */
export function removePaymentProofFile<T extends ProofFile>(
  current: readonly T[],
  index: number,
): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= current.length) return [...current];
  return current.filter((_, fileIndex) => fileIndex !== index);
}

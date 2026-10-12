/** Maximum source-file size accepted from the Writer Studio. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_LABEL = '5 MB';

/**
 * Vercel Functions cap the complete request body at 4.5 MB. A 3 MiB binary
 * expands to 4 MiB as Base64, leaving safe room for the JSON envelope.
 */
export const MAX_IMAGE_TRANSPORT_BYTES = 3 * 1024 * 1024;

/**
 * Uploaded images are stored as Base64 in a Firestore document. Keep the
 * canonical image comfortably below Firestore's per-document ceiling after
 * Base64 expansion and metadata are included.
 */
export const MAX_STORED_IMAGE_BYTES = 700 * 1024;

/** Maximum long edge for the canonical web asset served to readers. */
export const MAX_STORED_IMAGE_DIMENSION = 2_400;

/** Shared browser/server decode limits used to prevent decompression bombs. */
export const MAX_IMAGE_DIMENSION = 8_192;
export const MAX_IMAGE_PIXELS = 32_000_000;

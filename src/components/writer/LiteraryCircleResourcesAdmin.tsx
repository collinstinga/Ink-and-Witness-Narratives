import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import type {
  AffiliateCampaign,
  Article,
  LiteraryCirclePromotionalResource,
  LiteraryCircleResourceDestination,
  LiteraryCircleResourceKind,
  LiteraryCircleResourceLibrary,
} from '../../types.js';
import {
  IMAGE_UPLOAD_ACCEPT,
  getImageUploadValidationError,
} from '../../utils/imageUploadPolicy.js';

export const MAX_LITERARY_CIRCLE_RESOURCES = 24;

const RESOURCE_KIND_OPTIONS: Array<{
  value: LiteraryCircleResourceKind;
  label: string;
}> = [
  { value: 'campaign_kit', label: 'Campaign kit' },
  { value: 'social_copy', label: 'Social caption or copy' },
  { value: 'piece_cover', label: 'Piece cover' },
  { value: 'excerpt', label: 'Approved excerpt' },
  { value: 'guidance', label: 'Campaign guidance' },
  { value: 'subscription_campaign', label: 'Reader Pass campaign' },
];

const DESTINATION_KIND_OPTIONS: Array<{
  value: LiteraryCircleResourceDestination['kind'];
  label: string;
}> = [
  { value: 'home', label: 'Homepage and full catalogue' },
  { value: 'piece', label: 'Published piece' },
  { value: 'collection', label: 'Collection' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'subscription', label: 'Reader Pass' },
];

const fieldClass = 'min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950/75 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60';

export interface LiteraryCircleResourcesAdminProps {
  library: LiteraryCircleResourceLibrary;
  articles: Article[];
  campaigns: AffiliateCampaign[];
  saving: boolean;
  uploadingResourceId?: string;
  onSaveLibrary: (
    nextLibrary: LiteraryCircleResourceLibrary,
  ) => Promise<LiteraryCircleResourceLibrary | void>;
  onUploadImage: (
    resourceId: string,
    file: File,
    assetAlt: string,
    expectedRevision: number,
  ) => Promise<LiteraryCircleResourceLibrary | void>;
  onRemoveImage: (
    resourceId: string,
    expectedRevision: number,
  ) => Promise<LiteraryCircleResourceLibrary | void>;
}

function copyLibrary(library: LiteraryCircleResourceLibrary): LiteraryCircleResourceLibrary {
  return {
    ...library,
    items: library.items.map(item => ({
      ...item,
      destination: { ...item.destination },
    })),
  };
}

function nextResourceId(items: LiteraryCirclePromotionalResource[], now: string): string {
  const used = new Set(items.map(item => item.id));
  const timestamp = Date.parse(now);
  const base = `resource-${Number.isFinite(timestamp) ? timestamp.toString(36) : Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function createLiteraryCircleResourceDraft(
  library: LiteraryCircleResourceLibrary,
  now = new Date().toISOString(),
): LiteraryCirclePromotionalResource {
  return {
    id: nextResourceId(library.items, now),
    kind: 'campaign_kit',
    title: 'New promotional resource',
    description: '',
    body: '',
    destination: { kind: 'home' },
    isPublished: false,
    order: library.items.length,
    createdAt: now,
    updatedAt: now,
  };
}

export function isMeaningfulResourceAltText(value?: string): boolean {
  const normalized = (value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 5 || normalized.length > 300) return false;
  return !/^(?:an?\s+)?(?:image|photo|photograph|picture|graphic|cover|art|artwork|asset|promotional\s+(?:image|graphic|artwork))[.!]?$/i.test(normalized);
}

function validOptionalIso(value?: string): boolean {
  return !value || Number.isFinite(Date.parse(value));
}

export function getLiteraryCircleResourceLibraryValidationError(
  library: LiteraryCircleResourceLibrary,
): string | null {
  if (!library.title.trim()) return 'Add a title for the promotional resources library.';
  if (library.title.trim().length > 120) return 'The library title must be 120 characters or fewer.';
  if (!library.description.trim()) return 'Add a short description for approved affiliates.';
  if (library.description.trim().length > 600) return 'The library description must be 600 characters or fewer.';
  if (library.items.length > MAX_LITERARY_CIRCLE_RESOURCES) {
    return `Keep the promotional library to ${MAX_LITERARY_CIRCLE_RESOURCES} resources or fewer.`;
  }

  const ids = new Set<string>();
  for (const [index, item] of library.items.entries()) {
    const label = item.title.trim() || `Resource ${index + 1}`;
    if (!item.id.trim() || ids.has(item.id)) return `${label} needs a unique stable identifier.`;
    ids.add(item.id);
    if (!item.title.trim()) return `Resource ${index + 1} needs a title.`;
    if (item.title.trim().length > 120) return `${label} must use a title of 120 characters or fewer.`;
    if ((item.description || '').trim().length > 500) return `${label} must use a description of 500 characters or fewer.`;
    if ((item.body || '').trim().length > 4_000) return `${label} must keep its approved copy to 4,000 characters or fewer.`;
    if (!Number.isSafeInteger(item.order) || item.order < 0 || item.order > 10_000) {
      return `${label} needs a whole-number display order between 0 and 10,000.`;
    }
    if (item.destination.kind !== 'home' && !item.destination.id.trim()) {
      return `${label} needs a destination ID for its ${item.destination.kind} link.`;
    }
    if (item.destination.kind !== 'home' && item.destination.id.trim().length > 128) {
      return `${label} has a destination ID longer than 128 characters.`;
    }
    if (item.campaignCode && !/^[a-z0-9_-]{1,64}$/i.test(item.campaignCode.trim())) {
      return `${label} has an invalid campaign code.`;
    }
    if (!validOptionalIso(item.publishedAt) || !validOptionalIso(item.expiresAt)) {
      return `${label} has an invalid publishing date.`;
    }
    if (
      item.publishedAt
      && item.expiresAt
      && Date.parse(item.expiresAt) <= Date.parse(item.publishedAt)
    ) {
      return `${label} must expire after its publish date.`;
    }
    if (item.assetId && !isMeaningfulResourceAltText(item.assetAlt)) {
      return `${label} needs meaningful alternative text for its promotional artwork.`;
    }
  }
  return null;
}

export function resourceIsoToLocalDateTime(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

export function resourceLocalDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export function getWriterResourceAssetUrl(assetId: string): string {
  return `/api/admin/affiliates/literary-circle/resource-assets/${encodeURIComponent(assetId)}`;
}

function resourceStatus(item: LiteraryCirclePromotionalResource, nowMs = Date.now()): {
  label: string;
  className: string;
} {
  if (!item.isPublished) {
    return { label: 'Draft', className: 'border-slate-600 bg-slate-800 text-slate-300' };
  }
  const startsAt = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
  if (Number.isFinite(startsAt) && startsAt > nowMs) {
    return { label: 'Scheduled', className: 'border-sky-600/60 bg-sky-950/70 text-sky-200' };
  }
  const expiresAt = item.expiresAt ? Date.parse(item.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= nowMs) {
    return { label: 'Expired', className: 'border-amber-600/60 bg-amber-950/70 text-amber-200' };
  }
  return { label: 'Published', className: 'border-emerald-600/60 bg-emerald-950/70 text-emerald-200' };
}

export const LiteraryCircleResourcesAdmin: React.FC<LiteraryCircleResourcesAdminProps> = ({
  library,
  articles,
  campaigns,
  saving,
  uploadingResourceId,
  onSaveLibrary,
  onUploadImage,
  onRemoveImage,
}) => {
  const idPrefix = useId().replace(/:/g, '');
  const [draft, setDraft] = useState(() => copyLibrary(library));
  const [dirty, setDirty] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mutationPending, setMutationPending] = useState(false);
  const editorLocked = mutationPending || saving || Boolean(uploadingResourceId);

  useEffect(() => {
    if (!dirty && !saving && !uploadingResourceId) setDraft(copyLibrary(library));
  }, [dirty, library, saving, uploadingResourceId]);

  const sortedItems = useMemo(
    () => [...draft.items].sort((left, right) => left.order - right.order || left.title.localeCompare(right.title)),
    [draft.items],
  );

  const markDirty = () => {
    setDirty(true);
    setError('');
    setNotice('');
  };

  const updateLibrary = (patch: Partial<LiteraryCircleResourceLibrary>) => {
    if (editorLocked) return;
    setDraft(current => ({ ...current, ...patch }));
    markDirty();
  };

  const updateResource = (
    resourceId: string,
    patch: Partial<LiteraryCirclePromotionalResource>,
  ) => {
    if (editorLocked) return;
    setDraft(current => ({
      ...current,
      items: current.items.map(item => item.id === resourceId
        ? { ...item, ...patch, updatedAt: new Date().toISOString() }
        : item),
    }));
    markDirty();
  };

  const updateDestinationKind = (
    item: LiteraryCirclePromotionalResource,
    kind: LiteraryCircleResourceDestination['kind'],
  ) => {
    const destination: LiteraryCircleResourceDestination = kind === 'home'
      ? { kind: 'home' }
      : {
          kind,
          id: item.destination.kind === 'home' ? '' : item.destination.id,
        };
    updateResource(item.id, { destination });
  };

  const addResource = () => {
    if (editorLocked) return;
    if (draft.items.length >= MAX_LITERARY_CIRCLE_RESOURCES) {
      setError(`The promotional library is limited to ${MAX_LITERARY_CIRCLE_RESOURCES} resources.`);
      return;
    }
    const resource = createLiteraryCircleResourceDraft(draft);
    setDraft(current => ({ ...current, items: [...current.items, resource] }));
    setEditingResourceId(resource.id);
    markDirty();
  };

  const deleteResource = (resource: LiteraryCirclePromotionalResource) => {
    if (editorLocked) return;
    if (!window.confirm(`Delete “${resource.title}” from the promotional library? This change takes effect after you save.`)) return;
    setDraft(current => ({
      ...current,
      items: current.items.filter(item => item.id !== resource.id),
    }));
    if (editingResourceId === resource.id) setEditingResourceId(null);
    markDirty();
  };

  const saveLibrary = async () => {
    if (editorLocked || !dirty) return;
    setError('');
    setNotice('');
    const validationError = getLiteraryCircleResourceLibraryValidationError(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setMutationPending(true);
    try {
      const saved = await onSaveLibrary(copyLibrary(draft));
      if (saved) setDraft(copyLibrary(saved));
      setDirty(false);
      setNotice('Promotional resources saved. Published items are now available to approved affiliates.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The promotional resources library could not be saved.');
    } finally {
      setMutationPending(false);
    }
  };

  const discardChanges = () => {
    if (editorLocked) return;
    setDraft(copyLibrary(library));
    setDirty(false);
    setEditingResourceId(null);
    setError('');
    setNotice('Unsaved promotional resource changes were discarded.');
  };

  const uploadImage = async (
    resource: LiteraryCirclePromotionalResource,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (dirty || editorLocked) {
      setError('Save the resource metadata before uploading promotional artwork.');
      return;
    }
    if (!library.items.some(item => item.id === resource.id)) {
      setError('Save this new resource before uploading promotional artwork.');
      return;
    }
    const fileError = getImageUploadValidationError(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    if (!isMeaningfulResourceAltText(resource.assetAlt)) {
      setError('Add meaningful alternative text before uploading promotional artwork.');
      return;
    }
    setError('');
    setNotice('');
    setMutationPending(true);
    try {
      const saved = await onUploadImage(
        resource.id,
        file,
        resource.assetAlt!.trim(),
        library.revision,
      );
      if (saved) setDraft(copyLibrary(saved));
      setNotice(`Artwork uploaded for “${resource.title}”.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The promotional artwork could not be uploaded.');
    } finally {
      setMutationPending(false);
    }
  };

  const removeImage = async (resource: LiteraryCirclePromotionalResource) => {
    if (dirty || editorLocked) {
      setError('Save the resource metadata before removing promotional artwork.');
      return;
    }
    if (!window.confirm(`Remove the promotional artwork from “${resource.title}”? Downloaded copies cannot be recalled.`)) return;
    setError('');
    setNotice('');
    setMutationPending(true);
    try {
      const saved = await onRemoveImage(resource.id, library.revision);
      if (saved) setDraft(copyLibrary(saved));
      setNotice(`Artwork removed from “${resource.title}”.`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'The promotional artwork could not be removed.');
    } finally {
      setMutationPending(false);
    }
  };

  const hasPersistedResource = (resourceId: string) => library.items.some(item => item.id === resourceId);
  const assetMutationBlocked = dirty || editorLocked;

  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      aria-busy={editorLocked}
      className="space-y-5 rounded-2xl border border-violet-300/20 bg-violet-950/10 p-4 sm:p-6"
    >
      <fieldset disabled={editorLocked} className="contents">
      <header className="flex flex-col gap-4 border-b border-violet-200/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
            Approved affiliate resources
          </p>
          <h3 id={`${idPrefix}-heading`} className="mt-1 font-serif text-2xl font-bold text-white">
            Promotional resources library
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
            Curate approved campaign kits, captions, covers, excerpts, and release guidance without changing affiliate commissions or reader ownership.
          </p>
        </div>
        <button
          type="button"
          onClick={addResource}
          disabled={editorLocked || draft.items.length >= MAX_LITERARY_CIRCLE_RESOURCES}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-2 text-xs font-bold text-violet-100 transition hover:bg-violet-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add resource
        </button>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-amber-300/30 bg-amber-950/20 p-4 text-sm leading-relaxed text-amber-100">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <p>
          <strong>Publishing makes promotional artwork shareable.</strong> Approved affiliates may download and redistribute it. Unpublishing, replacing, or deleting an item cannot recall copies that have already been downloaded.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-300">
          Library title
          <input
            className={`${fieldClass} mt-1.5`}
            value={draft.title}
            maxLength={120}
            onChange={event => updateLibrary({ title: event.target.value })}
          />
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs font-semibold text-slate-200">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={event => updateLibrary({ enabled: event.target.checked })}
            className="h-4 w-4 accent-violet-400"
          />
          Show the library to approved affiliates
        </label>
      </div>
      <label className="block text-xs font-semibold text-slate-300">
        Library description
        <textarea
          className={`${fieldClass} mt-1.5 min-h-24`}
          value={draft.description}
          maxLength={600}
          onChange={event => updateLibrary({ description: event.target.value })}
        />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-serif text-lg font-bold text-white">Resources</h4>
          <p className="mt-1 text-xs text-slate-400">
            {draft.items.length} of {MAX_LITERARY_CIRCLE_RESOURCES} resource slots used. Save metadata before uploading or removing artwork.
          </p>
        </div>
      </div>

      {draft.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-black/20 px-4 py-10 text-center">
          <ImageIcon aria-hidden="true" className="mx-auto h-7 w-7 text-violet-300/70" />
          <p className="mt-3 text-sm font-semibold text-slate-200">No promotional resources yet</p>
          <p className="mt-1 text-xs text-slate-500">Add a draft, review its copy and destination, then publish it when it is ready.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedItems.map(resource => {
            const status = resourceStatus(resource);
            const editing = editingResourceId === resource.id;
            const safeId = resource.id.replace(/[^a-zA-Z0-9_-]/g, '-');
            const panelId = `${idPrefix}-resource-${safeId}`;
            const persisted = hasPersistedResource(resource.id);
            const uploading = uploadingResourceId === resource.id;
            return (
              <article key={resource.id} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${status.className}`}>
                        {status.label}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-violet-300">
                        {RESOURCE_KIND_OPTIONS.find(option => option.value === resource.kind)?.label || resource.kind}
                      </span>
                    </div>
                    <h5 className="mt-2 truncate font-serif text-lg font-bold text-white">{resource.title || 'Untitled resource'}</h5>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">Stable ID: {resource.id}</p>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-start">
                    <button
                      type="button"
                      onClick={() => setEditingResourceId(editing ? null : resource.id)}
                      aria-expanded={editing}
                      aria-controls={panelId}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-violet-400/50 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    >
                      {editing ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}
                      {editing ? 'Close editor' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteResource(resource)}
                      disabled={editorLocked || uploading}
                      aria-label={`Delete ${resource.title || 'resource'}`}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-rose-300 transition hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {editing && (
                  <div id={panelId} className="space-y-4 border-t border-white/10 p-4 sm:p-5">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-xs font-semibold text-slate-300">
                        Resource type
                        <select
                          className={`${fieldClass} mt-1.5`}
                          value={resource.kind}
                          onChange={event => updateResource(resource.id, { kind: event.target.value as LiteraryCircleResourceKind })}
                        >
                          {RESOURCE_KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-300 xl:col-span-2">
                        Title
                        <input
                          className={`${fieldClass} mt-1.5`}
                          value={resource.title}
                          maxLength={120}
                          onChange={event => updateResource(resource.id, { title: event.target.value })}
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-300">
                        Display order
                        <input
                          className={`${fieldClass} mt-1.5`}
                          type="number"
                          min={0}
                          max={10_000}
                          step={1}
                          value={resource.order}
                          onChange={event => updateResource(resource.id, { order: Number(event.target.value) })}
                        />
                      </label>
                    </div>

                    <label className="block text-xs font-semibold text-slate-300">
                      Short description
                      <textarea
                        className={`${fieldClass} mt-1.5 min-h-20`}
                        value={resource.description || ''}
                        maxLength={500}
                        onChange={event => updateResource(resource.id, { description: event.target.value || undefined })}
                        placeholder="Explain when and how an affiliate should use this resource."
                      />
                    </label>
                    <label className="block text-xs font-semibold text-slate-300">
                      Approved caption, excerpt, or guidance
                      <textarea
                        className={`${fieldClass} mt-1.5 min-h-32 font-sans leading-relaxed`}
                        value={resource.body || ''}
                        maxLength={4_000}
                        onChange={event => updateResource(resource.id, { body: event.target.value || undefined })}
                        placeholder="Add reusable promotional copy or campaign guidance."
                      />
                    </label>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="text-xs font-semibold text-slate-300">
                        Referral destination type
                        <select
                          className={`${fieldClass} mt-1.5`}
                          value={resource.destination.kind}
                          onChange={event => updateDestinationKind(resource, event.target.value as LiteraryCircleResourceDestination['kind'])}
                        >
                          {DESTINATION_KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      {resource.destination.kind !== 'home' && (
                        <label className="text-xs font-semibold text-slate-300">
                          Destination ID
                          <input
                            className={`${fieldClass} mt-1.5 font-mono`}
                            value={resource.destination.id}
                            maxLength={128}
                            list={resource.destination.kind === 'piece' ? `${idPrefix}-piece-destinations` : undefined}
                            onChange={event => updateResource(resource.id, {
                              destination: { ...resource.destination, id: event.target.value } as LiteraryCircleResourceDestination,
                            })}
                            placeholder={`Published ${resource.destination.kind} ID`}
                          />
                        </label>
                      )}
                      <label className="text-xs font-semibold text-slate-300">
                        Campaign code (optional)
                        <input
                          className={`${fieldClass} mt-1.5 font-mono`}
                          value={resource.campaignCode || ''}
                          maxLength={64}
                          list={`${idPrefix}-campaign-codes`}
                          onChange={event => updateResource(resource.id, {
                            campaignCode: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') || undefined,
                          })}
                          placeholder="e.g. october_release"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-xs font-semibold text-slate-300">
                        Publish from
                        <input
                          className={`${fieldClass} mt-1.5`}
                          type="datetime-local"
                          value={resourceIsoToLocalDateTime(resource.publishedAt)}
                          onChange={event => updateResource(resource.id, { publishedAt: resourceLocalDateTimeToIso(event.target.value) })}
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-300">
                        Expire automatically
                        <input
                          className={`${fieldClass} mt-1.5`}
                          type="datetime-local"
                          value={resourceIsoToLocalDateTime(resource.expiresAt)}
                          onChange={event => updateResource(resource.id, { expiresAt: resourceLocalDateTimeToIso(event.target.value) })}
                        />
                      </label>
                    </div>
                    <label className="flex min-h-11 items-center gap-3 rounded-xl border border-violet-300/20 bg-violet-400/5 px-3 py-2 text-xs font-semibold text-violet-100">
                      <input
                        type="checkbox"
                        checked={resource.isPublished}
                        onChange={event => updateResource(resource.id, { isPublished: event.target.checked })}
                        className="h-4 w-4 accent-violet-400"
                      />
                      Publish this resource to approved affiliates
                    </label>

                    <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_1fr]">
                        <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                          {resource.assetId ? (
                            <img
                              src={getWriterResourceAssetUrl(resource.assetId)}
                              alt={resource.assetAlt || ''}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="text-center text-slate-500">
                              <ImageIcon aria-hidden="true" className="mx-auto h-7 w-7" />
                              <p className="mt-2 text-xs">No artwork uploaded</p>
                            </div>
                          )}
                        </div>
                        <div>
                          <h6 className="text-sm font-bold text-white">Promotional artwork</h6>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            JPEG, PNG, or WebP up to 5 MB. Save metadata first; artwork changes use the latest library revision.
                          </p>
                          <label className="mt-3 block text-xs font-semibold text-slate-300">
                            Meaningful alternative text
                            <input
                              className={`${fieldClass} mt-1.5`}
                              value={resource.assetAlt || ''}
                              maxLength={300}
                              onChange={event => updateResource(resource.id, { assetAlt: event.target.value || undefined })}
                              placeholder="Describe the artwork, visible text, and relevant subject."
                              aria-describedby={`${panelId}-alt-help`}
                            />
                          </label>
                          <p id={`${panelId}-alt-help`} className="mt-1 text-[10px] leading-relaxed text-slate-500">
                            Avoid generic labels such as “image” or “cover”. Alternative text is required whenever artwork is attached.
                          </p>
                          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            <label className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition ${assetMutationBlocked || !persisted ? 'cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500 opacity-60' : 'cursor-pointer border-violet-300/30 bg-violet-400/10 text-violet-100 hover:bg-violet-400/20 focus-within:ring-2 focus-within:ring-violet-300'}`}>
                              {uploading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Upload aria-hidden="true" className="h-4 w-4" />}
                              {uploading ? 'Uploading…' : resource.assetId ? 'Replace artwork' : 'Upload artwork'}
                              <input
                                type="file"
                                accept={IMAGE_UPLOAD_ACCEPT}
                                className="sr-only"
                                disabled={assetMutationBlocked || !persisted}
                                aria-label={`Choose promotional artwork for ${resource.title}`}
                                onChange={event => void uploadImage(resource, event)}
                              />
                            </label>
                            {resource.assetId && (
                              <button
                                type="button"
                                onClick={() => void removeImage(resource)}
                                disabled={assetMutationBlocked}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <X aria-hidden="true" className="h-4 w-4" /> Remove artwork
                              </button>
                            )}
                          </div>
                          {!persisted && (
                            <p className="mt-2 text-[11px] text-amber-200">Save this new resource before uploading artwork.</p>
                          )}
                          {persisted && dirty && (
                            <p className="mt-2 text-[11px] text-amber-200">Save metadata changes before uploading or removing artwork.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <datalist id={`${idPrefix}-piece-destinations`}>
        {articles
          .filter(article => !article.status || article.status === 'published')
          .map(article => <option key={article.id} value={article.id}>{article.title}</option>)}
      </datalist>
      <datalist id={`${idPrefix}-campaign-codes`}>
        {campaigns.map(campaign => <option key={campaign.id || campaign.code} value={campaign.code}>{campaign.name}</option>)}
      </datalist>

      <div aria-live="polite" className="min-h-5">
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        {!error && notice && (
          <p role="status" className="inline-flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> {notice}
          </p>
        )}
      </div>

      <footer className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">
          Revision {draft.revision}. {dirty ? 'Unsaved changes are waiting.' : 'All resource metadata is saved.'}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {dirty && (
            <button
              type="button"
              onClick={discardChanges}
              disabled={editorLocked}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-50"
            >
              Discard changes
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveLibrary()}
            disabled={editorLocked || !dirty}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-5 py-2 font-mono text-xs font-bold text-slate-950 transition hover:from-violet-400 hover:to-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="h-4 w-4" />}
            {saving ? 'Saving resources…' : dirty ? 'Save promotional resources' : 'Resources saved'}
          </button>
        </div>
      </footer>
      </fieldset>
    </section>
  );
};

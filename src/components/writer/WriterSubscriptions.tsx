import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  CalendarRange,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';

import type { SubscriptionPlan } from '../../types.js';
import { api } from '../../utils/api.js';
import {
  CONTENT_COVER_UPLOAD_ACCEPT,
  getContentCoverValidationError,
  prepareImageFileForUpload,
} from '../../utils/imageUploadPolicy.js';

export interface SubscriptionPlanDraft {
  id?: string;
  name: string;
  description: string;
  priceKes: number;
  durationMonths: number;
  renewable: boolean;
  isPublished: boolean;
  order: number;
  badge: string;
  coverImage: string;
  coverImageAlt: string;
  coverPositionX: number;
  coverPositionY: number;
  updatedAt?: string;
}

const MAX_PLAN_PRICE_KES = 1_000_000;
const MAX_PLAN_DURATION_MONTHS = 120;
const MAX_PLAN_ORDER = 10_000;

export function createEmptySubscriptionPlanDraft(order = 0): SubscriptionPlanDraft {
  return {
    name: '',
    description: '',
    priceKes: 500,
    durationMonths: 3,
    renewable: true,
    isPublished: false,
    order,
    badge: '',
    coverImage: '',
    coverImageAlt: '',
    coverPositionX: 50,
    coverPositionY: 50,
  };
}

export function validateSubscriptionPlanDraft(draft: SubscriptionPlanDraft): string | null {
  if (!draft.name.trim()) return 'Enter a Reader Pass name.';
  if (draft.name.trim().length > 80) return 'Reader Pass names can contain at most 80 characters.';
  if (!draft.description.trim()) return 'Enter a short Reader Pass description.';
  if (draft.description.trim().length > 500) return 'Reader Pass descriptions can contain at most 500 characters.';
  if (!Number.isSafeInteger(draft.priceKes) || draft.priceKes < 1 || draft.priceKes > MAX_PLAN_PRICE_KES) {
    return `Price must be a whole number between KES 1 and KES ${MAX_PLAN_PRICE_KES.toLocaleString()}.`;
  }
  if (
    !Number.isSafeInteger(draft.durationMonths)
    || draft.durationMonths < 1
    || draft.durationMonths > MAX_PLAN_DURATION_MONTHS
  ) {
    return `Duration must be a whole number between 1 and ${MAX_PLAN_DURATION_MONTHS} months.`;
  }
  if (!Number.isSafeInteger(draft.order) || draft.order < 0 || draft.order > MAX_PLAN_ORDER) {
    return `Display order must be a whole number between 0 and ${MAX_PLAN_ORDER.toLocaleString()}.`;
  }
  if (draft.badge.trim().length > 40) return 'The optional badge can contain at most 40 characters.';
  if (draft.coverImageAlt.trim().length > 160) {
    return 'The cover description can contain at most 160 characters.';
  }
  if (draft.id && !draft.updatedAt) {
    return 'This Reader Pass has no save version. Reload the plans before editing it.';
  }
  return null;
}

function planToDraft(plan: SubscriptionPlan): SubscriptionPlanDraft {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceKes: plan.priceKes,
    durationMonths: plan.durationMonths,
    renewable: plan.renewable,
    isPublished: plan.isPublished,
    order: plan.order,
    badge: plan.badge || '',
    coverImage: plan.coverImage || '',
    coverImageAlt: plan.coverImageAlt || '',
    coverPositionX: plan.coverPosition?.x ?? 50,
    coverPositionY: plan.coverPosition?.y ?? 50,
    updatedAt: plan.updatedAt,
  };
}

function formatDuration(months: number): string {
  if (months === 12) return '1 year';
  if (months > 12 && months % 12 === 0) return `${months / 12} years`;
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

export function WriterSubscriptions() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [draft, setDraft] = useState<SubscriptionPlanDraft>(() => createEmptySubscriptionPlanDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverUploadSequenceRef = useRef(0);

  const chooseDraft = useCallback((nextDraft: SubscriptionPlanDraft) => {
    coverUploadSequenceRef.current += 1;
    setUploadingCover(false);
    setDraft(nextDraft);
    setNotice('');
    setError('');
  }, []);

  const loadPlans = useCallback(async (preferredPlanId?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getAdminSubscriptionPlans();
      const nextPlans = [...result.plans].sort(
        (left, right) => left.order - right.order || left.name.localeCompare(right.name),
      );
      setPlans(nextPlans);
      setDraft(current => {
        const desiredId = preferredPlanId || current.id;
        const selected = desiredId
          ? nextPlans.find(plan => plan.id === desiredId)
          : nextPlans[0];
        return selected ? planToDraft(selected) : createEmptySubscriptionPlanDraft(nextPlans.length);
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Reader Pass settings could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const beginNewPlan = () => {
    chooseDraft(createEmptySubscriptionPlanDraft(plans.length));
  };

  const selectPlan = (plan: SubscriptionPlan) => {
    chooseDraft(planToDraft(plan));
  };

  const updateCoverPositionFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    setDraft(current => ({
      ...current,
      coverPositionX: Math.round(x),
      coverPositionY: Math.round(y),
    }));
  };

  const uploadCover = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const validationError = getContentCoverValidationError(file, 'subscription');
    if (validationError) {
      setNotice('');
      setError(validationError);
      return;
    }

    const uploadSequence = ++coverUploadSequenceRef.current;
    setUploadingCover(true);
    setNotice('');
    setError('');
    try {
      const dataUrl = await prepareImageFileForUpload(file);
      const prefix = draft.id ? `subscription_plan_${draft.id}` : 'subscription_plan_cover';
      const result = await api.uploadImage(
        dataUrl,
        'subscription_plan_cover',
        undefined,
        prefix,
      );
      if (uploadSequence !== coverUploadSequenceRef.current) return;
      setDraft(current => ({ ...current, coverImage: result.url }));
      setNotice('JPEG uploaded. Save this Reader Pass to attach the cover permanently.');
    } catch (requestError) {
      if (uploadSequence !== coverUploadSequenceRef.current) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The Reader Pass cover could not be uploaded.',
      );
    } finally {
      if (uploadSequence === coverUploadSequenceRef.current) setUploadingCover(false);
    }
  };

  const savePlan = async () => {
    if (saving || uploadingCover) return;
    const validationError = validateSubscriptionPlanDraft(draft);
    if (validationError) {
      setNotice('');
      setError(validationError);
      return;
    }

    setSaving(true);
    setNotice('');
    setError('');
    try {
      const result = await api.saveSubscriptionPlan(
        {
          ...(draft.id ? { id: draft.id } : {}),
          name: draft.name.trim(),
          description: draft.description.trim(),
          priceKes: draft.priceKes,
          durationMonths: draft.durationMonths,
          renewable: draft.renewable,
          isPublished: draft.isPublished,
          order: draft.order,
          // An explicit empty string lets the server remove an earlier badge.
          badge: draft.badge.trim(),
          ...(draft.coverImage
            ? {
                coverImage: draft.coverImage,
                coverImageAlt: draft.coverImageAlt.trim() || `Cover for ${draft.name.trim()}`,
                coverPosition: {
                  x: draft.coverPositionX,
                  y: draft.coverPositionY,
                },
              }
            : {}),
        },
        draft.id ? draft.updatedAt || null : null,
      );
      await loadPlans(result.plan.id);
      window.dispatchEvent(new Event('ink-homepage-updated'));
      setNotice(
        result.plan.isPublished
          ? 'Reader Pass saved and available to readers.'
          : 'Reader Pass saved as hidden. Publish it when it is ready for readers.',
      );
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : 'Reader Pass changes could not be saved.';
      setError(
        /changed in another|reload/i.test(message)
          ? `${message} Your unsaved fields are still here; use Refresh before trying again.`
          : message,
      );
    } finally {
      setSaving(false);
    }
  };

  const archivePlan = async () => {
    if (!draft.id || !draft.updatedAt || archiving) return;
    const confirmed = window.confirm(
      `Archive “${draft.name}”? It will be removed from sale, but existing payments and reader access will remain intact.`,
    );
    if (!confirmed) return;

    setArchiving(true);
    setNotice('');
    setError('');
    try {
      const result = await api.archiveSubscriptionPlan(draft.id, draft.updatedAt);
      await loadPlans(result.plan.id);
      window.dispatchEvent(new Event('ink-homepage-updated'));
      setNotice('Reader Pass archived safely. Its history and existing reader access were preserved.');
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : 'The Reader Pass could not be archived.';
      setError(
        /changed in another|reload/i.test(message)
          ? `${message} Refresh the plans before trying again.`
          : message,
      );
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div id="writer-subscriptions" className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-violet-400">
            <CalendarRange className="h-4 w-4" aria-hidden="true" />
            Reader Passes
          </div>
          <h1 className="font-serif text-2xl font-bold text-white">Subscription plans</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Set each plan&rsquo;s name, duration, price, cover, and visibility. Renewals are reader-initiated
            and confirmed by M-Pesa; saving a plan never changes an existing reader&rsquo;s paid expiry.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadPlans(draft.id)}
            disabled={loading || saving || archiving || uploadingCover}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            onClick={beginNewPlan}
            disabled={saving || archiving || uploadingCover}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Reader Pass
          </button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-200">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 sm:p-5" aria-labelledby="reader-pass-list-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="reader-pass-list-heading" className="font-serif text-lg font-bold text-white">Your plans</h2>
              <p className="mt-1 text-[11px] text-slate-500">Hidden plans remain editable and keep their payment history.</p>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-mono text-slate-400">
              {plans.length} total
            </span>
          </div>

          {loading ? (
            <div id="writer-subscriptions-loading" className="flex min-h-44 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/50">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading Reader Passes safely…
              </div>
            </div>
          ) : plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center">
              <p className="text-sm font-semibold text-slate-300">No Reader Passes yet</p>
              <p className="mt-1 text-xs text-slate-500">Create a hidden draft, review it, then publish it when ready.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {plans.map(plan => {
                const selected = draft.id === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => selectPlan(plan)}
                    aria-pressed={selected}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-violet-600 bg-violet-950/35'
                        : 'border-slate-800 bg-slate-950/55 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <span className="flex items-start gap-3">
                      {plan.coverImage ? (
                        <img
                          src={plan.coverImage}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          style={{ objectPosition: `${plan.coverPosition?.x ?? 50}% ${plan.coverPosition?.y ?? 50}%` }}
                          className="h-16 w-14 shrink-0 rounded-lg border border-slate-700 object-cover"
                        />
                      ) : (
                        <span className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900 text-slate-500">
                          <ImagePlus className="h-5 w-5" aria-hidden="true" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-white">{plan.name}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide ${
                            plan.isPublished
                              ? 'border-emerald-800 bg-emerald-950 text-emerald-300'
                              : 'border-slate-700 bg-slate-900 text-slate-400'
                          }`}>
                            {plan.isPublished ? 'Public' : 'Hidden'}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs text-violet-300">
                          KES {plan.priceKes.toLocaleString()} · {formatDuration(plan.durationMonths)}
                        </span>
                        <span className="mt-1 block text-[10px] text-slate-500">
                          {plan.renewable ? 'Reader-renewable' : 'No active-term renewal'} · order {plan.order}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-5 rounded-2xl border border-slate-800 bg-[#0b1120] p-4 sm:p-5" aria-labelledby="reader-pass-editor-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-violet-400">
                {draft.id ? 'Editing plan' : 'New plan draft'}
              </p>
              <h2 id="reader-pass-editor-heading" className="mt-1 font-serif text-lg font-bold text-white">
                {draft.id ? draft.name || 'Reader Pass' : 'Create a Reader Pass'}
              </h2>
            </div>
            {draft.id ? (
              <button
                type="button"
                onClick={() => void archivePlan()}
                disabled={saving || archiving || uploadingCover || !draft.updatedAt}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-800 px-3 py-2 text-xs text-amber-300 hover:bg-amber-950/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {archiving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                {archiving ? 'Archiving…' : 'Archive safely'}
              </button>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">
              Reader Pass name *
              <input
                value={draft.name}
                maxLength={80}
                onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                autoComplete="off"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">
              Description *
              <textarea
                value={draft.description}
                maxLength={500}
                rows={3}
                onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
                className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              Price (KES) *
              <input
                type="number"
                min={1}
                max={MAX_PLAN_PRICE_KES}
                step={1}
                inputMode="numeric"
                value={draft.priceKes}
                onChange={event => setDraft(current => ({ ...current, priceKes: Number(event.target.value) }))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              Duration (months) *
              <input
                type="number"
                min={1}
                max={MAX_PLAN_DURATION_MONTHS}
                step={1}
                inputMode="numeric"
                value={draft.durationMonths}
                onChange={event => setDraft(current => ({ ...current, durationMonths: Number(event.target.value) }))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              Display order
              <input
                type="number"
                min={0}
                max={MAX_PLAN_ORDER}
                step={1}
                inputMode="numeric"
                value={draft.order}
                onChange={event => setDraft(current => ({ ...current, order: Number(event.target.value) }))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              Badge (optional)
              <input
                value={draft.badge}
                maxLength={40}
                placeholder="Best value"
                onChange={event => setDraft(current => ({ ...current, badge: event.target.value }))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
          </div>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Reader Pass availability</legend>
            <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={draft.renewable}
                onChange={event => setDraft(current => ({ ...current, renewable: event.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 accent-violet-500"
              />
              <span>
                <span className="block font-semibold text-white">Reader can renew</span>
                <span className="mt-1 block leading-relaxed text-slate-500">Renewal always requires a new confirmed M-Pesa payment.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={draft.isPublished}
                onChange={event => setDraft(current => ({ ...current, isPublished: event.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
              />
              <span>
                <span className="block font-semibold text-white">Visible to readers</span>
                <span className="mt-1 block leading-relaxed text-slate-500">Only publish after the name, price, duration, and cover are ready.</span>
              </span>
            </label>
          </fieldset>

          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
            <div>
              <p className="text-xs font-semibold text-slate-300">Reader Pass cover</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Upload a JPEG up to 5 MB, then drag the preview or use the sliders to set its focal point.</p>
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept={CONTENT_COVER_UPLOAD_ACCEPT}
              onChange={event => void uploadCover(event)}
              className="sr-only"
              aria-label="Choose Reader Pass cover JPEG"
            />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {draft.coverImage ? (
                <div
                  className="relative h-52 w-full touch-none cursor-crosshair overflow-hidden rounded-xl border border-slate-700 bg-slate-900 sm:h-44 sm:w-72"
                  onPointerDown={event => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updateCoverPositionFromPointer(event);
                  }}
                  onPointerMove={event => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateCoverPositionFromPointer(event);
                  }}
                  onPointerUp={event => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                  onPointerCancel={event => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                  role="group"
                  aria-label="Reader Pass cover focal-point preview. Drag to reposition."
                >
                  <img
                    src={draft.coverImage}
                    alt={draft.coverImageAlt || 'Reader Pass cover preview'}
                    style={{ objectPosition: `${draft.coverPositionX}% ${draft.coverPositionY}%` }}
                    className="pointer-events-none h-full w-full select-none object-cover"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-500/50 shadow-[0_0_0_3px_rgba(2,6,23,0.65)]"
                    style={{ left: `${draft.coverPositionX}%`, top: `${draft.coverPositionY}%` }}
                  />
                </div>
              ) : (
                <div className="flex h-36 w-full items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900 text-slate-500 sm:w-56">
                  <ImagePlus className="h-7 w-7" aria-hidden="true" />
                  <span className="sr-only">No Reader Pass cover uploaded</span>
                </div>
              )}
              <div className="flex-1 space-y-3">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={uploadingCover || saving || archiving}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-800 bg-violet-950/40 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploadingCover ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  {uploadingCover ? 'Uploading…' : draft.coverImage ? 'Replace JPEG' : 'Upload JPEG'}
                </button>
                <label className="block space-y-1 text-[10px] text-slate-400">
                  Cover description for screen readers
                  <input
                    value={draft.coverImageAlt}
                    maxLength={160}
                    placeholder="Describe the cover image"
                    onChange={event => setDraft(current => ({ ...current, coverImageAlt: event.target.value }))}
                    disabled={!draft.coverImage}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              </div>
            </div>

            {draft.coverImage ? (
              <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-2">
                <label className="space-y-1 text-[10px] font-medium text-slate-400">
                  <span className="flex items-center justify-between gap-3"><span>Horizontal focus</span><span>{draft.coverPositionX}%</span></span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.coverPositionX}
                    onChange={event => setDraft(current => ({ ...current, coverPositionX: Number(event.target.value) }))}
                    className="w-full accent-violet-500"
                  />
                </label>
                <label className="space-y-1 text-[10px] font-medium text-slate-400">
                  <span className="flex items-center justify-between gap-3"><span>Vertical focus</span><span>{draft.coverPositionY}%</span></span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.coverPositionY}
                    onChange={event => setDraft(current => ({ ...current, coverPositionY: Number(event.target.value) }))}
                    className="w-full accent-violet-500"
                  />
                </label>
                <div className="flex items-center justify-between gap-3 sm:col-span-2">
                  <p className="text-[10px] leading-relaxed text-slate-500">This focus is preserved across phone and desktop card layouts.</p>
                  <button
                    type="button"
                    onClick={() => setDraft(current => ({ ...current, coverPositionX: 50, coverPositionY: 50 }))}
                    className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 hover:border-violet-700 hover:text-violet-200"
                  >
                    Center
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-3 text-[11px] leading-relaxed text-sky-200">
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
              <span>Commercial terms are copied into each payment before the M-Pesa prompt. Later plan edits cannot rewrite an earlier payment or shorten paid access.</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => void savePlan()}
            disabled={saving || archiving || uploadingCover || loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-xs font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Saving Reader Pass…' : uploadingCover ? 'Uploading cover…' : 'Save Reader Pass'}
          </button>
        </section>
      </div>
    </div>
  );
}

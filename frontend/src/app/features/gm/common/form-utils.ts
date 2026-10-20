import { DestroyRef, Signal, effect, inject, signal } from '@angular/core';
import { AbstractControl, FormGroup, ValidationErrors } from '@angular/forms';
import { ApiError } from '../../../core/api/api-error';

/**
 * Signal that changes whenever the given form emits an event (value, status, touched,
 * pristine). Read it in a template so zoneless OnPush views refresh after programmatic
 * changes such as server-side validation errors.
 */
export function formTick(form: () => AbstractControl | null | undefined): Signal<number> {
  const tick = signal(0);
  effect((onCleanup) => {
    const f = form();
    if (!f) return;
    const sub = f.events.subscribe(() => tick.update((n) => n + 1));
    onCleanup(() => sub.unsubscribe());
  });
  return tick.asReadonly();
}

/** Same as formTick, for a form created in the component itself (not an input). */
export function staticFormTick(form: AbstractControl): Signal<number> {
  const tick = signal(0);
  const sub = form.events.subscribe(() => tick.update((n) => n + 1));
  inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  return tick.asReadonly();
}

/** User-facing message for the first error of a control, or null when valid/untouched. */
export function controlError(control: AbstractControl | null | undefined, opts: { always?: boolean } = {}): string | null {
  if (!control || !control.errors) return null;
  if (!opts.always && !control.touched && !control.dirty) return null;
  return describeErrors(control.errors);
}

export function describeErrors(e: ValidationErrors): string {
  if (e['server']) return String(e['server']);
  if (e['required']) return 'Required.';
  if (e['min']) return `Must be at least ${e['min'].min}.`;
  if (e['max']) return `Must be at most ${e['max'].max}.`;
  if (e['maxlength']) return `Keep it under ${e['maxlength'].requiredLength} characters.`;
  if (e['minlength']) return `Use at least ${e['minlength'].requiredLength} characters.`;
  if (e['integer']) return 'Use a whole number.';
  if (e['pattern']) return 'Check the format.';
  if (e['message']) return String(e['message']);
  const first = Object.values(e)[0];
  return typeof first === 'string' ? first : 'Check this value.';
}

/** Whole-number validator (null/empty passes; combine with required). */
export function integerValidator(control: AbstractControl): ValidationErrors | null {
  const v = control.value;
  if (v === null || v === undefined || v === '') return null;
  return Number.isInteger(Number(v)) ? null : { integer: true };
}

/**
 * Put 400 validation messages from the server on the matching controls.
 * `map` translates API field names to control paths (e.g. startAt → startTime).
 * Returns the messages that could not be placed on a control.
 */
export function applyServerErrors(form: FormGroup, err: unknown, map: Record<string, string> = {}, prefix = ''): string[] {
  const fields = ApiError.from(err).fields;
  const unplaced: string[] = [];
  for (const [field, message] of Object.entries(fields)) {
    const local = field.startsWith(prefix) ? field.slice(prefix.length) : field;
    const path = map[local] ?? map[field] ?? local;
    const control = form.get(path);
    if (control) {
      control.setErrors({ ...(control.errors ?? {}), server: message });
      control.markAsTouched();
    } else {
      unplaced.push(message);
    }
  }
  return unplaced;
}

/** Move keyboard focus to the first invalid field inside `root`. */
export function focusFirstInvalid(root: HTMLElement | null | undefined): void {
  if (!root) return;
  queueMicrotask(() => {
    const el = root.querySelector<HTMLElement>('.ng-invalid:not(form):not([formgroupname]):not([formGroupName]), [aria-invalid="true"]');
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

/** Copy text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

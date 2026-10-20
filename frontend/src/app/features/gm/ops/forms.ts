import { AbstractControl, FormControl } from '@angular/forms';
import { ApiError } from '../../../core/api/api-error';

/**
 * Copy ApiError.fields onto the matching controls (dot paths such as "geofence.radiusM"
 * work because the forms mirror the API shape). Returns the messages that matched no control.
 */
export function applyServerErrors(form: AbstractControl, err: ApiError, aliases: Record<string, string> = {}): string[] {
  const unmatched: string[] = [];
  for (const [key, message] of Object.entries(err.fields)) {
    const ctrl = form.get(aliases[key] ?? key);
    if (ctrl) {
      ctrl.setErrors({ ...(ctrl.errors ?? {}), server: message });
      ctrl.markAsTouched();
    } else {
      unmatched.push(message);
    }
  }
  return unmatched;
}

/** First user-facing message for a control: server error, then the common validators. */
export function controlError(ctrl: AbstractControl | null, label = 'This field'): string | null {
  if (!ctrl || !ctrl.errors || !(ctrl.touched || ctrl.dirty)) return null;
  const e = ctrl.errors;
  if (e['server']) return String(e['server']);
  if (e['required']) return `${label} is required.`;
  if (e['min']) return `${label} must be at least ${e['min'].min}.`;
  if (e['max']) return `${label} must be at most ${e['max'].max}.`;
  if (e['maxlength']) return `${label} must be at most ${e['maxlength'].requiredLength} characters.`;
  if (e['minlength']) return `${label} must be at least ${e['minlength'].requiredLength} characters.`;
  if (e['pattern']) return `${label} has an invalid format.`;
  if (e['message']) return String(e['message']);
  return `${label} is invalid.`;
}

/** Toggle a value in a string-array control (checkbox lists used as multi-selects). */
export function toggleIn(ctrl: FormControl<string[]>, value: string, on: boolean): void {
  const cur = ctrl.value ?? [];
  const next = on ? (cur.includes(value) ? cur : [...cur, value]) : cur.filter((v) => v !== value);
  ctrl.setValue(next);
  ctrl.markAsDirty();
}

/** Number from a possibly-null number input. */
export function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** Value of an <input>/<select> change event. */
export function targetValue(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value;
}

export function targetChecked(e: Event): boolean {
  return (e.target as HTMLInputElement).checked;
}

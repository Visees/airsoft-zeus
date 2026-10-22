import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ApiError } from '../../core/api/api-error';

/**
 * Helpers shared by the forms in auth/, onboarding/, profile/, clubs/ and settings/.
 */

export type ErrorMessages = Record<string, string | ((value: unknown) => string)>;

/**
 * Copy 400 validation messages (ApiError.fields) onto the matching controls as `server` errors.
 * `aliases` maps server field names to control paths when they differ.
 * Returns the messages that matched no control, so the caller can show them in a banner.
 */
export function applyServerErrors(form: FormGroup, err: unknown, aliases: Record<string, string> = {}): string[] {
  const e = ApiError.from(err);
  const unmatched: string[] = [];
  for (const [field, msg] of Object.entries(e.fields)) {
    const ctrl = form.get(aliases[field] ?? field);
    if (ctrl) {
      ctrl.setErrors({ ...(ctrl.errors ?? {}), server: msg });
      ctrl.markAsTouched();
    } else {
      unmatched.push(msg);
    }
  }
  return unmatched;
}

/** The message to show under a field, or null while it is valid or untouched. */
export function fieldError(ctrl: AbstractControl | null | undefined, messages: ErrorMessages = {}): string | null {
  if (!ctrl || !ctrl.errors || !ctrl.touched) return null;
  const errors = ctrl.errors;
  if (typeof errors['server'] === 'string') return errors['server'];
  for (const key of Object.keys(errors)) {
    const m = messages[key] ?? DEFAULT_MESSAGES[key];
    if (m) return typeof m === 'function' ? m(errors[key]) : m;
  }
  return $localize`Check this field.`;
}

const DEFAULT_MESSAGES: ErrorMessages = {
  required: $localize`Required.`,
  email: $localize`Enter a valid email address, like name@example.com.`,
  minlength: (e) => $localize`Use at least ${(e as { requiredLength: number }).requiredLength}:requiredLength: characters.`,
  maxlength: (e) => $localize`Use at most ${(e as { requiredLength: number }).requiredLength}:requiredLength: characters.`,
  pattern: $localize`The format is not valid.`,
};

/** Move focus to the first invalid field inside `host` after a failed submit. */
export function focusFirstInvalid(host: HTMLElement): void {
  const el = host.querySelector<HTMLElement>(
    'input.ng-invalid, select.ng-invalid, textarea.ng-invalid, [formcontrolname].ng-invalid input, [aria-invalid="true"]',
  );
  el?.focus();
}

/** Group validator: two controls must match (password + confirmation). Sets `mismatch` on the group. */
export function matchValidator(a: string, b: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const vb = group.get(b)?.value;
    return vb && group.get(a)?.value !== vb ? { mismatch: true } : null;
  };
}

/** Only allow same-app relative paths as redirect targets (no open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/auth/') || next.startsWith('/welcome')) return null;
  return next;
}

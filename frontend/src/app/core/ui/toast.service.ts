import { Injectable } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { errorMessage } from '../api/api-error';

/** Thin wrapper around Spartan's sonner so call sites stay short. <hlm-toaster> lives in App. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  success(message: string, description?: string): void {
    toast.success(message, { description });
  }
  info(message: string, description?: string): void {
    toast.info(message, { description });
  }
  warning(message: string, description?: string): void {
    toast.warning(message, { description });
  }
  error(messageOrError: unknown, description?: string): void {
    const message = typeof messageOrError === 'string' ? messageOrError : errorMessage(messageOrError);
    toast.error(message, { description });
  }
}

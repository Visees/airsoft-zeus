import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/api-error';
import {
  ActivityItem,
  Capture,
  EventEventStatusAlias,
  GmAlert,
  GmObjectiveAction,
  Member,
  Objective,
  ObjectiveStatus,
  PerkPurchase,
  Precision,
  Squad,
  Team,
  VisiblePosition,
  VisibilityRules,
} from './control-center.types';
import { LiveStore } from '../../../core/live/live-store';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ThemeService } from '../../../core/ui/theme.alias';
import { ToastService } from '../../../core/ui/toast.service';
import {
  OBJECTIVE_STATUS_GLYPHS,
  OBJECTIVE_STATUS_LABELS,
  PERK_TYPE_LABELS,
  PLAYER_ROLE_LABELS,
  PRECISION_LABELS,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelative,
  formatTime,
} from '../../../core/util/format';
import { TacticalMap } from '../../../shared/map/tactical-map';
import { GameTimer, nowSignal } from '../../../shared/game-timer';
import { ConnectionStatus } from '../../../shared/link-status';
import { CurrencyDisplay } from '../../../shared/currency-display';
import { ScoreDisplay } from '../../../shared/score-display';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../../shared/states';
import { StatusChip, eventStatusChip, objectiveStatusChip, purchaseStatusChip } from '../../../shared/status-chip';
import { TeamBadge } from '../../../shared/team-badge';
import { TeamSwatch } from '../../../shared/team-swatch';
import { SquadBadge } from '../../../shared/squad-badge';
import { AdjustBalanceDialog } from '../ops/adjust-balance-dialog';
import { AnnounceForm } from '../ops/announce-form';
import { OpsDialog } from '../ops/ops-dialog';

export {};

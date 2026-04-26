export type JobTrigger = 'scheduled' | 'manual';
export type JobRunStatus = 'claimed' | 'running' | 'completed' | 'error' | 'skipped';

export interface DailyJobSchedule {
  type: 'daily';
  enabledKey: string;
  hourKey: string;
  timezoneKey: string;
  defaultHour: number;
  defaultTimezone?: string;
}

export interface JobRunContext {
  job_id: string;
  trigger: JobTrigger;
  run_id: number;
  slot_key: string | null;
}

export interface RegisteredJob {
  id: string;
  label: string;
  schedule: DailyJobSchedule;
  run: (context: JobRunContext) => Promise<unknown>;
}

export interface JobRunRecord {
  id: number | string;
  job_id: string;
  trigger: JobTrigger;
  slot_key: string | null;
  status: JobRunStatus;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  duration_ms: number | null;
  error: string | null;
  details: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

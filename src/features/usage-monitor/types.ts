export type SupabaseUsageSnapshot = {
  database_bytes: number;
  storage_bytes: number;
  storage_objects: number;
  auth_users: number;
  active_users_month: number;
  api_requests: number;
  auth_requests: number;
  realtime_requests: number;
  rest_requests: number;
  storage_requests: number;
  disk_size_gb: number | null;
  disk_used_bytes: number;
  disk_total_bytes: number;
  disk_usage_percent: number | null;
  generated_at: string;
};

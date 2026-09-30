export type SupabaseUsageSnapshot = {
  database_bytes: number;
  storage_bytes: number;
  storage_objects: number;
  auth_users: number;
  active_users_month: number;
  generated_at: string;
};

export interface CachePurgeConfig {
  zoneId: string;
  apiToken: string;
}

export interface CloudflarePurgeResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
}

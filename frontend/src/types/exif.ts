/**
 * Shared frontend types for EXIF extraction and analysis.
 */

export interface ExifData {
  Make?: string;
  Model?: string;
  DateTime?: string;
  DateTimeOriginal?: string;
  Software?: string;
  GPSAltitude?: unknown;
  GPSTimestamp?: unknown;
  GPSLatitudeRef?: string;
  GPSLongitudeRef?: string;
  GPSLatitude?: unknown;
  GPSLongitude?: unknown;
  PixelXDimension?: number;
  PixelYDimension?: number;
  [key: string]: unknown;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type AnalysisProfile = 'rapid' | 'deep';
export type AnalysisMode = 'heuristic' | 'ollama' | 'hybrid';
export type VisualAnalysisMode = 'vision' | 'unavailable';

export interface LlmAnalysis {
  risk_level: RiskLevel;
  risk_score: number;
  summary: string;
  key_findings: string[];
  recommendations: string[];
  sensitive_fields: string[];
  attacker_simulation: string;
  model: string;
  provider: string;
  analysis_mode: AnalysisMode;
  fallback_reason?: string | null;
  cached: boolean;
  latency_ms: number;
}

export interface VisualAnalysis {
  risk_level: RiskLevel;
  risk_score: number;
  summary: string;
  key_findings: string[];
  recommendations: string[];
  exposed_elements: string[];
  attacker_simulation: string;
  model: string;
  provider: string;
  analysis_mode: VisualAnalysisMode;
  fallback_reason?: string | null;
  cached: boolean;
  latency_ms: number;
}

export interface PipelineMeta {
  extract_ms: number;
  analysis_pending: boolean;
  profile: AnalysisProfile;
}

export interface AnalysisMeta {
  duration_ms: number;
  cached: boolean;
  profile: AnalysisProfile;
}

export interface ExtractExifJsonResult {
  image_path: string;
  total_tags: number;
  exif_data: ExifData;
}

export interface ExtractExifJsonResponse {
  success: boolean;
  filename?: string;
  json_file?: string;
  json_path?: string;
  data?: ExtractExifJsonResult;
  llm_analysis?: LlmAnalysis | null;
  pipeline?: PipelineMeta;
  error?: string;
}

export interface AnalyzeExifResponse {
  success: boolean;
  llm_analysis?: LlmAnalysis | null;
  visual_analysis?: VisualAnalysis | null;
  combined_analysis?: LlmAnalysis | null;
  meta?: AnalysisMeta;
  error?: string;
}

export interface LlmHealthResponse {
  available: boolean;
  model: string;
  base_url: string;
  recommended_profile: AnalysisProfile;
  text_available: boolean;
  text_model: string;
  vision_available: boolean;
  vision_model: string;
}

export interface Upload {
  id: string;
  timestamp: string;
  fileName: string;
  preview: string;
  hasGPS: boolean;
  tagCount: number;
}

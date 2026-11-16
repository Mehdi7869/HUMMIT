export type NavSection =
  | 'dashboard'
  | 'studio'
  | 'ideas'
  | 'lyrics'
  | 'projects'
  | 'assistant'
  | 'favorites'
  | 'settings';

export type BackendMode = 'supabase' | 'local';

export type AnalysisMode = 'auto' | 'humming' | 'voice';

export type RecordingContentType =
  | 'humming'
  | 'singing'
  | 'speech'
  | 'instrumental'
  | 'mixed'
  | 'unknown';

export interface AudioPreferences {
  preferredInputId?: string;
  defaultFormat: string;
  autoSaveDrafts: boolean;
  waveformDensity: 'compact' | 'standard' | 'detailed';
}

export interface AIPreferences {
  creativeFocus: 'songwriting' | 'arrangement' | 'production' | 'lyricism';
  conservatism: 'conservative' | 'balanced' | 'exploratory';
}

export interface User {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
  audio_preferences: AudioPreferences;
  ai_preferences: AIPreferences;
  created_at: string;
}

export type ProjectStatus = 'active' | 'completed' | 'archived';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  cover_color: string;
  created_at: string;
  updated_at: string;
}

export type RecordingStatus = 'draft' | 'archived';

export interface Recording {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  description: string;
  tags: string[];
  storage_path: string;
  duration: number;
  mime_type: string;
  file_size: number;
  status: RecordingStatus;
  created_at: string;
  updated_at?: string;
}

export interface MelodyAnalysis {
  detected: boolean;
  contour: string;
  pitch_observations: string[];
  estimated_key: string | null;
  confidence: number | null;
}

export interface RhythmAnalysis {
  detected: boolean;
  estimated_bpm: number | null;
  pattern: string;
  confidence: number | null;
}

export interface StructuredAudioAnalysis {
  recording_type: RecordingContentType;
  analysis_mode?: AnalysisMode;
  audio_summary: string;
  transcription: string;
  lyrics: string;
  melody: MelodyAnalysis;
  rhythm: RhythmAnalysis;
  mood: string[];
  possible_genres: string[];
  possible_instruments: string[];
  vocal_characteristics: string[];
  musical_characteristics: string[];
  creative_recommendations: string[];
  limitations: string[];
}

export interface Analysis {
  id: string;
  recording_id: string;
  user_id: string;
  version: number;
  transcript: string;
  mood: string[];
  genre: string[];
  estimated_bpm: string | null;
  analysis_json: StructuredAudioAnalysis;
  created_at: string;
}

export type LyricSectionType =
  | 'intro'
  | 'verse'
  | 'pre-chorus'
  | 'chorus'
  | 'bridge'
  | 'outro';

export interface LyricSection {
  id: string;
  type: LyricSectionType;
  label: string;
  content: string;
}

export interface Lyrics {
  id: string;
  user_id: string;
  recording_id: string | null;
  project_id: string | null;
  title: string;
  content: string;
  sections: LyricSection[];
  notes: string;
  version: number;
  parent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompositionSection {
  id: string;
  name: string;
  purpose: string;
  energy_notes: string;
  lyric_focus: string;
}

export interface ChordProgressionSuggestion {
  id: string;
  section_name: string;
  chords: string;
  harmonic_feel: string;
  is_ai_suggestion: boolean;
}

export interface CompositionStructure {
  creative_concept: string;
  song_description: string;
  sections: CompositionSection[];
  arrangement_notes: string;
  tempo_recommendations: string;
  vocal_performance_suggestions: string;
  next_creative_steps: string[];
}

export interface Composition {
  id: string;
  user_id: string;
  recording_id: string | null;
  project_id: string | null;
  title: string;
  version: number;
  structure_json: CompositionStructure;
  chord_suggestions: ChordProgressionSuggestion[];
  instrument_suggestions: string[];
  lyrics_content: string;
  creative_notes: string;
  created_at: string;
  updated_at: string;
}

export interface Favorite {
  id: string;
  user_id: string;
  recording_id: string;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  type: 'recording' | 'project' | 'analysis' | 'lyrics' | 'composition';
  title: string;
  subtitle: string;
  timestamp: string;
  targetId: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  contextLabel?: string;
}

# HUMMIT

### Never Lose a Musical Idea.

SoundScribe is an AI-powered musical memory and composition assistant designed for musicians, singers, songwriters, and music creators. It helps capture raw musical inspiration, analyze recordings, organize creative ideas, and transform early concepts into structured compositions.

Instead of losing a melody, lyric, humming session, or random voice note, SoundScribe preserves it and helps you develop it further.

## The Problem

Musical inspiration can happen anywhere. Creators often record quick voice notes or hum melodies on their phones, but these ideas get lost, forgotten, or remain undeveloped.

Traditional recording apps only store audio. They don't help creators understand, organize, or build upon their ideas.

## Our Solution

HUMMIT combines audio recording, AI-powered analysis, and creative assistance in one workspace.

**Capture → Analyze → Organize → Develop → Create**

## Key Features

### 1. Musical Idea Recording
- Record humming, singing, beatboxing, and voice notes.
- Upload existing audio files.
- Pause, resume, stop, and replay recordings.
- Visualize recordings with audio waveforms.
- Add titles, descriptions, tags, and project details.

### 2. AI-Powered Audio Analysis
- Analyze uploaded and recorded audio.
- Identify whether the recording contains humming, singing, speech, or instrumental audio.
- Generate transcriptions when words are intelligible.
- Identify possible moods, genres, and instruments.
- Estimate tempo and describe rhythm when technically possible.
- Analyze melodic characteristics and pitch movement where supported.

### 3. Musical Memory Vault
- Store and organize all musical ideas.
- Search recordings using titles and tags.
- Filter ideas by mood, genre, and date.
- Favorite, edit, archive, and revisit recordings.
- Preserve original audio for future development.

### 4. AI Lyric Workspace
- Generate lyric suggestions from creative ideas.
- Organize lyrics into verses, choruses, and bridges.
- Improve rhyming and lyrical flow.
- Continue unfinished lyrics.
- Edit and save different versions.

### 5. Develop My Idea
Transform a recorded musical concept into a structured composition with:
- Song title and concept suggestions.
- Suggested song structure.
- Chord progression ideas.
- Instrument recommendations.
- Arrangement suggestions.
- Tempo and performance guidance.
- Creative next steps.

### 6. Projects & Export
- Organize recordings and lyrics into projects.
- Manage unfinished compositions.
- Export original recordings and lyrics.
- Generate downloadable composition plans.

## Technology Stack

| Technology | Purpose |
|---|---|
| Next.js | Application framework |
| TypeScript | Type-safe development |
| Tailwind CSS | Responsive UI styling |
| Gemini & GROQ API | AI-powered audio understanding |
| Supabase | Authentication and database |
| Supabase Storage | Audio file storage |
| MediaRecorder API | Audio recording |
| Web Audio API | Audio processing and visualization |
| WaveSurfer.js | Waveform visualization |
| Vercel | Deployment |

*The final stack may vary depending on the implemented version.*

## How It Works

1. **Capture:** Record a melody, humming, lyrics, or voice note.
2. **Analyze:** Submit the actual audio for AI-powered analysis.
3. **Understand:** Review transcription, mood, rhythm, and musical characteristics.
4. **Organize:** Save the recording in your Musical Memory Vault.
5. **Develop:** Use AI suggestions to build a more complete composition.
6. **Export:** Download your lyrics, composition plan, or original audio.

## Getting Started

### Prerequisites

- Node.js (LTS)
- npm
- Gemini API key
- Supabase project (if cloud authentication and storage are enabled)

### Installation

Clone the repository:

```bash
git clone YOUR_REPOSITORY_URL
```

Navigate into the project:

```bash
cd soundscribe
```

Install dependencies:

```bash
npm install
```

Create a `.env.local` file in the project root:

```env
GROQ_API_KEY=""
GROQ_AUDIO_MODEL="whisper-large-v3"

GEMINI_API_KEY="MY_GEMINI_API_KEY"

APP_URL="MY_APP_URL"

VITE_SUPABASE_URL=""
VITE_SUPABASE_ANON_KEY=""
SUPABASE_URL=""
SUPABASE_ANON_KEY=""
```

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

**Security:** Never expose your Gemini API key or Supabase service role key in client-side code or commit `.env.local` to GitHub.

## Project Vision

SoundScribe aims to become a creative companion for musicians, helping them preserve spontaneous inspiration and turn unfinished musical ideas into meaningful compositions.

It does not aim to replace human creativity. It aims to make sure creativity is never lost.

## Hackathon Theme

**Where Gen AI Meets Human Creativity**

HUMMIT brings together human imagination and artificial intelligence. The creator provides the original inspiration; AI helps analyze, organize, and develop it while keeping the creative process in human hands.

## Future Scope

- Advanced melody-to-MIDI conversion.
- More accurate pitch and chord detection.
- Music notation generation.
- Real-time musical collaboration.
- DAW integration.
- Multilingual lyric transcription.
- Advanced composition assistance.

## License

This project is developed as a hackathon project. Licensing and reuse terms can be defined by the project owner.

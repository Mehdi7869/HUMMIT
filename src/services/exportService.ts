import { jsPDF } from 'jspdf';
import { Composition, Lyrics } from '../types/soundscribe';

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'soundscribe-export'
  );
}

export function formatCompositionAsText(comp: Composition): string {
  const lines: string[] = [
    `SOUNDSCRIBE COMPOSITION SHEET — v${comp.version}`,
    `Title: ${comp.title}`,
    `Updated: ${new Date(comp.updated_at).toLocaleString()}`,
    '',
    'CREATIVE CONCEPT',
    comp.structure_json.creative_concept || '—',
    '',
    'SONG DESCRIPTION',
    comp.structure_json.song_description || '—',
    '',
    'SONG STRUCTURE',
    ...comp.structure_json.sections.flatMap((s, idx) => [
      `${idx + 1}. ${s.name}`,
      `   Purpose: ${s.purpose}`,
      `   Energy / Dynamics: ${s.energy_notes}`,
      `   Lyric Focus: ${s.lyric_focus}`,
    ]),
    '',
    'AI-GENERATED CHORD PROGRESSION SUGGESTIONS',
    ...comp.chord_suggestions.map(
      (c) => `- ${c.section_name}: ${c.chords} (${c.harmonic_feel})`
    ),
    '',
    'SUGGESTED INSTRUMENTS',
    comp.instrument_suggestions.length
      ? comp.instrument_suggestions.map((i) => `- ${i}`).join('\n')
      : '—',
    '',
    'ARRANGEMENT NOTES',
    comp.structure_json.arrangement_notes || '—',
    '',
    'TEMPO RECOMMENDATIONS',
    comp.structure_json.tempo_recommendations || '—',
    '',
    'VOCAL & PERFORMANCE SUGGESTIONS',
    comp.structure_json.vocal_performance_suggestions || '—',
    '',
    'LYRICS',
    comp.lyrics_content || '—',
    '',
    'CREATIVE NOTES',
    comp.creative_notes || '—',
    '',
    'NEXT CREATIVE STEPS',
    ...(comp.structure_json.next_creative_steps || []).map((step, i) => `${i + 1}. ${step}`),
  ];
  return lines.join('\n');
}

export function exportCompositionTxt(comp: Composition): void {
  const content = formatCompositionAsText(comp);
  downloadTextFile(`${slugify(comp.title)}-v${comp.version}.txt`, content);
}

export function exportCompositionPdf(comp: Composition): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 56;

  const ensureSpace = (needed = 24) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = 56;
    }
  };

  const writeHeading = (text: string) => {
    ensureSpace(32);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(75, 45, 160);
    doc.text(text.toUpperCase(), margin, y);
    y += 16;
  };

  const writeParagraph = (text: string) => {
    if (!text) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(35, 39, 51);
    const wrapped = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of wrapped) {
      ensureSpace(16);
      doc.text(line, margin, y);
      y += 14.5;
    }
    y += 8;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 18, 28);
  doc.text(comp.title, margin, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 110, 130);
  doc.text(
    `SoundScribe Composition Blueprint · Version ${comp.version} · ${new Date(comp.updated_at).toLocaleDateString()}`,
    margin,
    y
  );
  y += 24;

  writeHeading('Creative Concept');
  writeParagraph(comp.structure_json.creative_concept);

  writeHeading('Song Description');
  writeParagraph(comp.structure_json.song_description);

  writeHeading('Song Structure');
  comp.structure_json.sections.forEach((s, i) => {
    writeParagraph(
      `${i + 1}. ${s.name}\nPurpose: ${s.purpose}\nEnergy: ${s.energy_notes}\nLyric Focus: ${s.lyric_focus}`
    );
  });

  writeHeading('AI-Generated Chord Progression Suggestions');
  comp.chord_suggestions.forEach((c) => {
    writeParagraph(`${c.section_name}: ${c.chords} — ${c.harmonic_feel}`);
  });

  writeHeading('Suggested Instruments');
  writeParagraph(comp.instrument_suggestions.join(', ') || 'None specified');

  writeHeading('Arrangement & Tempo Notes');
  writeParagraph(
    `Arrangement: ${comp.structure_json.arrangement_notes}\n\nTempo: ${comp.structure_json.tempo_recommendations}\n\nVocal / Performance: ${comp.structure_json.vocal_performance_suggestions}`
  );

  if (comp.lyrics_content) {
    writeHeading('Lyrics');
    writeParagraph(comp.lyrics_content);
  }

  if (comp.creative_notes) {
    writeHeading('Creative Notes');
    writeParagraph(comp.creative_notes);
  }

  if (comp.structure_json.next_creative_steps?.length) {
    writeHeading('Next Creative Steps');
    comp.structure_json.next_creative_steps.forEach((step, idx) => {
      writeParagraph(`${idx + 1}. ${step}`);
    });
  }

  doc.save(`${slugify(comp.title)}-v${comp.version}.pdf`);
}

export function exportLyricsTxt(lyrics: Lyrics): void {
  const sectionsText =
    lyrics.sections.length > 0
      ? lyrics.sections.map((s) => `[${s.label}]\n${s.content}`).join('\n\n')
      : lyrics.content;
  const output = [
    `${lyrics.title} (Version ${lyrics.version})`,
    `Updated: ${new Date(lyrics.updated_at).toLocaleString()}`,
    '',
    sectionsText,
    lyrics.notes ? `\n---\nNotes:\n${lyrics.notes}` : '',
  ].join('\n');
  downloadTextFile(`${slugify(lyrics.title)}-lyrics-v${lyrics.version}.txt`, output);
}

export function exportLyricsPdf(lyrics: Lyrics): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 56;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(lyrics.title, margin, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 110, 130);
  doc.text(`SoundScribe Lyric Sheet · v${lyrics.version}`, margin, y);
  y += 28;

  const sectionsText =
    lyrics.sections.length > 0
      ? lyrics.sections.map((s) => `[${s.label}]\n${s.content}`).join('\n\n')
      : lyrics.content;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(25, 28, 38);
  const lines = doc.splitTextToSize(sectionsText || '(No lyrics written yet)', maxWidth) as string[];
  for (const line of lines) {
    if (y > pageHeight - 52) {
      doc.addPage();
      y = 56;
    }
    doc.text(line, margin, y);
    y += 16;
  }

  doc.save(`${slugify(lyrics.title)}-lyrics-v${lyrics.version}.pdf`);
}

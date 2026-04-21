const ALLOWED_LEARNING_STYLES = ['visual', 'analytical', 'practical', 'mixed'];

const LEARNING_STYLE_LABELS = {
  visual: 'visuell',
  analytical: 'analytisch',
  practical: 'praktisch',
  mixed: 'gemischt'
};

function normalizeLearningStyle(style) {
  if (!style || typeof style !== 'string') return 'mixed';
  const normalized = style.trim().toLowerCase();
  return ALLOWED_LEARNING_STYLES.includes(normalized) ? normalized : 'mixed';
}

function getLearningStylePromptBlock(style) {
  const normalized = normalizeLearningStyle(style);

  if (normalized === 'visual') {
    return `LEARNING_STYLE_PROFILE: visual
- Erkläre Inhalte mit klaren visuellen Denkmodellen (Tabellen, Vergleiche, Struktur-Bilder in Textform).
- Nutze starke Gliederung, Schritt-für-Schritt-Visualisierung und Merkhilfen.
- Formuliere, dass man sich Zusammenhänge als Skizze/Diagramm vorstellen kann.`;
  }

  if (normalized === 'analytical') {
    return `LEARNING_STYLE_PROFILE: analytical
- Erkläre Inhalte logisch-strukturiert mit Definitionen, Herleitungen und Begründungen.
- Nutze Ursache-Wirkung, Grenzfälle und klare Argumentationsketten.
- Priorisiere präzise, prüfungsnahe Fachsprache.`;
  }

  if (normalized === 'practical') {
    return `LEARNING_STYLE_PROFILE: practical
- Erkläre Inhalte stark anwendungsorientiert mit realen Szenarien und konkreten Aufgaben.
- Nutze Handlungsanweisungen, typische Praxisfehler und Lösungswege.
- Formuliere auf Umsetzbarkeit und Transfer in Klausuraufgaben.`;
  }

  return `LEARNING_STYLE_PROFILE: mixed
- Kombiniere visual, analytical und practical gleichmäßig.
- Liefere visuelle Struktur, logische Begründung und praktische Anwendung pro Antwort.
- Halte die Darstellung balanciert und trotzdem prüfungsfokussiert.`;
}

function getLearningStyleLabel(style) {
  const normalized = normalizeLearningStyle(style);
  return LEARNING_STYLE_LABELS[normalized] || LEARNING_STYLE_LABELS.mixed;
}

module.exports = {
  ALLOWED_LEARNING_STYLES,
  normalizeLearningStyle,
  getLearningStylePromptBlock,
  getLearningStyleLabel
};

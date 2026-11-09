/**
 * Racine minimale de la Phase 1.
 *
 * Aucune fonctionnalité métier : cet écran sert uniquement à prouver que la
 * chaîne React 19 + Vite + TypeScript + Vitest est opérationnelle. Les écrans
 * réels arrivent en Phase 4, contre les contrats de `src/domain/**\/types.ts`.
 */
export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-kicker">Phase 1 — Socle d’architecture</p>
        <h1 className="app-title">Aron 36</h1>
        <p className="app-lead">
          Entraîneur de mémorisation des 36 questions d’Arthur Aron. Le contenu et les écrans
          arrivent dans les phases suivantes.
        </p>
      </header>

      <main className="app-main">
        <section className="panel" aria-labelledby="status-title">
          <h2 id="status-title">Contrats gelés</h2>
          <p>
            Le domaine est pur, l’I/O est aux frontières. Cette page ne charge aucune progression et
            n’écrit rien dans le navigateur.
          </p>
          <ul className="checklist">
            <li>36 questions, 3 actes, 5 directions de drill</li>
            <li>Ordonnanceur SRS déterministe, horloge et aléa injectés</li>
            <li>Persistance locale versionnée, export et import JSON</li>
          </ul>
        </section>
      </main>

      <footer className="app-footer">
        <p>Application statique, hors ligne, sans compte et sans serveur.</p>
      </footer>
    </div>
  );
}

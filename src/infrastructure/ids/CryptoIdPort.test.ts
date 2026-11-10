import { describe, expect, it } from 'vitest';

import { CryptoIdPort } from './CryptoIdPort';

describe('CryptoIdPort', () => {
  it('préfixe chaque type d’identifiant pour la lisibilité des journaux', () => {
    const port = new CryptoIdPort({ uuid: () => 'uuid-fixe' });
    expect(port.newSessionId()).toBe('s_uuid-fixe');
    expect(port.newReviewLogId()).toBe('r_uuid-fixe');
    expect(port.newProfileId()).toBe('p_uuid-fixe');
  });

  it('produit des identifiants uniques via crypto', () => {
    const port = new CryptoIdPort();
    const seen = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      seen.add(port.newReviewLogId());
    }
    expect(seen.size).toBe(100);
    for (const id of seen) {
      expect(id.startsWith('r_')).toBe(true);
    }
  });

  it('reste formaté en UUID v4 même via le repli getRandomValues', () => {
    const port = new CryptoIdPort();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let index = 0; index < 20; index += 1) {
      const id = port.newSessionId().slice(2);
      expect(id).toMatch(uuidPattern);
    }
  });
});

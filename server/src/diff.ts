/**
 * Kelime düzeyinde fark (LCS). Sözleşme versiyonlarını karşılaştırmak ve Word'e
 * "değişiklikleri izle" olarak aktarmak için kullanılır.
 */
export type DiffPart = { op: 'eq' | 'ins' | 'del'; text: string };

/** Metni kelime ve boşluk parçalarına böler; boşluklar korunur. */
export function tokenize(text: string) {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export function diffWords(oldText: string, newText: string): DiffPart[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  // Ortak baş ve sonu ayır: uzun ve az değişmiş metinlerde tabloyu küçültür.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const parts: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += text;
    else parts.push({ op, text });
  };
  push('eq', a.slice(0, start).join(''));

  if (midA.length * midB.length > 4_000_000) {
    // Çok büyük fark: ortayı tümüyle sil / ekle olarak göster.
    push('del', midA.join(''));
    push('ins', midB.join(''));
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push('eq', midA[i]);
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        push('del', midA[i++]);
      } else {
        push('ins', midB[j++]);
      }
    }
    while (i < n) push('del', midA[i++]);
    while (j < m) push('ins', midB[j++]);
  }
  push('eq', a.slice(endA).join(''));
  return tidy(parts);
}

/**
 * Değişiklikler arasında kalan kısa ortak parçaları ("ve", "bir" gibi) değişikliğe katar;
 * böylece fark kelime kelime parçalanmaz, okunur cümleler halinde görünür.
 */
function tidy(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const between = p.op === 'eq' && i > 0 && i < parts.length - 1 && parts[i - 1].op !== 'eq' && parts[i + 1].op !== 'eq';
    if (between && p.text.trim().split(/\s+/).filter(Boolean).length <= 2 && !p.text.includes('\n')) {
      out.push({ op: 'del', text: p.text }, { op: 'ins', text: p.text });
    } else out.push({ ...p });
  }
  // Ardışık değişiklik bloklarını "önce silinen, sonra eklenen" olarak birleştir.
  const merged: DiffPart[] = [];
  for (let i = 0; i < out.length; ) {
    if (out[i].op === 'eq') {
      merged.push(out[i++]);
      continue;
    }
    let del = '';
    let ins = '';
    while (i < out.length && out[i].op !== 'eq') {
      if (out[i].op === 'del') del += out[i].text;
      else ins += out[i].text;
      i++;
    }
    if (del) merged.push({ op: 'del', text: del });
    if (ins) merged.push({ op: 'ins', text: ins });
  }
  return merged;
}

/** Değişen yerleri madde/paragraf bağlamıyla özetler. */
export function changeSummary(oldText: string, newText: string) {
  const parts = diffWords(oldText, newText);
  const changes: { kind: 'eklendi' | 'silindi' | 'degisti'; removed: string; added: string; context: string; paragraph: number }[] = [];
  let before = '';
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p.op === 'eq') {
      before += p.text;
      continue;
    }
    let removed = '';
    let added = '';
    while (k < parts.length && parts[k].op !== 'eq') {
      if (parts[k].op === 'del') removed += parts[k].text;
      else added += parts[k].text;
      k++;
    }
    k--;
    if (!removed.trim() && !added.trim()) {
      before += removed;
      continue;
    }
    const paragraph = before.split('\n').length;
    const line = before.split('\n').pop() ?? '';
    const heading = [...before.matchAll(/^\s*(Madde\s+\d+[^\n]*|\d+(?:\.\d+)*[.)]\s[^\n]*)$/gim)].pop()?.[1] ?? '';
    changes.push({
      kind: removed.trim() && added.trim() ? 'degisti' : added.trim() ? 'eklendi' : 'silindi',
      removed: removed.trim(),
      added: added.trim(),
      context: (heading ? `${heading.trim().slice(0, 60)} · ` : '') + line.slice(-60),
      paragraph,
    });
    before += removed;
  }
  return changes;
}

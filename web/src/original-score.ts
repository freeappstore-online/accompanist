export function readMusicXml(text: string) {
  if (text.length > 5 * 1024 * 1024) throw new Error('MusicXML files must be smaller than 5 MB.');
  if (/<!ENTITY/i.test(text)) throw new Error('MusicXML entity declarations are not supported.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'score-partwise') throw new Error('Choose an uncompressed, partwise MusicXML score (.musicxml or .xml).');
  if (doc.doctype) doc.removeChild(doc.doctype);
  // User files remain local: embedded image references cannot fetch remote assets.
  doc.querySelectorAll('image, credit-image').forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => [...node.attributes].filter(a => a.name.toLowerCase().includes('href')).forEach(a => node.removeAttribute(a.name)));
  const parts = [...doc.documentElement.children].filter(c => c.tagName === 'part');
  const bars = parts[0] ? [...parts[0].children].filter(c => c.tagName === 'measure') : [];
  if (!bars.length || bars.length > 5000) throw new Error('The MusicXML score must contain between 1 and 5,000 measures.');
  let divisions = 1, nominal = 4, beat = 0;
  const measures = bars.map((bar, index) => {
    const attrs = bar.querySelector('attributes');
    divisions = Number(attrs?.querySelector('divisions')?.textContent) || divisions;
    const beats = Number(attrs?.querySelector('time beats')?.textContent), denominator = Number(attrs?.querySelector('time beat-type')?.textContent);
    if (beats > 0 && denominator > 0) nominal = beats * 4 / denominator;
    let cursor = 0, end = 0, previousStart = 0;
    for (const element of bar.children) {
      const duration = Number(element.querySelector('duration')?.textContent) / divisions;
      if (!Number.isFinite(duration) || duration < 0) continue;
      if (element.tagName === 'backup') cursor -= duration;
      else if (element.tagName === 'forward') { cursor += duration; end = Math.max(end, cursor); }
      else if (element.tagName === 'note' && !element.querySelector('grace')) {
        const start = element.querySelector('chord') ? previousStart : cursor;
        end = Math.max(end, start + duration);
        if (!element.querySelector('chord')) { previousStart = start; cursor += duration; }
      }
    }
    const measure = { number: index + 1, label: bar.getAttribute('number') || String(index + 1), start: beat, end: beat + (end || nominal) };
    beat = measure.end; return measure;
  });
  return { xml: new XMLSerializer().serializeToString(doc), measures };
}

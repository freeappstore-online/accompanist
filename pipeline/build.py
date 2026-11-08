"""Build every song in pipeline/songs.json into web/public/songs/<id>/, before deploy.

    python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
    LILYPOND_BIN=/path/to/lilypond-2.24/bin .venv/bin/python -I pipeline/build.py [song-id ...]

LilyPond reads each Mutopia source and pipeline/events.ly writes down every note, syllable,
key, time signature, dynamic and bar number as LilyPond interprets them. From those events:
  score.musicxml     the voice with its words above the piano, bar numbers as LilyPond counts them
  accompaniment.mid  the piano staves only, velocities following the dynamics
web/src/catalog.json lists the songs with credits and their phrases (named start points), and
web/songs-provenance.json pins the source and output hashes the tests check.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from fractions import Fraction
from pathlib import Path

from music21 import chord, clef, key, layout, meter, metadata, midi, note, pitch, stream, tempo, volume
from music21.musicxml.m21ToXml import GeneralObjectExporter

ROOT = Path(__file__).resolve().parent.parent
MUTOPIA = 'https://www.mutopiaproject.org/ftp/'
BIN = Path(os.environ['LILYPOND_BIN']) if os.environ.get('LILYPOND_BIN') else None
LEVELS = {'ppp': .25, 'pp': .33, 'p': .45, 'mp': .55, 'mf': .65, 'f': .78, 'ff': .88, 'fff': .95, 'sf': .8, 'sfz': .82, 'fp': .78}


class Reject(Exception):
    pass


def tool(name):
    return str(BIN / name) if BIN else name


def q(value):
    """LilyPond moment (whole notes, printed as a float) → exact quarter notes."""
    return Fraction(value).limit_denominator(1920) * 4


def read_events(source, workdir):
    ly = workdir / 'song.ly'
    ly.write_text(source)
    # Upgrades old syntax in place; it reports rules it cannot apply automatically, which LilyPond then judges.
    subprocess.run([tool('convert-ly'), '-e', str(ly)], capture_output=True)
    run = subprocess.run([tool('lilypond'), f'-dinclude-settings={ROOT / "pipeline/events.ly"}', '-dno-print-pages', '-s',
                          '-o', str(workdir / 'song'), str(ly)], capture_output=True, text=True, timeout=300)
    if run.returncode:
        raise Reject('LilyPond failed: ' + run.stderr[-400:])
    rows = [line.split('\t') for line in (workdir / 'song.events').read_text().splitlines()]
    midis = sorted(workdir.glob('song*.mid*'))
    return rows, midis


def parse(rows):
    staves, lyrics, hyphens, marks = {}, {}, set(), {'time': {}, 'key': {}, 'bar': {}, 'tempo': [], 'dyn': [], 'hairpin': []}
    pickup = Fraction(0)
    for row in rows:
        t, grace, staff, group, kind, *v = row
        t = q(t)
        if kind == 'note':
            if Fraction(grace) != 0:
                continue  # grace notes are left out of score and playback
            name, alter = 'CDEFGAB'[int(v[3])], float(Fraction(v[4])) * 2
            staves.setdefault(staff, {'group': group, 'notes': []})['notes'].append(
                {'t': t, 'd': q(v[2]), 'midi': int(v[1]), 'step': name, 'alter': alter, 'octave': int(v[5]) + 4, 'voice': v[0], 'tie': False})
        elif kind == 'tie':
            for n in staves.get(staff, {'notes': []})['notes'][::-1]:
                if n['voice'] == v[0] and n['t'] == t:
                    n['tie'] = True
        elif kind == 'lyric':
            lyrics.setdefault(v[0], []).append([t, v[1] if len(v) > 1 else ''])
        elif kind == 'hyphen':
            hyphens.add((v[0], t))  # reported just before the syllable it follows, at the same moment
        elif kind == 'time':
            marks['time'][t] = (int(v[0]), int(v[1]))
        elif kind == 'key':
            marks['key'].setdefault(t, int(float(Fraction(v[0]))))
        elif kind == 'bar':
            marks['bar'][t] = int(v[0])
        elif kind == 'position' and Fraction(v[0]) < 0:
            pickup = -q(v[0])
        elif kind == 'tempo' and len(v) > 2 and v[1] and v[2]:
            marks['tempo'].append((t, float(v[1]) * float(q(v[2])), v[0]))
        elif kind == 'dynamic' and v and v[0] in LEVELS:
            marks['dyn'].append((t, staff, LEVELS[v[0]]))
        elif kind in ('cresc', 'decresc'):
            marks['hairpin'].append((t, staff, kind, int(v[0])))
    for ctx, t in hyphens:
        syllable = next((s for s in lyrics.get(ctx, []) if s[0] == t and s[1].strip()), None)
        if syllable and not syllable[1].endswith('-'):
            syllable[1] += '-'
    return staves, lyrics, marks, pickup


def merge_ties(notes):
    """A tied note and its continuation become one note, so playback holds it and the score re-ties it at bar lines."""
    notes = sorted(notes, key=lambda n: (n['t'], n['midi']))
    out = []
    for n in notes:
        prev = next((p for p in reversed(out) if p['tie'] and p['midi'] == n['midi'] and p['t'] + p['d'] == n['t']), None)
        if prev:
            prev['d'] += n['d']
            prev['tie'] = n['tie']
        else:
            out.append(dict(n))
    return out


def pick_staves(staves, lyrics):
    onsets = {s: {n['t'] for n in v['notes']} for s, v in staves.items()}
    times = [t for syllables in lyrics.values() for t, text in syllables if text]
    if not times:
        raise Reject('no lyrics')
    def chords(s):
        return sum(1 for n in staves[s]['notes'] if sum(m['t'] == n['t'] for m in staves[s]['notes']) > 1)
    # The voice carries the words; the piano often doubles the tune, so prefer a staff outside the piano brace,
    # then the one that sings most of the syllables, then the one without chords.
    voice = max(onsets, key=lambda s: (staves[s]['group'] not in ('PianoStaff', 'GrandStaff'),
                                       sum(t in onsets[s] for t in times) >= .8 * len(times), -chords(s)))
    piano = [s for s in staves if s != voice]
    if len(piano) != 2:
        raise Reject(f'expected a voice and a two-staff piano, found {len(staves)} staves')
    piano.sort(key=lambda s: -sum(n['midi'] for n in staves[s]['notes']) / len(staves[s]['notes']))
    return voice, piano


def velocity_at(marks, piano_staves, voice_staff):
    """Loudness over time from the piano's dynamics (or the voice's, if the piano has none); hairpins ramp."""
    own = [m for m in marks['dyn'] if m[1] in piano_staves or m[1] == '-']
    points = sorted((t, level) for t, _, level in (own or [m for m in marks['dyn'] if m[1] == voice_staff]))
    pins = [h for h in marks['hairpin'] if h[1] in piano_staves or h[1] == '-'] or [h for h in marks['hairpin'] if h[1] == voice_staff]
    spans, open_pin = [], None
    for t, _, kind, direction in sorted(pins, key=lambda h: h[0]):
        if direction == -1:
            open_pin = (t, kind)
        elif open_pin:
            spans.append((open_pin[0], t, open_pin[1]))
            open_pin = None

    def level(t):
        before = [l for pt, l in points if pt <= t]
        base = before[-1] if before else LEVELS['mf']
        for s, e, kind in spans:
            if s <= t < e and e > s:
                after = next((l for pt, l in points if e <= pt <= e + 1), None)
                start = ([l for pt, l in points if pt <= s] or [LEVELS['mf']])[-1]
                target = after if after is not None else start + (.12 if kind == 'cresc' else -.12)
                return start + (target - start) * float((t - s) / (e - s))
        return base
    return level


def make_pitch(n):
    p = pitch.Pitch(step=n['step'], octave=n['octave'])
    if n['alter']:
        p.accidental = pitch.Accidental(n['alter'])
    return p


def build_part(cls, part_id, name, notes, marks, pickup, end):
    part = cls(id=part_id)
    part.partName = name
    num, den = marks['time'].get(Fraction(0), (4, 4))
    shift = Fraction(num * 4, den) - pickup if pickup else 0  # a pickup is padded to a whole bar, then trimmed
    groups = {}
    for n in notes:
        groups.setdefault((n['t'], n['d']), []).append(n)
    for (t, d), ns in sorted(groups.items()):
        ns.sort(key=lambda n: n['midi'])
        element = note.Note(make_pitch(ns[0])) if len(ns) == 1 else chord.Chord([make_pitch(n) for n in ns])
        element.quarterLength = d
        part.insert(t + shift, element)
    for t, (num, den) in sorted(marks['time'].items()):
        part.insert(t + shift if t else 0, meter.TimeSignature(f'{num}/{den}'))
    for t, sharps in sorted(marks['key'].items()):
        part.insert(t + shift if t else 0, key.KeySignature(sharps))
    part.insert(0, clef.bestClef(part, recurse=True))
    part.makeRests(fillGaps=True, refStreamOrTimeRange=[0, end + shift], inPlace=True)
    part.makeMeasures(inPlace=True)
    for m in part.getElementsByClass(stream.Measure):
        items = sorted(m.notesAndRests, key=lambda e: e.offset)
        if any(a.offset + a.quarterLength > b.offset for a, b in zip(items, items[1:])):
            m.makeVoices(inPlace=True, fillGaps=True)
    part.makeTies(inPlace=True)
    measures = list(part.getElementsByClass(stream.Measure))
    if pickup:
        first = measures[0]
        for element in list(first.recurse().notesAndRests):
            if element.getOffsetInHierarchy(first) < shift:
                element.activeSite.remove(element)
        for element in list(first.recurse().notesAndRests):
            element.activeSite.coreSetElementOffset(element, element.offset - shift)
        for v in first.voices:
            first.coreSetElementOffset(v, 0.0)
        first.coreElementsChanged()
        first.paddingLeft = float(shift)
    return part, measures, shift


def place_lyrics(voice_notes, lyrics, order):
    """Each verse's syllables go on the voice notes they start with. Older editions time some lyrics by
    their own durations, which can drift inside a melisma; those take the latest free note before."""
    onsets = sorted(voice_notes)
    moved = []
    for number, ctx in enumerate(order, 1):
        continuing, previous = False, Fraction(-1)
        for t, word in lyrics[ctx]:
            word = word.strip()
            if word in ('', '_', '""'):
                continue
            free = [o for o in onsets if previous < o <= t]
            if not free:
                raise Reject(f'verse {number}: no note for "{word}" at beat {t}')
            if free[-1] != t:
                moved.append(f'verse {number} "{word}" {float(t)}→{float(free[-1])}')
            hyphen = word.endswith('-')
            text = word.rstrip('-').replace('~', '‿').replace('_', ' ')
            syllabic = ('middle' if hyphen else 'end') if continuing else ('begin' if hyphen else 'single')
            voice_notes[free[-1]].lyrics.append(note.Lyric(text=text, number=number, syllabic=syllabic))
            continuing, previous = hyphen, free[-1]
    return moved


def phrases(voice, lyrics, first_verse, bar_at):
    """Named start points: each sung phrase, named by its first words. A phrase starts after a rest of a
    beat or more, or after any rest that follows the end of a line of the poem (a syllable ending in , ; . ! ? :)."""
    words = {t: w.strip() for t, w in lyrics[first_verse] if w.strip() not in ('', '_', '""')} if first_verse else {}
    starts, end, last_word = [], None, ''
    for n in voice:
        gap = n['t'] - end if end is not None else None
        if gap is None or gap >= 1 or (gap > 0 and re.search(r'[,;.!?:]["’\')]*$', last_word)):
            starts.append(n['t'])
        end = max(end or 0, n['t'] + n['d'])
        last_word = words.get(n['t'], last_word)
    out, seen = [], {}
    for i, s in enumerate(starts):
        stop = starts[i + 1] if i + 1 < len(starts) else None
        text = ''
        for t in sorted(words):
            if t >= s and (stop is None or t < stop):
                w = words[t]
                text += w[:-1] if w.endswith('-') else w + ' '
        name = ' '.join(re.sub(r"[^\w’']+", ' ', text.replace('~', ' ').replace('_', ' ')).split()[:3]) or f'Phrase {i + 1}'
        name = name[:1].upper() + name[1:]
        bar = bar_at(s)
        if out and bar - out[-1]['bar'] < 2:
            continue
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            name = f'{name} ({seen[name]})'
        if not out or bar - out[-1]['bar'] >= 2:  # start points at least two bars apart
            out.append({'name': name, 'bar': bar})
    return out


def header(ly, field):
    m = re.search(field + r'\s*=\s*"([^"]*)"', ly)
    return m.group(1).strip() if m else ''


def build(song, workdir):
    url = MUTOPIA + song['path']
    data = urllib.request.urlopen(url).read()
    digest = hashlib.sha256(data).hexdigest()
    if song.get('sha256') and digest != song['sha256']:
        raise Reject(f'source changed upstream: {digest}')
    source = data.decode('utf-8')
    if 'Public Domain' not in header(source, 'copyright') + header(source, 'license'):
        raise Reject('not public domain')
    if '\\alternative' in source:
        raise Reject('volta alternatives are not supported yet')
    rows, midis = read_events(source, workdir)
    staves, lyrics, marks, pickup = parse(rows)
    voice_staff, piano = pick_staves(staves, lyrics)
    voice = merge_ties(staves[voice_staff]['notes'])
    hands = [merge_ties(staves[s]['notes']) for s in piano]
    end = max(n['t'] + n['d'] for ns in (voice, *hands) for n in ns)

    bars = sorted(marks['bar'].items())
    def bar_at(t):
        return max([b for bt, b in bars if bt <= t], default=0)

    score = stream.Score()
    score.metadata = metadata.Metadata(title=song['title'], composer=song['composer'])
    if song.get('poet'):
        score.metadata.lyricist = song['poet']
    vpart, vmeasures, shift = build_part(stream.Part, 'Voice', 'Voice', voice, marks, pickup, end)
    rh, _, _ = build_part(stream.PartStaff, 'PianoRH', 'Piano', hands[0], marks, pickup, end)
    lh, _, _ = build_part(stream.PartStaff, 'PianoLH', 'Piano', hands[1], marks, pickup, end)

    # Bar numbers: LilyPond's own, and the measures must start exactly where LilyPond's bars do.
    starts, t = [], Fraction(0)
    for m in vmeasures:
        starts.append(t)
        t += Fraction(m.barDuration.quarterLength) - (Fraction(m.paddingLeft) if m.paddingLeft else 0)
    lily_starts = sorted({Fraction(0)} | {bt for bt, _ in bars if bt < end})
    if starts != lily_starts:
        diff = next((f'{float(a)} vs {float(b)}' for a, b in zip(starts, lily_starts) if a != b), f'{len(starts)} vs {len(lily_starts)} bars')
        raise Reject(f'bar lines differ from LilyPond ({diff})')
    for part in (vpart, rh, lh):
        for m, s in zip(part.getElementsByClass(stream.Measure), starts):
            m.number = 0 if pickup and s == 0 else bar_at(s)

    sung = {}
    for m, s in zip(vmeasures, starts):
        for n in m.recurse().notes:
            if not n.tie or n.tie.type == 'start':
                sung[s + Fraction(n.getOffsetInHierarchy(m)).limit_denominator(1920)] = n
    order = sorted(lyrics, key=lambda c: next((i for i, row in enumerate(rows) if row[4] == 'lyric' and row[5] == c), 0))
    order = [c for c in order if any(w.strip() not in ('', '_', '""') for _, w in lyrics[c])]
    moved = place_lyrics(sung, lyrics, order)

    tempos = marks['tempo'] or midi_tempo(midis)
    if tempos:
        mark = tempo.MetronomeMark(text=tempos[0][2] or None, number=round(tempos[0][1]), referent=1.0)
        vmeasures[0].insert(0, mark)
    for part in (vpart, rh, lh):
        score.insert(0, part)
    score.insert(0, layout.StaffGroup([rh, lh], name='Piano', symbol='brace'))

    xml = GeneralObjectExporter(score).parse().decode()
    xml = re.sub(r'\s*<encoding-date>.*?</encoding-date>', '', xml)
    for index, part_id in enumerate(dict.fromkeys(re.findall(r'id="(P[0-9a-f]{32})"', xml)), 1):
        xml = xml.replace(part_id, f'P{index}')
    xml = xml.replace('<measure implicit="no" number="0">', '<measure implicit="yes" number="0">')

    out = ROOT / 'web/public/songs' / song['id']
    out.mkdir(parents=True, exist_ok=True)
    (out / 'score.musicxml').write_text(xml)
    (out / 'accompaniment.mid').write_bytes(accompaniment(hands, piano, voice_staff, marks, tempos))
    return {
        'digest': digest, 'moved': moved, 'verses': len(order),
        'info': {
            'id': song['id'], 'title': song['title'], 'composer': song['composer'], 'poet': song.get('poet', ''),
            'source': 'Mutopia Project', 'sourceUrl': url.rsplit('/', 1)[0] + '/', 'rights': 'Public domain',
            'edition': f"Typeset by {header(source, 'maintainer') or 'a Mutopia volunteer'}"
                       + (f" from {header(source, 'source')}" if header(source, 'source') else '') + '.',
            'license': '/songs/mutopia-license.txt',
            'phrases': phrases(voice, lyrics, order[0] if order else None, bar_at),
        },
    }


def midi_tempo(midis):
    for path in midis:
        mf = midi.MidiFile()
        mf.open(str(path)); mf.read(); mf.close()
        for track in mf.tracks:
            for e in track.events:
                if e.type == midi.MetaEvents.SET_TEMPO:
                    return [(Fraction(0), 60_000_000 / int.from_bytes(e.data, 'big'), '')]
    return []


def accompaniment(hands, piano, voice_staff, marks, tempos):
    level = velocity_at(marks, piano, voice_staff)
    score = stream.Score()
    for index, notes in enumerate(hands):
        part = stream.Part(id=f'Piano{index}')
        part.partName = ('Piano right hand', 'Piano left hand')[index]
        if index == 0:
            for t, bpm, _ in tempos:
                part.insert(t, tempo.MetronomeMark(number=bpm, referent=1.0))
        for n in notes:
            element = note.Note(n['midi'], quarterLength=n['d'])
            element.volume = volume.Volume(velocity=max(20, min(120, round(level(n['t']) * 127))))
            part.insert(n['t'], element)
        score.insert(0, part)
    mf = midi.translate.music21ObjectToMidiFile(score)
    return mf.writestr()


def main():
    songs = json.loads((ROOT / 'pipeline/songs.json').read_text())
    only = set(sys.argv[1:])
    catalog_path, prov_path = ROOT / 'web/src/catalog.json', ROOT / 'web/songs-provenance.json'
    catalog = {s['id']: s for s in json.loads(catalog_path.read_text())} if catalog_path.exists() else {}
    provenance = json.loads(prov_path.read_text())
    for song in songs:
        if only and song['id'] not in only:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            try:
                result = build(song, Path(tmp))
            except Reject as error:
                print(f'✗ {song["id"]}: {error}')
                continue
        song['sha256'] = result['digest']
        catalog[song['id']] = result['info']
        out = ROOT / 'web/public/songs' / song['id']
        provenance[song['id']] = {f: {'from': MUTOPIA + song['path'], 'script': 'pipeline/build.py',
                                      'sha256': hashlib.sha256((out / f).read_bytes()).hexdigest()}
                                  for f in ('accompaniment.mid', 'score.musicxml')}
        print(f'✓ {song["id"]}: {result["verses"]} verse(s), {len(result["info"]["phrases"])} phrases', *result['moved'], sep='\n    ')
    ids = [s['id'] for s in songs]
    catalog_path.write_text(json.dumps([catalog[i] for i in ids if i in catalog], indent=2, ensure_ascii=False) + '\n')
    prov_path.write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + '\n')
    (ROOT / 'pipeline/songs.json').write_text(json.dumps(songs, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()

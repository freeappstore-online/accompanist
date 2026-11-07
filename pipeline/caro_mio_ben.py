"""Build web/public/songs/caro-mio-ben/ from the Mutopia Project edition.

Run before deploy (not in the browser):
    python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
    .venv/bin/python -I pipeline/caro_mio_ben.py

Inputs are pinned by hash. Outputs:
  accompaniment.mid  the edition's MIDI with the voice and lyric tracks removed, so only the piano plays
  score.musicxml     voice (Italian and English words) above the piano, bar 0 being the half-bar pickup
"""
import hashlib
import re
import sys
import urllib.request
from pathlib import Path

from music21 import chord, clef, key, layout, meter, metadata, midi, note, pitch, stream, tempo
from music21.musicxml.m21ToXml import GeneralObjectExporter

BASE = 'https://www.mutopiaproject.org/ftp/GiordanoG/caromioben/'
SOURCES = {
    'caromioben.ly': 'c55c9c9951e906158abd8b7bb4e6488201fd94c47438bf0beb52eaf3911009b8',
    'caromioben.mid': '267d08fb3fa8e594b84b8a179dd7a0077d7d2cce86547f90514649b673d82a34',
}
OUT = Path(__file__).resolve().parent.parent / 'web/public/songs/caro-mio-ben'
PICKUP = 2.0  # \partial 2
GRID = 0.25   # the edition's shortest written value is a sixteenth; anything off it is a grace note


def fetch(name):
    data = urllib.request.urlopen(BASE + name).read()
    digest = hashlib.sha256(data).hexdigest()
    if SOURCES[name] and digest != SOURCES[name]:
        sys.exit(f'{name} changed upstream: {digest}')
    print(name, digest)
    return data


def piano_only(data):
    """Drop the voice and lyric tracks; keep the conductor track and both piano hands untouched."""
    mf = midi.MidiFile()
    mf.readstr(data)
    def name(track):
        return next((e.data.decode() for e in track.events if e.type == midi.MetaEvents.SEQUENCE_TRACK_NAME), '')
    mf.tracks = [t for t in mf.tracks if name(t) not in ('voice', 'It', 'En')]
    names = [name(t) for t in mf.tracks]
    assert 'pianoRH' in names and 'pianoLH' in names, names
    return mf.writestr()


def tracks(data):
    """Notes per named track as (onset, end, midi) in quarter notes, grace notes removed."""
    mf = midi.MidiFile()
    mf.readstr(data)
    tpq = mf.ticksPerQuarterNote
    result = {}
    for track in mf.tracks:
        tick, name, open_notes, notes = 0, '', {}, []
        for e in track.events:
            if isinstance(e, midi.DeltaTime):
                tick += e.time
            elif e.type == midi.MetaEvents.SEQUENCE_TRACK_NAME:
                name = e.data.decode()
            elif e.type == midi.ChannelVoiceMessages.NOTE_ON and e.velocity > 0:
                open_notes.setdefault(e.pitch, []).append(tick)
            elif e.type in (midi.ChannelVoiceMessages.NOTE_OFF, midi.ChannelVoiceMessages.NOTE_ON) and open_notes.get(e.pitch):
                start = open_notes[e.pitch].pop(0)
                # Snapping restores the note a grace note borrowed time from and collapses the grace itself.
                s, t = round(start / tpq / GRID) * GRID, round(tick / tpq / GRID) * GRID
                if t > s:
                    notes.append((s, t, e.pitch))
        if notes:
            result.setdefault(name, []).extend(notes)
    return result


def lyric_syllables(ly, block):
    """(onset, text) for each sung syllable. The edition times its lyrics by their own durations."""
    body = re.search(block + r'\s*=\s*\\lyricmode\s*\{(.*?)\n\}', ly, re.S).group(1)
    time, last, out = 0.0, 4.0, []
    for token in body.replace('|', ' ').split():
        if token.startswith('\\') or token in ('__', '--') or token.isdigit():
            continue
        m = re.fullmatch(r'(.*?)(\d+)?(\.*)', token)
        word, digits, dots = m.groups()
        if digits:
            last = 4 / int(digits) * (1.5 if dots else 1)
        elif dots:
            word += dots
        word = word.replace('__', '')
        if word not in ('', '""', '_'):
            out.append((time, word))
        time += last
    return out


def add_lyrics(by_onset, syllables, number):
    """Each syllable goes on the note starting at its time. A few of the edition's lyric durations drift
    inside a melisma; those take the latest free note before that time."""
    onsets = sorted(by_onset)
    continuing, previous = False, -1.0
    for time, word in syllables:
        free = [o for o in onsets if previous < o <= time]
        if not free:
            sys.exit(f'verse {number}: no voice note for "{word}" at beat {time}')
        onset = free[-1]
        if onset != time:
            print(f'verse {number}: "{word}" at beat {time} placed on the note at {onset}')
        hyphen = word.endswith('-')
        text = word.rstrip('-').replace('~', '\u203f').replace('_', ' ')
        syllabic = ('middle' if hyphen else 'end') if continuing else ('begin' if hyphen else 'single')
        by_onset[onset].lyrics.append(note.Lyric(text=text, number=number, syllabic=syllabic))
        continuing, previous = hyphen, onset


def spell(number):
    """Pitches from MIDI numbers carry explicit naturals; drop them so accidentals follow the key.
    The piece (D major, touching A major) has no flats, so black keys are spelled as sharps."""
    p = pitch.Pitch(midi=number)
    if p.accidental and p.accidental.alter < 0:
        p = p.getEnharmonic()
    if p.accidental and p.accidental.alter == 0:
        p.accidental = None
    return p


def build_part(cls, part_id, name, notes, part_clef, end):
    part = cls(id=part_id)
    part.partName = name
    groups = {}
    for s, t, pitch in notes:
        groups.setdefault((s, t), []).append(pitch)
    for (s, t), pitches in sorted(groups.items()):
        element = note.Note(spell(pitches[0])) if len(pitches) == 1 else chord.Chord([spell(p) for p in sorted(pitches)])
        element.quarterLength = t - s
        part.insert(s + PICKUP, element)  # shifted by the pickup so bar lines fall on whole bars
    part.insert(0, part_clef)
    part.insert(0, key.Key('D'))
    part.insert(0, meter.TimeSignature('4/4'))
    part.makeRests(fillGaps=True, refStreamOrTimeRange=[0, end + PICKUP], inPlace=True)
    part.makeMeasures(inPlace=True)
    for m in part.getElementsByClass(stream.Measure):
        if any(a.offset < b.offset + b.quarterLength and b.offset < a.offset + a.quarterLength
               for a, b in zip(m.notesAndRests, list(m.notesAndRests)[1:])):
            m.makeVoices(inPlace=True, fillGaps=True)
    part.makeTies(inPlace=True)
    measures = list(part.getElementsByClass(stream.Measure))
    first = measures[0]
    for element in list(first.recurse().notesAndRests):
        if element.getOffsetInHierarchy(first) < PICKUP:
            element.activeSite.remove(element)
    for element in list(first.recurse().notesAndRests):
        element.activeSite.coreSetElementOffset(element, element.offset - PICKUP)
    for v in first.voices:
        first.coreSetElementOffset(v, 0.0)
    first.coreElementsChanged()
    first.paddingLeft = PICKUP
    for index, m in enumerate(measures):
        m.number = index
    return part


def main():
    ly = fetch('caromioben.ly').decode()
    raw = fetch('caromioben.mid')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'accompaniment.mid').write_bytes(piano_only(raw))

    notes = tracks(raw)
    end = max(t for track in notes.values() for _, t, _ in track)
    score = stream.Score()
    score.metadata = metadata.Metadata(title='Caro mio ben', composer='Attributed to Giuseppe Giordani')
    voice = build_part(stream.Part, 'Voice', 'Voice', notes['voice'], clef.TrebleClef(), end)
    voice.measure(0).insert(0, tempo.MetronomeMark(text='Larghetto', number=80))
    # Score time of each sung note (the first bar is the pickup, so bar n starts at 2 + 4(n-1)).
    onsets = {(m.number and PICKUP + 4 * (m.number - 1)) + n.getOffsetInHierarchy(m): n
              for m in voice.getElementsByClass(stream.Measure) for n in m.recurse().notes if not n.tie or n.tie.type == 'start'}
    for number, block in ((1, 'ItalianWords'), (2, 'EnglishWords')):
        add_lyrics(onsets, lyric_syllables(ly, block), number)
    rh = build_part(stream.PartStaff, 'PianoRH', 'Piano', notes['pianoRH'], clef.TrebleClef(), end)
    lh = build_part(stream.PartStaff, 'PianoLH', 'Piano', notes['pianoLH'], clef.BassClef(), end)
    for part in (voice, rh, lh):
        score.insert(0, part)
    score.insert(0, layout.StaffGroup([rh, lh], name='Piano', symbol='brace'))

    xml = GeneralObjectExporter(score).parse().decode()
    # Reproducible output: no date, and stable part ids instead of music21's random ones.
    xml = re.sub(r'\s*<encoding-date>.*?</encoding-date>', '', xml)
    for index, part_id in enumerate(dict.fromkeys(re.findall(r'id="(P[0-9a-f]{32})"', xml)), 1):
        xml = xml.replace(part_id, f'P{index}')
    xml = xml.replace('<measure implicit="no" number="0">', '<measure implicit="yes" number="0">')  # unnumbered pickup
    (OUT / 'score.musicxml').write_text(xml)
    for f in ('accompaniment.mid', 'score.musicxml'):
        print(f, hashlib.sha256((OUT / f).read_bytes()).hexdigest())


if __name__ == '__main__':
    main()

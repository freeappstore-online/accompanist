%% Included with -dinclude-settings: writes every note, lyric syllable, key, time signature,
%% dynamic and bar number of the score, as LilyPond itself interprets it, to <file>.events.
%% Fields are tab-separated: moment (whole notes), grace moment, staff, staff group, kind, values...
\version "2.24.0"

#(define events-port #f)
#(define (context-key context)
   (if context (number->string (object-address context) 16) "-"))
#(define (emit context kind . values)
   (if (not events-port)
       (set! events-port (open-file (string-append (ly:parser-output-name) ".events") "w")))
   (let* ((now (ly:context-current-moment context))
          (staff (ly:context-find context 'Staff))
          (group (and staff (ly:context-parent staff))))
     (display (string-join
               (append (list (number->string (exact->inexact (ly:moment-main now)))
                             (number->string (exact->inexact (ly:moment-grace now)))
                             (context-key staff)
                             (if group (symbol->string (ly:context-name group)) "-")
                             kind)
                       (map (lambda (v) (if (string? v) v (ly:format "~a" v))) values))
               "\t")
              events-port)
     (newline events-port)
     (force-output events-port)))
#(define (text-of value)
   (cond ((string? value) value)
         ((markup? value) (markup->string value))
         (else "")))

#(define (voice-engraver context)
  (make-engraver
   (listeners
    ((note-event engraver event)
     (let ((pitch (ly:event-property event 'pitch)))
       (if (ly:pitch? pitch)
           (emit context "note" (context-key context)
                 (+ 60 (ly:pitch-semitones pitch))
                 (exact->inexact (ly:moment-main (ly:duration-length (ly:event-property event 'duration))))
                 (ly:pitch-notename pitch) (ly:pitch-alteration pitch) (ly:pitch-octave pitch)))))
    ((tie-event engraver event) (emit context "tie" (context-key context)))
    ((dynamic-event engraver event) (emit context "dynamic" (text-of (ly:event-property event 'text))))
    ((crescendo-event engraver event) (emit context "cresc" (ly:event-property event 'span-direction)))
    ((decrescendo-event engraver event) (emit context "decresc" (ly:event-property event 'span-direction)))
    ((tempo-change-event engraver event)
     (let ((count (ly:event-property event 'metronome-count))
           (unit (ly:event-property event 'tempo-unit)))
       (emit context "tempo" (text-of (ly:event-property event 'text))
             (if (number? count) count "")
             (if (ly:duration? unit) (exact->inexact (ly:moment-main (ly:duration-length unit))) "")))))))

#(define (lyrics-engraver context)
  (make-engraver
   (listeners
    ((lyric-event engraver event)
     (emit context "lyric" (context-key context) (text-of (ly:event-property event 'text))))
    ((hyphen-event engraver event) (emit context "hyphen" (context-key context))))))

#(define (staff-engraver context)
  (let ((last-time #f) (last-bar #f))
    (make-engraver
     (listeners
      ((key-change-event engraver event)
       (let ((alist (ly:event-property event 'pitch-alist)))
         (emit context "key"
               (apply + (map (lambda (p) (* 2 (cdr p))) (if (list? alist) alist '())))))))
     ((process-music engraver)
      (let ((fraction (ly:context-property context 'timeSignatureFraction))
            (bar (ly:context-property context 'currentBarNumber))
            (position (ly:context-property context 'measurePosition)))
        (if (not (equal? fraction last-time))
            (begin (set! last-time fraction)
                   (if (pair? fraction) (emit context "time" (car fraction) (cdr fraction)))))
        (if (and (ly:moment? position) (zero? (ly:moment-main position)) (not (equal? bar last-bar)))
            (begin (set! last-bar bar) (emit context "bar" bar)))
        (if (and (ly:moment? position) (zero? (ly:moment-main (ly:context-current-moment context))))
            (emit context "position" (exact->inexact (ly:moment-main position)))))))))

\layout {
  \context { \Voice \consists #voice-engraver }
  \context { \Dynamics \consists #voice-engraver }
  \context { \Lyrics \consists #lyrics-engraver }
  \context { \Staff \consists #staff-engraver }
}

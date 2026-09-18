%
O9006 (KAIJU MACROS - SENSE, MACRO HUNTER, AND ALIAS)
(/ EDITOR AND INSPECTION DEMO ONLY - DO NOT RUN ON A MACHINE)
(/ Select Mill and FANUC / ISO in KAIJU Machine Mode.)
(/ This small program repeats one motion line twelve times.)
(/ Follow the numbered tour below to inspect its changing macro values.)

(- 1 - PUT THE MACRO DICTIONARY BEFORE THE FIRST EXECUTABLE G OR M BLOCK)
(/ KAIJU Alias reads this header until the first executable G/M command.)
(/ Keep one short, distinct name per macro. The first definition wins.)
(/ Spaces become underscores and names become lowercase.)
(/ For example, STEP OVER becomes #step_over.)
(/ Put units and longer notes after the name in square brackets.)
(/ Bracket annotations stay in the comment but are excluded from the name.)
(/ Do not move this dictionary below the G21 setup line.)

(/ Style A: comment-only names, followed by real numeric assignments.)
(/ These comments establish names; the assignments establish values.)
(#100 = START X [mm])
(#101 = STEP OVER [mm per pass])
(#102 = DEPTH STEP [mm per pass])
(#103 = CUTTING FEED [mm per minute])
#100 = 0.000
#101 = 5.000
#102 = 0.250
#103 = 240.000
#104 = 1 (TOOL NUMBER [T-word selection])
#105 = 2000 (SPINDLE RPM [revolutions per minute])

(/ Style B: an assignment with its short name in the trailing comment.)
(/ Both styles are valid here because both are above the first G/M block.)
#110 = 0 (PASS COUNTER [updated inside the loop])
#111 = 12 (PASS COUNT [total repetitions])
#120 = 0.000 (CURRENT X [calculated position in mm])
#121 = 0.000 (CURRENT Z [calculated depth in mm])

(- 2 - TRY KAIJU ALIAS)
(/ Run KAIJU Alias from the Command Palette or editor context menu.)
(/ In setup, T#104 becomes T#tool_number and S#105 becomes S#spindle_rpm.)
(/ In the loop, #110 becomes #pass_counter and #120 becomes #current_x.)
(/ The defining header macro numbers stay numeric so the mapping survives.)
(/ Run KAIJU Alias again to return to numbered variables.)
(/ These readable aliases are an editing aid, not a controller dialect.)
(/ Try the Sense and Macro Hunter steps in both display modes.)

G21 G17 G90 G94 G40 G49 G80
N100 (SETUP)
T#104 M06
S#105 M03
G00 X0.000 Y0.000 Z5.000

(- 3 - TRY SENSE HOVERS AND DEFINITION NAVIGATION)
(/ Wait for passive Trace to finish, then hover #101 in the X calculation.)
(/ Sense links its identity to STEP OVER in the comment-only dictionary.)
(/ Hover #120 on the marked G01 line to inspect twelve executed values.)
(/ Longer hover histories show the first five and last five occurrences.)
(/ Ctrl-click a macro, or Cmd-click on macOS, to jump to its definition.)
(/ For #120 this takes you to the named header assignment.)

N200 (TWELVE STEPS - ONE SOURCE LINE, TWELVE EXECUTED POSITIONS)
WHILE [#110 LT #111] DO1
    #110 = #110 + 1
    #120 = #100 + [#101 * #110]
    #121 = -[#102 * #110]

    (- 4 - PUT THE CARET ON THE G01 LINE BELOW AND OPEN KAIJU MACRO HUNTER)
    (/ Use the Command Palette or the macro button in the editor title.)
    (/ Unpinned, the sidebar follows your caret. Pin holds this source line.)
    (/ Choose Occurrence 1, 6, and 12, or wheel over the occurrence selector.)
    (/ Each occurrence shows the resolved macro state AFTER that occurrence.)
    (/ At 1: PASS COUNTER is 1, CURRENT X is 5, CURRENT Z is -0.25.)
    (/ At 6: PASS COUNTER is 6, CURRENT X is 30, CURRENT Z is -1.50.)
    (/ At 12: PASS COUNTER is 12, CURRENT X is 60, CURRENT Z is -3.00.)
    (/ Click CURRENT X or its macro row to inspect its all-occurrence history.)
    (/ Unlike the compact hover, Hunter lets you inspect the middle passes.)
    (/ Compared with the previous occurrence, X increases and Z decreases.)
    (/ Increased values are green; decreased values are red.)
    (/ Pin this line, move the editor caret, then Unpin to resume following.)
    G01 X#120 Z#121 F#103
END1

(- 5 - COMPARE THE LOOP WITH ITS FINAL STATE)
(/ Place the caret on the retract below: the loop has now completed.)
(/ The final counter is 12, CURRENT X is 60, and CURRENT Z is -3.)
(/ Hover #120 on the next X move to see a single resolved value.)
N300 (RETRACT)
G00 Z5.000
G00 X#120
M05
M30
%

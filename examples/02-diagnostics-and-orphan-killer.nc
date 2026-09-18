%
O9002 (KAIJU ALERT AND ORPHAN KILLER - FIND AND FIX)
(/ EDITOR DEMO ONLY - INTENTIONAL ERRORS - DO NOT RUN ON A MACHINE)
(/ Choose Lathe Diameter and FANUC / ISO in KAIJU Machine Mode.)
(/ This example stays in the X-Z plane and uses Z for the arc chord.)
(/ Open the Problems panel and hover the marked code to read KAIJU Alert.)
(/ Alerts depend on your enabled settings; these use the default checks.)
(/ Run KAIJU Orphan Killer from the Command Palette for the macro report.)
(/ Work through the fixes below, then Refresh the report or enable Live.)
(/ Orphan Killer reports relationships; it does not delete macros for you.)

(- 1 - ONE USED DEFINITION, ONE UNUSED DEFINITION, ONE MISSING DEFINITION)
#100 = 20.000 (USED X POSITION)
#101 = 150.000 (USED FEED)
#190 = 9.000 (INTENTIONALLY UNUSED)
G21 G18 G90 G94 G40
G00 X0.000 Z5.000
G01 X#100 Z#199 F#101
(/ Expect #190 as defined but unused and #199 as used but undefined.)
(/ Fix: remove the unused assignment and define #199 before its use.)
(/ Try #199 = -10.000 as the missing Z position.)
(/ These comment-only references #777 and #778 are not executable uses.)
<PROTECTED DISPLAY TEXT #779>

(- 2 - DUPLICATE AND OUT-OF-ORDER SEQUENCE NUMBERS)
N100 (FIRST LABEL)
G00 Z5.000
N100 (INTENTIONALLY DUPLICATED - CHANGE TO N200)
G00 X0.000 Z5.000
N90 (INTENTIONALLY OUT OF ORDER - CHANGE TO N300)
(/ Each N label should be unique for this demonstration.)
(/ Ordering is a style alert and can be disabled for other shop conventions.)

(- 3 - UNRESOLVED JUMP TARGET)
IF [#100 LT 0.000] GOTO999
(/ No N999 exists. The static alert appears even though this IF is false.)
(/ Fix: change the target to the existing finish label N900.)

(- 4 - IMPOSSIBLE Z-AXIS ARC)
G00 X20.000 Z0.000
G02 X20.000 Z20.000 R5.000 F150.000
(/ X stays fixed. The Z chord is 20 mm while R5 spans only 10 mm.)
(/ This remains invalid in Lathe Diameter because the arc uses Z only.)
(/ Fix: change R5.000 to R10.000 for a geometrically valid semicircle.)

(- 5 - UNMATCHED LOOP END)
END2
(/ There is no WHILE ... DO2 for this END2. Remove this stray END2.)
(/ Trace may be unavailable until structural errors like this are fixed.)

N900 (FINISH)
M30
%

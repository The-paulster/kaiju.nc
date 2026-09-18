%
O9004 (KAIJU VISION AND CHRONOBLADE - ROUNDED PLATE)
(/ INSPECTION DEMO ONLY - DO NOT RUN ON A MACHINE)
(/ REQUIRED: Select Mill and FANUC / ISO using KAIJU Machine Mode.)
(/ This is an X-Y mill path. It is not a Lathe Diameter example.)
(/ If the KAIJU status item says Lathe Diameter, change this program to Mill.)
(/ Lathe Diameter halves X during arc geometry, so these I/J arcs will alert.)
(/ Clear the editor selection to analyse the complete program.)
(/ Run KAIJU Vision, choose X-Y, and Fit View for the face outline.)
(/ Use Trace motion: the loop makes three passes at Z-1, Z-2, and Z-3.)
(/ Try Dual View with Shared axis X to compare X-Y with X-Z.)
(/ Play walks the loop occurrences; watch the pass counter and Z position.)
(/ Switch Node line between Source and Trace to inspect repeated moves.)
(/ Run KAIJU Chronoblade on this same file with Motion set to Trace.)
(/ Compare with As written: that mode reads the authored loop body once.)
(/ Inspect cutting, G0, dwell, and tool time; expand the N-label sections.)
(/ G0 rate and tool-swap fields are timing assumptions you can change.)
(/ Set a nonzero tool-swap duration to see its contribution to tool time.)

#100 = 0 (PASS COUNTER)
#101 = 3 (PASS COUNT)
#102 = 1.000 (DEPTH PER PASS)
#103 = 300.000 (CONTOUR FEED MM PER MINUTE)

G21 G17 G90 G94 G40 G49 G80
N100 (TOOL 1 - THREE ROUNDED RECTANGLE PASSES)
T01 M06
S2400 M03
M08
G00 X0.000 Y0.000 Z10.000
G00 X5.000 Y0.000
(/ The outline is 60 by 40 mm with four 5 mm corner radii.)
(/ I and J are centre offsets from the start of each quarter-circle.)
WHILE [#100 LT #101] DO1
    #100 = #100 + 1
    G01 Z[-#100 * #102] F100.000
    G01 X55.000 Y0.000 F#103
    G03 X60.000 Y5.000 I0.000 J5.000
    G01 Y35.000
    G03 X55.000 Y40.000 I-5.000 J0.000
    G01 X5.000
    G03 X0.000 Y35.000 I0.000 J-5.000
    G01 Y5.000
    G03 X5.000 Y0.000 I5.000 J0.000
END1
G00 Z10.000
M09
M05

N200 (TOOL 2 - CENTRAL CIRCLE AT A DIFFERENT FEED)
(/ Tool colours separate the outline from this 16 mm diameter circle.)
(/ Two semicircles make the arc direction and endpoints easy to inspect.)
T02 M06
S3000 M03
M08
G00 X38.000 Y20.000
G01 Z-1.000 F100.000
G03 X22.000 Y20.000 I-8.000 J0.000 F200.000
G03 X38.000 Y20.000 I8.000 J0.000
(/ X on this dwell is a duration, not a new X endpoint.)
G04 X1.000
G00 Z10.000

N300 (RETURN AND END)
G00 X0.000 Y0.000
M09
M05
M30
%

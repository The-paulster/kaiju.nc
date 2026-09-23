%
O9007 (SHOWCASE)
(/ KAIJU INSPECTION SHOWCASE ONLY - DO NOT RUN ON A MACHINE)
(/ Select Mill and FANUC / ISO in KAIJU Machine Mode.)
(/ Open Vision in X-Y, choose Trace motion, then Fit View.)
(/ Dual View with Shared axis X shows the cutting depths.)
(/ Play reveals the seven facing lanes and three expanding circles.)

#100 = 0 (FACING LANE COUNTER)
#101 = 7 (NUMBER OF LANES)
#102 = -24.000 (FIRST LANE Y)
#103 = 8.000 (LANE SPACING)
#110 = 0 (CIRCLE COUNTER)
#111 = 3 (NUMBER OF CIRCLES)
#112 = 6.000 (FIRST TOOL CENTRE RADIUS)
#113 = 3.000 (RADIUS STEP)

G21 G17 G90 G94 G40 G49 G80
G54

N100 (TOOL 1 - FACE A 70 BY 48 MM PLATE)
T01 M06
S3200 M03
M08
G00 Z10.000
(/ Seven 80 mm strokes run past both X edges of the plate.)
(/ #100 and #102 change on each pass; Trace shows every lane.)
WHILE [#100 LT #101] DO1
    G00 X-40.000 Y#102
    G01 Z-0.400 F120.000
    G01 X40.000 F480.000
    G00 Z10.000
    #100 = #100 + 1
    #102 = #102 + #103
END1
M09
M05

N200 (TOOL 2 - THREE CONCENTRIC CIRCULAR GROOVES)
T02 M06
S2600 M03
M08
(/ The centreline radii are 6, 9, and 12 mm.)
(/ Each circle uses two semicircles with matching I/J centres.)
WHILE [#110 LT #111] DO2
    G00 X#112 Y0.000
    G01 Z-2.000 F100.000
    G03 X[-#112] Y0.000 I[-#112] J0.000 F260.000
    G03 X#112 Y0.000 I#112 J0.000
    G00 Z10.000
    #110 = #110 + 1
    #112 = #112 + #113
END2
M09
M05

N300 (TOOL 3 - SPOT THE FOUR CORNER HOLES)
T03 M06
S1800 M03
M08
G00 X-28.000 Y-18.000
G01 Z-2.500 F90.000
G00 Z10.000
G00 X28.000 Y-18.000
G01 Z-2.500 F90.000
G00 Z10.000
G00 X28.000 Y18.000
G01 Z-2.500 F90.000
G00 Z10.000
G00 X-28.000 Y18.000
G01 Z-2.500 F90.000
G00 Z10.000

N400 (END)
M09
M05
G00 X0.000 Y0.000
M30
%

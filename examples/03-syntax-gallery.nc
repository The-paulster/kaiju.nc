%
O9003 <KAIJU.NC SYNTAX GALLERY>
(/ EDITOR REFERENCE ONLY - DO NOT RUN ON A MACHINE)
(/ This gallery covers the token families in KAIJU's syntax grammar.)
(/ The independent snippets mix mill, lathe, and macro notation.)
(/ They are not one machining process or a controller compatibility guide.)
(/ Colour depends on your theme. Highlighting does not prove valid motion.)

(- COMMENT STYLES)
(Ordinary comment with [bracket emphasis] and {brace emphasis})
(- Operation title comment)
(= Equals-style comment)
(/ Metadata or explanatory comment)
<ANGLE-BRACKET TITLE>

(/ Header mapping gives the named variable below a KAIJU Alias identity.)
(#102 = NAMED VALUE)

N100 (PROGRAM AND BLOCK NUMBERS; RAPID, CUTTING, AND OTHER G CODES)
G21 G17 G90 G94 G40 G49 G80
G00 X0.000 Y0.000 Z5.000
G01 Z-1.000 F120.000
G02 X10.000 Y0.000 I5.000 J0.000
G03 X0.000 Y0.000 R5.000
(/ Decimal G codes are highlighted too; these are lathe polar commands.)
G12.1
G13.1

N200 (ADDRESS COLOURS AND NUMBER FORMS)
(/ XYZ are linear axes; UVW are incremental words in common lathe dialects.)
(/ ABC are rotary addresses; IJK are arc offsets; R and F have own scopes.)
(/ Plus signs, minus signs, leading dots, and trailing dots are shown here.)
X+10.000 Y-.500 Z5. U-1.000 V.250 W-2.000
A15.000 B30.000 C90.000 I-5.000 J0.000 K2.000 R10.000 F200.000
(/ T tool, H offset, S spindle, and L/P/Q cycle or call parameters.)
(/ Their meanings depend on the accompanying command and controller.)
T0101 H01 S1800 L2 P100 Q200
M03 M08
M09 M05

N300 (MACRO IDENTITIES AND ADDRESS EXPRESSIONS)
#100 = 10.000 (BASE VALUE)
#101 = 2.000 (STEP VALUE)
#named_value = 3.000 (NAMED VARIABLE TOKEN)
(/ The header maps #named_value to #102 for KAIJU Alias.)
(/ Numeric and named spellings are shown together here for comparison.)
X#100 Y-#101 Z#named_value
(/ Nested brackets keep the address scope while highlighting math words.)
X[#100 + [#101 * 2.000]] Y[ABS[-#101]] Z[-#100]
U[#101] V[#101 / 2.000] W[-#101]
A[#100] B[#100 + #101] C[#100 * #101]
I[-#101] J[#101] K[#101] R[#100] F[#100 * 20.000]
S[#100 * 100.000] T[100 + #101] H[#101]
L#101 P#100 Q#101
L[#101] P[#100] Q[#101 + [#100 MOD 3]]

N400 (ARITHMETIC, FUNCTIONS, AND COMPARISONS)
(/ All highlighted math-word families appear below; angles use degrees.)
#110 = [[#100 + #101] * 2.000 - #101 / 2.000]
#111 = [SIN[30] + COS[60] + TAN[45] + ATAN[1]]
#112 = [SQRT[16] + ABS[-2] + ROUND[1.6] + FIX[1.6] + FUP[1.2]]
#113 = [LN[EXP[1]] + [7 MOD 3]]
IF [#100 EQ 10 AND #101 NE 0] THEN #110 = 1
IF [#100 GT 0 OR #101 GE 2] THEN #110 = 2
IF [[#100 LT 20] XOR [#101 LE 1]] THEN #110 = 3

N500 (STRUCTURED AND INLINE CONTROL FLOW)
(/ IF/THEN/ELSE/ENDIF are structure; DO1 pairs with END1.)
IF [#100 GT #101] THEN
    #120 = 1
ELSE
    #120 = 0
ENDIF
#121 = 0
WHILE [#121 LT 2] DO1
    #121 = #121 + 1
END1
(/ Both spaced and compact GOTO spellings have matching destinations.)
IF [#120 EQ 0] GOTO 600
GOTO600
N600 (END OF GALLERY)
M30
%

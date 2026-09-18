%
O9001 (KAIJU RECONSTRUCTOR - BEFORE AND AFTER)
(/ EDITOR DEMO ONLY - DO NOT RUN ON A MACHINE)
(/ Open this file and run KAIJU Reconstructor from the Command Palette.)
(/ Compare the result with this original, then Undo to try other options.)
(/ This file is deliberately untidy. It is the input to the demonstration.)
(/ Results depend on your chosen formatting options.)
(/ For the examples below use 3 decimal places, Add Missing Decimal on,)
(/ Normalize Tool Codes on, and Auto Semicolon off.)

(- 1 - CASE, SPACING, AND DECIMALS)
(/ The compact line below becomes G01 X0.000 Z-20.000 F0.180.)
(/ G and M codes are normalized; axis and feed values gain decimals.)
g21g18g90g94
g0x50z5
g1x0z-20f.18 (compact lowercase input)
g0 x50.12345 z5. (round to the selected decimal precision)

(- 2 - TOOL NUMBERS AND ADJACENT WORDS)
(/ T9 becomes T09; T606 becomes T0606 with tool normalization enabled.)
(/ The H address is separated from Z without making H a decimal axis.)
t9
t606
g43z4.h2
g49

(- 3 - MACRO MATH AND LOOP INDENTATION)
(/ Look at operator spacing, numeric formatting, and loop-body indentation.)
(/ Numbered macro identities and DO1/END1 matching are retained.)
#100=0 (pass counter)
#101=2 (pass limit)
while[#100 lt #101]do1
#100=#100+1
g1x[40-[#100*2]]z-10f.2
end1

(- 4 - COMMENT AND TITLE TEXT)
(/ The code-like words in this comment are explanation: g1x0 #999.)
<DISPLAY TITLE - g1x0 IS TEXT HERE>
(Ordinary comment with [a bracketed note] and {a brace note})
(/ Formatting changes presentation; it does not repair machining logic.)
g0x60z10
m5
m30
%

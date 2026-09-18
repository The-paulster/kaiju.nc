%
O9005 (KAIJU C AXIS - ROTARY SWEEPS AND POLAR FACE PATHS)
(/ INSPECTION DEMO ONLY - DO NOT RUN ON A MACHINE)
(/ Select Lathe Diameter and FANUC / ISO using KAIJU Machine Mode.)
(/ Open KAIJU Vision, choose X-Y, then Fit View.)
(/ With diameter X, X40 is a physical radius of 20 mm.)
(/ Lathe Radius instead makes X40 a radius of 40 mm.)
(/ Use Trace and Play to watch C in the purple coordinate readout.)
(/ Endpoint labels and hover details retain C on later X/Z-only moves.)
(/ Positive C rotates from +X toward +Y. Turns are used as written.)
(/ No controller-specific shortest-path indexing is assumed.)
(/ Physical rotary timing remains unknown in Chronoblade.)
(/ No spindle engagement or C-axis clamp M codes are inferred here.)

G21 G18 G90 G94 G40
T0101
G00 X40.000 Z0.000 C0.000

N100 (FOUR QUARTER TURNS - ONE CIRCLE)
(/ These four angular moves trace a 20 mm radius circle in X-Y.)
(/ Inspect the C90, C180, C270, and C360 endpoints.)
G01 C90.000 F200.000
G01 C180.000
G01 C270.000
G01 C360.000

N200 (AN EXPLICIT FULL TURN)
(/ C360 to C720 is another complete turn, not a zero-length move.)
(/ The endpoints overlap in X-Y; Play reveals the sweep between them.)
G01 C720.000

N300 (SIMULTANEOUS X, Z, AND C - EXPANDING SPIRAL)
(/ Over one turn the radius grows from 20 to 30 mm and Z falls 12 mm.)
(/ Dual View with Shared axis X shows the face and axial projections.)
G01 X60.000 Z-12.000 C1080.000
(/ This move omits C: the last angle, 1080 degrees, remains in the labels.)
G01 X50.000 Z-15.000

N400 (REVERSE TURN AND INCREMENTAL ROTATION)
(/ C1080 to C720 is a full negative turn, with no shortest-path wrapping.)
G01 C720.000
(/ H is incremental C outside polar mode: add 90 degrees to reach C810.)
G01 H90.000
(/ G91 makes a C word incremental too: subtract 90 to return to C720.)
G91 G01 C-90.000
G90

N500 (POLAR INTERPOLATION - C NOW MEANS A FACE COORDINATE)
(/ Reset to C0 before enabling polar interpolation.)
(/ From C720 this reset is two reverse turns, visible as a rapid sweep.)
G00 Z5.000
G00 X40.000 C0.000
G12.1
(/ Inside G12.1, C is a virtual Cartesian face coordinate, not degrees.)
(/ In this diameter profile X40 maps to face X20 and C10 maps to Y10.)
(/ This 10 by 20 mm rectangle has straight sides rather than rotary sweeps.)
G01 Z-1.000 F100.000
G01 X40.000 C10.000 F200.000
G01 X20.000 C10.000
G01 X20.000 C-10.000
G01 X40.000 C-10.000
G01 X40.000 C0.000
(/ Return the virtual C coordinate to zero before cancelling this example.)
G13.1

N600 (BACK TO PHYSICAL C DEGREES)
G00 Z5.000
G01 C90.000 F200.000
(/ An X-only move now follows the retained physical C90 orientation.)
G01 X60.000
M30
%

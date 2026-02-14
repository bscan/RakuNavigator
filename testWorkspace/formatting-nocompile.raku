#!/usr/bin/env raku
# This file intentionally does NOT compile (`raku -c` will fail).
# It contains formatting issues that also happen to be syntax errors.
# The formatter should still be able to process individual lines.

# ---- Keyword directly followed by open-paren ----
# Raku treats `if(...)` as a function call attempt and refuses to compile.
# The formatter should add a space: `if (...)`, `unless (...)`, etc.
my $x = 10;
if($x > 5) { say "yes" }
unless($x < 0) { say "positive" }
while(False) { say "never" }
until(True) { say "never" }

# ---- Missing space between keyword and sigil ----
my @array = (1, 2, 3);
for@array -> $item { say $item }

# ---- Missing space before block after bare expression ----
given42 {
    when 42 { say "got it" }
}

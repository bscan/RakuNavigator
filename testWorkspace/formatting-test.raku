#!/usr/bin/env raku
# Formatter test file — every section must compile with `raku -c`.
# Sections marked POSITIVE contain deliberate style violations the formatter
# should fix.  Sections marked NEGATIVE contain code the formatter must
# leave alone.
#
# NOTE: Trailing-whitespace tests are fragile because editors and git may
#       strip trailing spaces.  Those cases are better verified via unit tests.

# ==========================================================================
# POSITIVE 1 — Bad indentation
# ==========================================================================

# Indentation here is intentionally wrong; formatter should fix it.
sub test-indentation {
my $x = 10;
if $x > 5 {
say "greater";
my @a = (1, 2, 3);
for @a -> $item {
say $item;
}
}
}

# Nested blocks with inconsistent indentation
sub test-nested-indentation {
  if True {
      if True {
    say "level 2";
          if True {
      say "level 3";
          }
      }
  }
}

# ==========================================================================
# POSITIVE 2 — Space after comma (should add space after comma)
# ==========================================================================

sub test-comma-spacing {
    my @list = (1,2,3,4,5);
    my ($a,$b,$c) = (1,2,3);
    my %pairs = (key1 => 1,key2 => 2,key3 => 3);
    sub inner-comma($x,$y,$z) { say "$x $y $z" }
    inner-comma($a,$b,$c);
}

# ==========================================================================
# POSITIVE 3 — No space before semicolon (should remove extra space)
# ==========================================================================

sub test-semicolon-spacing {
    my $val = 5 ;
    say "hello" ;
    for 1..3 -> $i { say $i ; }
}

# ==========================================================================
# POSITIVE 4 — Space after keywords
# ==========================================================================
# NOTE: In Raku, `if($x)` (keyword immediately followed by open-paren) is a
# compile error, not just a style issue.  Those cases live in
# formatting-nocompile.raku.  The formatter should still add the space, but
# we cannot `raku -c` them here.

# ==========================================================================
# POSITIVE 5 — Uncuddled else (should cuddle onto closing-brace line)
# ==========================================================================

sub test-uncuddled-else {
    my $x = 10;
    if $x > 5 {
        say "big";
    }
    else {
        say "small";
    }

    if $x > 10 {
        say "very big";
    }
    elsif $x > 5 {
        say "medium";
    }
    else {
        say "small";
    }
}

# ==========================================================================
# POSITIVE 6 — Opening brace on next line (should move up)
# ==========================================================================

class BraceNextLine
{
    has $.value;

    method compute()
    {
        return $.value * 2;
    }
}

sub brace-next-line()
{
    say "hello";
}

grammar BraceNextLineGrammar
{
    token identifier
    {
        <alpha> \w*
    }
}

# ==========================================================================
# POSITIVE 7 — Space before brace (should add space)
# ==========================================================================

class NoBraceSpace{
    has $.field;
    method test(){ say "hi" }
}

sub no-brace-space{
    return 42;
}

# ==========================================================================
# POSITIVE 8 — Combined issues (multiple rules fire on same code)
# ==========================================================================

class CombinedIssues{
has $.name;
method greet($who){
if $who eq "World" {
say "Hello, World!";
}
else{
say "Hello, $who!";
}
}
}

# ==========================================================================
# NEGATIVE 1 — Already-correct code (should NOT change)
# ==========================================================================

sub already-correct {
    my $x = 10;
    if $x > 5 {
        say "yes";
    } else {
        say "no";
    }
    my @list = (1, 2, 3);
    for @list -> $item {
        say $item;
    }
}

# ==========================================================================
# NEGATIVE 2 — One-liner methods (should keep indentation, not double-dedent)
# ==========================================================================

class SymbolOneLiners {
    has $.name;

    method CALL-ME($x) {
        self.new(name => $x);
    }

    method gist { "#<symbol:{$.name}>" }
    method Str  { $.name }
    method one-liner-say { say "test" }
}

# ==========================================================================
# NEGATIVE 3 — Strings (content must NOT be reformatted)
# ==========================================================================

sub test-string-preservation {
    my $s1 = 'if($x) { say "no"; }';
    my $s2 = "comma,separated,values";
    my $s3 = "semicolon ; stays";
    my $s4 = q{if($x){say "no";}};
    my $s5 = '} else { should stay';
}

# ==========================================================================
# NEGATIVE 4 — Regex (content must NOT be reformatted)
# ==========================================================================

sub test-regex-preservation {
    my $re1 = / <alpha> [ <digit> ]+ /;
    my $re2 = rx{ foo bar };
    "abc123" ~~ / <alpha>+ /;
}

# ==========================================================================
# NEGATIVE 5 — Hash / array literals (brace placement should NOT change)
# ==========================================================================

sub test-hash-preservation {
    my %h = (
        key1 => "value1",
        key2 => "value2",
    );

    my %nested = %(
        outer => %(
            inner => "value"
        )
    );

    my @arr = [
        1, 2, 3,
        4, 5, 6,
    ];
}

# ==========================================================================
# NEGATIVE 6 — Method chains (should preserve line breaks)
# ==========================================================================

sub test-method-chains {
    my @result = (1, 2, 3, 4, 5)
        .grep(* > 2)
        .map(* * 2);
}

# ==========================================================================
# NEGATIVE 7 — Keyword-like identifiers (should NOT add space)
# ==========================================================================

sub test-keyword-identifiers {
    my $diff = 1;
    my $forwards = 2;
    my $unlessable = 3;
    my $format = 4;
    my $iffy = 5;
    say $diff + $forwards + $unlessable + $format + $iffy;
}

# ==========================================================================
# NEGATIVE 8 — Multi-line signatures (brace should stay on its own line)
# ==========================================================================

sub complex-signature(
    $param1,
    $param2,
    :$named1,
    :$named2
) {
    say "body";
}

# ==========================================================================
# NEGATIVE 9 — Comments with brace-like content (should NOT reformat)
# ==========================================================================

sub test-comment-preservation {
    # if($x){ say "yes" }
    # } else {
    # class Foo{
    say "ok";
}
